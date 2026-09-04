import { ARCADE_API_VERSION, jsonValueSchema } from '@common-arcade/protocol'
import { z } from 'zod'

const conditionSchema = z.string().min(1).max(500)
const conditionClause =
  /^[A-Za-z][A-Za-z0-9_.]*\s*(?:==|!=|>=|<=|>|<)\s*(?:-?(?:\d+\.?\d*|\.\d+)|true|false|null|"[^"]*"|'[^']*'|[A-Za-z][A-Za-z0-9_.]*)$/

function isBoundedCondition(expression: string): boolean {
  const normalized = expression.trim()
  if (normalized === 'true' || normalized === 'false') return true
  return normalized
    .split(/\s*\|\|\s*/)
    .every((part) =>
      part.split(/\s*&&\s*/).every((clause) => conditionClause.test(clause)),
    )
}

export const actionSelectorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('first-legal') }).strict(),
  z
    .object({
      kind: z.literal('prefer-legal'),
      actions: z.array(jsonValueSchema).min(1).max(256),
    })
    .strict(),
  z
    .object({
      kind: z.literal('indexed-legal'),
      indexPath: z.string().min(1).max(200),
    })
    .strict(),
  z.object({ kind: z.literal('none') }).strict(),
])

export const policyRuleSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{0,62}$/),
    when: conditionSchema,
    select: actionSelectorSchema,
    priority: z.number().int().min(-1_000).max(1_000).default(0),
    cooldownSteps: z.number().int().nonnegative().max(1_000_000).default(0),
    transitionTo: z
      .string()
      .regex(/^[a-z][a-z0-9-]{0,62}$/)
      .optional(),
    explanation: z.string().min(1).max(300),
  })
  .strict()

export const policyStateSchema = z
  .object({
    onObservation: z.array(policyRuleSchema).max(512),
  })
  .strict()

export const policyIrSchema = z
  .object({
    apiVersion: z.literal(ARCADE_API_VERSION),
    kind: z.literal('Policy'),
    metadata: z
      .object({
        id: z.string().regex(/^pol_[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/),
        name: z.string().regex(/^[a-z][a-z0-9-]{0,62}$/),
        version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
      })
      .strict(),
    spec: z
      .object({
        compatible: z
          .object({
            releaseIds: z.array(z.string()).min(1),
            profiles: z.array(z.string()).default(['policy-v1']),
          })
          .strict(),
        initialState: z.string().regex(/^[a-z][a-z0-9-]{0,62}$/),
        initialMemory: jsonValueSchema.default({}),
        states: z.record(z.string(), policyStateSchema),
        fallback: actionSelectorSchema,
        budget: z
          .object({
            maxSteps: z.number().int().positive().max(10_000_000),
            maxActionsPerStep: z.literal(1),
            memoryKiB: z.number().int().positive().max(65_536),
          })
          .strict(),
      })
      .strict(),
  })
  .strict()
  .superRefine((policy, context) => {
    const stateNames = new Set(Object.keys(policy.spec.states))
    for (const stateName of stateNames) {
      if (!/^[a-z][a-z0-9-]{0,62}$/.test(stateName)) {
        context.addIssue({
          code: 'custom',
          path: ['spec', 'states', stateName],
          message: 'state names must be lowercase identifiers',
        })
      }
    }
    if (!stateNames.has(policy.spec.initialState)) {
      context.addIssue({
        code: 'custom',
        path: ['spec', 'initialState'],
        message: 'initialState must name a declared state',
      })
    }
    for (const [stateName, state] of Object.entries(policy.spec.states)) {
      for (const [index, rule] of state.onObservation.entries()) {
        if (!isBoundedCondition(rule.when)) {
          context.addIssue({
            code: 'custom',
            path: ['spec', 'states', stateName, 'onObservation', index, 'when'],
            message: 'condition is outside the bounded CEL subset',
          })
        }
        if (
          rule.transitionTo !== undefined &&
          !stateNames.has(rule.transitionTo)
        ) {
          context.addIssue({
            code: 'custom',
            path: [
              'spec',
              'states',
              stateName,
              'onObservation',
              index,
              'transitionTo',
            ],
            message: 'transitionTo must name a declared state',
          })
        }
      }
    }
  })

export type ActionSelector = z.infer<typeof actionSelectorSchema>
export type PolicyRule = z.infer<typeof policyRuleSchema>
export type PolicyIr = z.infer<typeof policyIrSchema>

export interface CompiledPolicy {
  readonly ir: PolicyIr
  readonly canonical: string
  readonly digest: `sha256:${string}`
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  const object = value as Record<string, unknown>
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(object[key])}`)
    .join(',')}}`
}

export async function compilePolicy(source: unknown): Promise<CompiledPolicy> {
  const ir = policyIrSchema.parse(source)
  const canonical = canonicalize(ir)
  const bytes = new TextEncoder().encode(canonical)
  const digest = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
  )
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
  return { ir, canonical, digest: `sha256:${digest}` }
}

export const policyIrStatus = {
  stability: 'v0alpha1',
  grammarApproved: true,
  compilerAvailable: true,
  expressionLanguage: 'bounded-cel-subset',
} as const
