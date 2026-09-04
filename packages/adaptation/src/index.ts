import { z } from 'zod'

export const adaptationPointSchema = z.enum([
  'every-observation',
  'turn-boundary',
  'window-boundary',
  'phase-boundary',
  'round-boundary',
  'between-matches',
])

export const learningContractSchema = z
  .object({
    adaptationPoints: z.array(adaptationPointSchema).min(1),
    visibleMetrics: z.array(z.string().min(1)).min(1),
    matchMemory: z.enum(['forbidden', 'allowed']),
    longTermLearning: z.enum(['forbidden', 'opt-in']),
  })
  .strict()

const thresholdSchema = z
  .object({
    metric: z.string().min(1),
    operator: z.enum(['gt', 'gte', 'lt', 'lte', 'eq']),
    value: z.number().finite(),
  })
  .strict()

export const strategyTransitionSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{0,62}$/),
    from: z.array(z.string().min(1)).min(1),
    to: z.string().min(1),
    at: adaptationPointSchema,
    threshold: thresholdSchema,
    confirmForSteps: z.number().int().positive().max(100_000),
    minimumDwellSteps: z.number().int().nonnegative().max(1_000_000),
    cooldownSteps: z.number().int().nonnegative().max(1_000_000),
    priority: z.number().int().min(-1_000).max(1_000).default(0),
    reason: z.string().min(1).max(300),
  })
  .strict()

export const adaptationContractSchema = z
  .object({
    initialStrategy: z.string().min(1),
    strategies: z.array(z.string().min(1)).min(1),
    transitions: z.array(strategyTransitionSchema).max(256),
    maxChangesPerWindow: z.number().int().positive(),
    changeWindowSteps: z.number().int().positive(),
  })
  .strict()
  .superRefine((contract, context) => {
    const strategies = new Set(contract.strategies)
    if (!strategies.has(contract.initialStrategy)) {
      context.addIssue({
        code: 'custom',
        path: ['initialStrategy'],
        message: 'initialStrategy must be declared',
      })
    }
    for (const [index, transition] of contract.transitions.entries()) {
      if (!strategies.has(transition.to)) {
        context.addIssue({
          code: 'custom',
          path: ['transitions', index, 'to'],
          message: 'transition target must be declared',
        })
      }
    }
  })

export type AdaptationPoint = z.infer<typeof adaptationPointSchema>
export type LearningContract = z.infer<typeof learningContractSchema>
export type AdaptationContract = z.infer<typeof adaptationContractSchema>

export interface StrategyCommit {
  readonly strategyEpoch: number
  readonly from: string
  readonly to: string
  readonly transitionId: string
  readonly reason: string
  readonly evidence: {
    readonly metric: string
    readonly observed: number
    readonly threshold: number
    readonly consecutiveSteps: number
  }
  readonly effectiveAt: {
    readonly point: AdaptationPoint
    readonly step: number
  }
}

function satisfied(
  value: number,
  threshold: z.infer<typeof thresholdSchema>,
): boolean {
  switch (threshold.operator) {
    case 'gt':
      return value > threshold.value
    case 'gte':
      return value >= threshold.value
    case 'lt':
      return value < threshold.value
    case 'lte':
      return value <= threshold.value
    case 'eq':
      return value === threshold.value
  }
}

export class AdaptationController {
  private strategy: string
  private epoch = 1
  private step = 0
  private changedAt = 0
  private readonly evidence = new Map<string, number>()
  private readonly lastTransitionAt = new Map<string, number>()
  private readonly changes: number[] = []

  readonly learning: LearningContract
  readonly contract: AdaptationContract

  constructor(learning: unknown, contract: unknown) {
    this.learning = learningContractSchema.parse(learning)
    this.contract = adaptationContractSchema.parse(contract)
    for (const transition of this.contract.transitions) {
      if (!this.learning.adaptationPoints.includes(transition.at)) {
        throw new Error(
          `Transition ${transition.id} uses adaptation point forbidden by the game`,
        )
      }
      if (!this.learning.visibleMetrics.includes(transition.threshold.metric)) {
        throw new Error(
          `Transition ${transition.id} reads metric not exposed by the game`,
        )
      }
    }
    this.strategy = this.contract.initialStrategy
  }

  get activeStrategy(): string {
    return this.strategy
  }

  get strategyEpoch(): number {
    return this.epoch
  }

  observe(
    point: AdaptationPoint,
    metrics: Readonly<Record<string, number>>,
  ): StrategyCommit | undefined {
    this.step += 1
    const eligible = this.contract.transitions
      .filter(
        (transition) =>
          transition.at === point && transition.from.includes(this.strategy),
      )
      .sort(
        (left, right) =>
          right.priority - left.priority || left.id.localeCompare(right.id),
      )

    for (const transition of eligible) {
      const observed = metrics[transition.threshold.metric]
      const count =
        observed !== undefined && satisfied(observed, transition.threshold)
          ? (this.evidence.get(transition.id) ?? 0) + 1
          : 0
      this.evidence.set(transition.id, count)
      if (count < transition.confirmForSteps) continue
      if (this.step - this.changedAt < transition.minimumDwellSteps) continue
      const lastTransition = this.lastTransitionAt.get(transition.id)
      if (
        lastTransition !== undefined &&
        this.step - lastTransition <= transition.cooldownSteps
      )
        continue
      this.pruneChanges()
      if (this.changes.length >= this.contract.maxChangesPerWindow) continue
      if (observed === undefined) continue

      const from = this.strategy
      this.strategy = transition.to
      this.epoch += 1
      this.changedAt = this.step
      this.lastTransitionAt.set(transition.id, this.step)
      this.changes.push(this.step)
      this.evidence.clear()
      return {
        strategyEpoch: this.epoch,
        from,
        to: transition.to,
        transitionId: transition.id,
        reason: transition.reason,
        evidence: {
          metric: transition.threshold.metric,
          observed,
          threshold: transition.threshold.value,
          consecutiveSteps: count,
        },
        effectiveAt: { point, step: this.step },
      }
    }
    return undefined
  }

  private pruneChanges(): void {
    const minimum = this.step - this.contract.changeWindowSteps
    while (this.changes[0] !== undefined && this.changes[0] <= minimum)
      this.changes.shift()
  }
}

export const adaptationStatus = {
  stability: 'v0alpha1',
  horizons: ['reflex', 'tactical', 'strategic', 'between-match'],
  learningContractApproved: true,
  controls: ['evidence-window', 'dwell', 'cooldown', 'change-rate'],
} as const
