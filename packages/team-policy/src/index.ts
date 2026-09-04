import { jsonValueSchema, type JsonValue } from '@common-arcade/protocol'
import { z } from 'zod'

export const teamPolicySchema = z
  .object({
    id: z.string().regex(/^tmp_[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    profile: z.enum(['centralized', 'decentralized', 'hybrid']),
    initialStrategy: z.string().min(1),
    strategies: z.record(z.string(), jsonValueSchema),
    roles: z.array(
      z
        .object({
          id: z.string().min(1),
          maxSeats: z.number().int().positive(),
          policyDigest: z
            .string()
            .regex(/^sha256:[a-f0-9]{64}$/)
            .optional(),
        })
        .strict(),
    ),
    communication: z
      .object({
        allowedTypes: z.array(z.string().min(1)),
        maxBytes: z.number().int().positive().max(65_536),
        maxMessagesPerTick: z.number().int().positive().max(1_000),
      })
      .strict(),
  })
  .strict()
  .superRefine((policy, context) => {
    if (!(policy.initialStrategy in policy.strategies)) {
      context.addIssue({
        code: 'custom',
        path: ['initialStrategy'],
        message: 'initialStrategy must be declared',
      })
    }
  })

export type TeamPolicy = z.infer<typeof teamPolicySchema>

export interface CoordinationRecord {
  readonly teamId: string
  readonly senderSeatId: string
  readonly sequence: number
  readonly strategyEpoch: number
  readonly createdTick: number
  readonly effectiveTick: number
  readonly expiresTick: number
  readonly type: string
  readonly priority: number
  readonly correlationId: string
  readonly payload: JsonValue
}

export interface AssignmentLease {
  readonly responsibility: string
  readonly seatId: string
  readonly role: string
  readonly grantedTick: number
  readonly expiresTick: number
  readonly strategyEpoch: number
}

export interface TeamStrategyCommit {
  readonly strategyEpoch: number
  readonly strategy: string
  readonly effectiveTick: number
  readonly validUntilTick: number
  readonly assignments: Readonly<Record<string, JsonValue>>
  readonly acknowledgements: readonly string[]
}

export class TeamCoordinator {
  readonly policy: TeamPolicy
  private strategy: string
  private epoch = 1
  private sequence = 0
  private pending?: TeamStrategyCommit
  private readonly messagesAtTick = new Map<number, number>()
  private readonly assignmentLeases = new Map<string, AssignmentLease>()

  constructor(
    policy: unknown,
    readonly teamId: string,
  ) {
    this.policy = teamPolicySchema.parse(policy)
    this.strategy = this.policy.initialStrategy
  }

  get activeStrategy(): string {
    return this.strategy
  }

  get strategyEpoch(): number {
    return this.epoch
  }

  publish(input: {
    readonly senderSeatId: string
    readonly tick: number
    readonly effectiveTick?: number
    readonly expiresTick: number
    readonly type: string
    readonly priority?: number
    readonly correlationId: string
    readonly payload: JsonValue
  }): CoordinationRecord {
    if (!this.policy.communication.allowedTypes.includes(input.type))
      throw new Error(`Coordination type ${input.type} is not allowed`)
    if (input.expiresTick < input.tick)
      throw new Error('Message already expired')
    const bytes = new TextEncoder().encode(
      JSON.stringify(input.payload),
    ).byteLength
    if (bytes > this.policy.communication.maxBytes)
      throw new Error('Coordination payload exceeds byte budget')
    const used = this.messagesAtTick.get(input.tick) ?? 0
    if (used >= this.policy.communication.maxMessagesPerTick)
      throw new Error('Coordination message rate exceeded')
    this.messagesAtTick.set(input.tick, used + 1)
    this.sequence += 1
    return {
      teamId: this.teamId,
      senderSeatId: input.senderSeatId,
      sequence: this.sequence,
      strategyEpoch: this.epoch,
      createdTick: input.tick,
      effectiveTick: input.effectiveTick ?? input.tick,
      expiresTick: input.expiresTick,
      type: input.type,
      priority: input.priority ?? 0,
      correlationId: input.correlationId,
      payload: input.payload,
    }
  }

  proposeStrategy(input: {
    readonly strategy: string
    readonly effectiveTick: number
    readonly validUntilTick: number
    readonly assignments?: Readonly<Record<string, JsonValue>>
  }): TeamStrategyCommit {
    if (!(input.strategy in this.policy.strategies))
      throw new Error(`Unknown team strategy ${input.strategy}`)
    if (input.effectiveTick >= input.validUntilTick)
      throw new Error('Strategy validity must extend beyond its effective tick')
    const commit: TeamStrategyCommit = {
      strategyEpoch: this.epoch + 1,
      strategy: input.strategy,
      effectiveTick: input.effectiveTick,
      validUntilTick: input.validUntilTick,
      assignments: input.assignments ?? {},
      acknowledgements: [],
    }
    this.pending = commit
    return commit
  }

  acknowledgeStrategy(seatId: string, strategyEpoch: number): void {
    if (this.pending?.strategyEpoch !== strategyEpoch)
      throw new Error('Strategy acknowledgement is stale')
    if (!this.pending.acknowledgements.includes(seatId)) {
      this.pending = {
        ...this.pending,
        acknowledgements: [...this.pending.acknowledgements, seatId].sort(),
      }
    }
  }

  advance(tick: number): TeamStrategyCommit | undefined {
    this.expireAssignments(tick)
    if (this.pending === undefined || tick < this.pending.effectiveTick)
      return undefined
    if (tick >= this.pending.validUntilTick) {
      this.pending = undefined
      return undefined
    }
    const commit = this.pending
    this.pending = undefined
    this.strategy = commit.strategy
    this.epoch = commit.strategyEpoch
    return commit
  }

  assign(input: {
    readonly responsibility: string
    readonly seatId: string
    readonly role: string
    readonly tick: number
    readonly expiresTick: number
  }): AssignmentLease {
    const current = this.assignmentLeases.get(input.responsibility)
    if (current !== undefined && current.expiresTick >= input.tick)
      throw new Error(
        `Responsibility ${input.responsibility} is already leased`,
      )
    if (input.expiresTick <= input.tick)
      throw new Error('Assignment lease must expire in the future')
    const lease: AssignmentLease = {
      responsibility: input.responsibility,
      seatId: input.seatId,
      role: input.role,
      grantedTick: input.tick,
      expiresTick: input.expiresTick,
      strategyEpoch: this.epoch,
    }
    this.assignmentLeases.set(input.responsibility, lease)
    return lease
  }

  assignments(tick: number): readonly AssignmentLease[] {
    this.expireAssignments(tick)
    return [...this.assignmentLeases.values()].sort((left, right) =>
      left.responsibility.localeCompare(right.responsibility),
    )
  }

  private expireAssignments(tick: number): void {
    for (const [responsibility, lease] of this.assignmentLeases) {
      if (lease.expiresTick < tick) this.assignmentLeases.delete(responsibility)
    }
  }
}

export const teamPolicyStatus = {
  stability: 'v0alpha1',
  sharedIntentModelApproved: true,
  communicationModelApproved: true,
  profiles: ['centralized', 'decentralized', 'hybrid'],
} as const
