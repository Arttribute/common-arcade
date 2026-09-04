import type {
  ActionSelector,
  CompiledPolicy,
  PolicyRule,
} from '@common-arcade/policy-ir'
import type { JsonValue, Observation } from '@common-arcade/protocol'

export interface PolicyDecision {
  readonly step: number
  readonly state: string
  readonly previousState: string
  readonly matchedRuleId?: string
  readonly action?: JsonValue
  readonly explanation: string
  readonly memoryBefore: JsonValue
  readonly memoryAfter: JsonValue
  readonly budget: {
    readonly stepsUsed: number
    readonly stepsRemaining: number
  }
}

interface EvaluationContext {
  readonly observation: Observation
  readonly memory: JsonValue
  readonly policy: { readonly state: string; readonly step: number }
}

function resolvePath(root: unknown, path: string): unknown {
  let value = root
  for (const segment of path.split('.')) {
    if (typeof value !== 'object' || value === null || !(segment in value))
      return undefined
    value = (value as Record<string, unknown>)[segment]
  }
  return value
}

function operand(source: string, context: EvaluationContext): unknown {
  const trimmed = source.trim()
  if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(trimmed)) return Number(trimmed)
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (trimmed === 'null') return null
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return resolvePath(context, trimmed)
}

function compare(left: unknown, operator: string, right: unknown): boolean {
  switch (operator) {
    case '==':
      return left === right
    case '!=':
      return left !== right
    case '>':
      return (
        typeof left === 'number' && typeof right === 'number' && left > right
      )
    case '>=':
      return (
        typeof left === 'number' && typeof right === 'number' && left >= right
      )
    case '<':
      return (
        typeof left === 'number' && typeof right === 'number' && left < right
      )
    case '<=':
      return (
        typeof left === 'number' && typeof right === 'number' && left <= right
      )
    default:
      return false
  }
}

export function evaluateCondition(
  expression: string,
  context: EvaluationContext,
): boolean {
  if (expression.trim() === 'true') return true
  if (expression.trim() === 'false') return false
  return expression.split(/\s*\|\|\s*/).some((disjunction) =>
    disjunction.split(/\s*&&\s*/).every((clause) => {
      const match = clause.match(
        /^([A-Za-z][A-Za-z0-9_.]*)\s*(==|!=|>=|<=|>|<)\s*(.+)$/,
      )
      if (match === null) return false
      const [, left, operator, right] = match
      if (left === undefined || operator === undefined || right === undefined)
        return false
      return compare(
        resolvePath(context, left),
        operator,
        operand(right, context),
      )
    }),
  )
}

function equalJson(left: JsonValue, right: JsonValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function selectAction(
  selector: ActionSelector,
  observation: Observation,
  context: EvaluationContext,
): JsonValue | undefined {
  if (selector.kind === 'none') return undefined
  if (selector.kind === 'first-legal') return observation.legalActions[0]
  if (selector.kind === 'prefer-legal') {
    return selector.actions.find((wanted) =>
      observation.legalActions.some((legal) => equalJson(wanted, legal)),
    )
  }
  const rawIndex = resolvePath(context, selector.indexPath)
  if (typeof rawIndex !== 'number' || !Number.isInteger(rawIndex))
    return undefined
  if (observation.legalActions.length === 0) return undefined
  const index =
    ((rawIndex % observation.legalActions.length) +
      observation.legalActions.length) %
    observation.legalActions.length
  return observation.legalActions[index]
}

export class DeterministicPolicyRuntime {
  private state: string
  private memory: JsonValue
  private step = 0
  private readonly lastMatchedAt = new Map<string, number>()

  constructor(readonly policy: CompiledPolicy) {
    this.state = policy.ir.spec.initialState
    this.memory = structuredClone(policy.ir.spec.initialMemory)
  }

  get activeState(): string {
    return this.state
  }

  decide(observation: Observation): PolicyDecision {
    if (this.step >= this.policy.ir.spec.budget.maxSteps)
      throw new Error('Policy step budget exhausted')
    this.step += 1
    const previousState = this.state
    const memoryBefore = structuredClone(this.memory)
    const context: EvaluationContext = {
      observation,
      memory: this.memory,
      policy: { state: this.state, step: this.step },
    }
    const state = this.policy.ir.spec.states[this.state]
    if (state === undefined)
      throw new Error(`Unknown policy state ${this.state}`)
    const rules = [...state.onObservation].sort(
      (left, right) =>
        right.priority - left.priority || left.id.localeCompare(right.id),
    )
    const matched = rules.find((rule) => this.matches(rule, context))
    const selector = matched?.select ?? this.policy.ir.spec.fallback
    const action = selectAction(selector, observation, context)
    if (matched !== undefined) {
      this.lastMatchedAt.set(matched.id, this.step)
      if (matched.transitionTo !== undefined) this.state = matched.transitionTo
    }
    return {
      step: this.step,
      state: this.state,
      previousState,
      ...(matched === undefined ? {} : { matchedRuleId: matched.id }),
      ...(action === undefined ? {} : { action }),
      explanation: matched?.explanation ?? 'Applied the declared fallback.',
      memoryBefore,
      memoryAfter: structuredClone(this.memory),
      budget: {
        stepsUsed: this.step,
        stepsRemaining: this.policy.ir.spec.budget.maxSteps - this.step,
      },
    }
  }

  private matches(rule: PolicyRule, context: EvaluationContext): boolean {
    const lastMatched = this.lastMatchedAt.get(rule.id)
    if (
      lastMatched !== undefined &&
      this.step - lastMatched <= rule.cooldownSteps
    )
      return false
    return evaluateCondition(rule.when, context)
  }
}

export const policyRuntimeStatus = {
  stability: 'v0alpha1',
  sandboxes: ['declarative-ir'],
  deterministic: true,
  ambientCapabilities: [],
} as const
