import { canonicalJson, sha256 } from '@common-arcade/manifest'
import type {
  ActionErrorCode,
  ActionResult,
  ActionSubmission,
  JsonValue,
  MatchEvent,
  MatchStatus,
  Observation,
  Replay,
  ReplayCheckpoint,
} from '@common-arcade/protocol'

export {
  createGridPlacementGame,
  type GridPlacementAction,
  type GridPlacementRuleSet,
  type GridPlacementState,
} from './declarative.js'
export {
  createSandboxedScriptGame,
  type SandboxedScriptRuleSet,
} from './sandboxed-script.js'

export const MATCH_RUNTIME_VERSION = '0.1.0-v0alpha1' as const

export interface MatchRosterEntry {
  readonly seatId: string
  readonly role: string
  readonly team?: string
}

export interface GameInitializationContext {
  readonly matchId: string
  readonly seed: string
  readonly configuration: JsonValue
  readonly roster: readonly MatchRosterEntry[]
}

export interface GameActionContext {
  readonly matchId: string
  readonly seatId: string
  readonly stateSequence: number
  readonly eventSequence: number
  readonly authoritativeTime: string
  readonly elapsedMs: number
}

export interface GameTickContext {
  readonly matchId: string
  readonly tick: number
  readonly stateSequence: number
  readonly eventSequence: number
  readonly elapsedMs: number
  readonly deltaMs: number
}

export interface GameEventDraft {
  readonly type: string
  readonly visibility: MatchEvent['visibility']
  readonly audienceId?: string
  readonly payload: JsonValue
}

export interface GameTransition<State> {
  readonly state: State
  readonly events: readonly GameEventDraft[]
}

export interface GameActionRejection {
  readonly code: ActionErrorCode
  readonly detail: string
}

export interface GameDefinition<State, Action> {
  readonly releaseId: string
  readonly releaseDigest: string
  readonly mode: 'turn-based' | 'simultaneous' | 'realtime' | 'hybrid'
  initialize(context: GameInitializationContext): State
  parseAction(payload: JsonValue): Action
  validateAction(
    state: State,
    action: Action,
    context: GameActionContext,
  ): GameActionRejection | undefined
  applyAction(
    state: State,
    action: Action,
    context: GameActionContext,
  ): GameTransition<State>
  advanceTick?(state: State, context: GameTickContext): GameTransition<State>
  serializeState(state: State): JsonValue
  projectObservation(
    state: State,
    seatId: string,
    context: GameActionContext,
  ): Pick<Observation, 'visibleState' | 'legalActions' | 'feedback'>
  getResult(state: State): JsonValue | undefined
}

export interface AuthoritativeMatchOptions<State, Action> {
  readonly matchId: string
  readonly game: GameDefinition<State, Action>
  readonly seed: string
  readonly configuration: JsonValue
  readonly roster: readonly MatchRosterEntry[]
  readonly ownershipEpoch?: number
  readonly now?: () => Date
}

export interface RuntimeSnapshot<State> {
  readonly status: MatchStatus
  readonly stateSequence: number
  readonly eventSequence: number
  readonly ownershipEpoch: number
  readonly state: State
  readonly stateHash: string
  readonly elapsedMs: number
  readonly result?: JsonValue
}

export interface ReplayVerification {
  readonly valid: boolean
  readonly checkedCheckpoints: number
  readonly mismatches: readonly {
    readonly stateSequence: number
    readonly expected: string
    readonly actual?: string
  }[]
}

function eventId(matchId: string, sequence: number): string {
  return `evt_${matchId.slice(4)}_${sequence.toString().padStart(8, '0')}`
}

function replayId(matchId: string): string {
  return `rpl_${matchId.slice(4)}_primary`
}

function withoutControlLease(
  action: ActionSubmission,
): Omit<ActionSubmission, 'controlLease'> {
  const { controlLease: _controlLease, ...recorded } = action
  return recorded
}

export class AuthoritativeMatch<State, Action> {
  readonly matchId: string
  readonly game: GameDefinition<State, Action>
  readonly seed: string
  readonly configuration: JsonValue
  readonly roster: readonly MatchRosterEntry[]

  private status: MatchStatus = 'lobby'
  private ownershipEpoch: number
  private stateSequence = 0
  private eventSequence = 0
  private tickSequence = 0
  private elapsedMs = 0
  private state: State
  private stateHash = ''
  private result: JsonValue | undefined
  private readonly now: () => Date
  private readonly events: MatchEvent[] = []
  private readonly checkpoints: ReplayCheckpoint[] = []
  private readonly commands: Replay['commands'][number][] = []
  private readonly timeline: NonNullable<Replay['timeline']> = []
  private readonly actionResults = new Map<string, ActionResult>()
  private operation = Promise.resolve()

  private constructor(options: AuthoritativeMatchOptions<State, Action>) {
    this.matchId = options.matchId
    this.game = options.game
    this.seed = options.seed
    this.configuration = options.configuration
    this.roster = options.roster
    this.ownershipEpoch = options.ownershipEpoch ?? 1
    this.now = options.now ?? (() => new Date())
    this.state = this.game.initialize({
      matchId: this.matchId,
      seed: this.seed,
      configuration: this.configuration,
      roster: this.roster,
    })
  }

  static async create<State, Action>(
    options: AuthoritativeMatchOptions<State, Action>,
  ): Promise<AuthoritativeMatch<State, Action>> {
    const match = new AuthoritativeMatch(options)
    await match.recordCheckpoint()
    return match
  }

  getStatus(): MatchStatus {
    return this.status
  }

  /** Recover only a verified immutable replay; sessions and control leases are never restored. */
  static async recover<State, Action>(
    game: GameDefinition<State, Action>,
    replay: Replay,
    status: MatchStatus,
    ownershipEpoch: number,
    now?: () => Date,
  ): Promise<AuthoritativeMatch<State, Action>> {
    const verification = await verifyReplay(game, replay)
    if (!verification.valid)
      throw new Error('Persisted match replay failed integrity verification')
    const match = await AuthoritativeMatch.create({
      matchId: replay.matchId,
      game,
      seed: replay.seed,
      configuration: replay.configuration,
      roster: replay.roster,
      ownershipEpoch,
      now,
    })
    match.start()
    await replayInto(match, replay, 'recovery')
    match.events.splice(0, match.events.length, ...replay.events)
    match.commands.splice(0, match.commands.length, ...replay.commands)
    match.checkpoints.splice(0, match.checkpoints.length, ...replay.checkpoints)
    match.eventSequence = replay.events.at(-1)?.sequence ?? 0
    match.status = status
    for (const command of replay.commands)
      match.actionResults.set(command.action.actionId, command.result)
    return match
  }

  getOwnershipEpoch(): number {
    return this.ownershipEpoch
  }

  fence(newEpoch: number): void {
    if (newEpoch <= this.ownershipEpoch) {
      throw new RangeError('A fencing epoch must increase monotonically')
    }
    this.ownershipEpoch = newEpoch
  }

  start(): void {
    if (this.status !== 'lobby' && this.status !== 'ready') {
      throw new Error(`Cannot start a match from ${this.status}`)
    }
    this.status = 'running'
    this.appendEvents([
      {
        type: 'match.started',
        visibility: 'public',
        payload: { ownershipEpoch: this.ownershipEpoch },
      },
    ])
  }

  pause(): void {
    if (this.status !== 'running')
      throw new Error('Only running matches can pause')
    this.status = 'paused'
    this.appendEvents([
      { type: 'match.paused', visibility: 'public', payload: {} },
    ])
  }

  resume(): void {
    if (this.status !== 'paused')
      throw new Error('Only paused matches can resume')
    this.status = 'running'
    this.appendEvents([
      { type: 'match.resumed', visibility: 'public', payload: {} },
    ])
  }

  async snapshot(): Promise<RuntimeSnapshot<State>> {
    return {
      status: this.status,
      stateSequence: this.stateSequence,
      eventSequence: this.eventSequence,
      ownershipEpoch: this.ownershipEpoch,
      state: this.state,
      stateHash: this.stateHash,
      elapsedMs: this.elapsedMs,
      ...(this.result === undefined ? {} : { result: this.result }),
    }
  }

  observation(seatId: string): Observation {
    if (!this.roster.some((entry) => entry.seatId === seatId)) {
      throw new Error(`Unknown seat ${seatId}`)
    }
    const context = this.context(seatId)
    const projection = this.game.projectObservation(this.state, seatId, context)
    return {
      matchId: this.matchId,
      seatId,
      stateSequence: this.stateSequence,
      eventSequence: this.eventSequence,
      schemaVersion: 'v0alpha1',
      ...(this.game.mode === 'turn-based'
        ? { turn: this.stateSequence + 1 }
        : { tick: this.tickSequence }),
      ...projection,
      events: [],
      stateHash: this.stateHash,
    }
  }

  publicState(): JsonValue {
    return this.game.serializeState(this.state)
  }

  eventLog(afterSequence = 0): readonly MatchEvent[] {
    return this.events.filter((event) => event.sequence > afterSequence)
  }

  async submitAction(
    submission: ActionSubmission,
    ownerEpoch: number,
  ): Promise<ActionResult> {
    const result = this.operation.then(() =>
      this.submitActionSerially(submission, ownerEpoch),
    )
    this.operation = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  async advanceTick(deltaMs: number): Promise<boolean> {
    const result = this.operation.then(() => this.advanceTickSerially(deltaMs))
    this.operation = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  private async advanceTickSerially(deltaMs: number): Promise<boolean> {
    if (this.status !== 'running' || !this.game.advanceTick) return false
    if (!Number.isInteger(deltaMs) || deltaMs < 1 || deltaMs > 1000)
      throw new RangeError('Tick delta must be an integer from 1 to 1000 ms.')
    const transition = this.game.advanceTick(this.state, {
      matchId: this.matchId,
      tick: this.tickSequence + 1,
      stateSequence: this.stateSequence,
      eventSequence: this.eventSequence,
      elapsedMs: this.elapsedMs,
      deltaMs,
    })
    this.state = transition.state
    this.elapsedMs += deltaMs
    this.tickSequence += 1
    this.stateSequence += 1
    this.appendEvents(transition.events)
    this.result = this.game.getResult(this.state)
    if (this.result !== undefined) {
      this.status = 'completed'
      this.appendEvents([
        {
          type: 'match.completed',
          visibility: 'public',
          payload: this.result,
        },
      ])
    }
    this.timeline.push({
      kind: 'tick',
      sequence: this.timeline.length + 1,
      deltaMs,
    })
    await this.recordCheckpoint()
    return true
  }

  private async submitActionSerially(
    submission: ActionSubmission,
    ownerEpoch: number,
  ): Promise<ActionResult> {
    const previous = this.actionResults.get(submission.actionId)
    if (previous !== undefined) {
      return { ...previous, disposition: 'duplicate' }
    }
    if (ownerEpoch !== this.ownershipEpoch) {
      return this.reject(
        submission.actionId,
        'CONTROL_REVOKED',
        'Ownership epoch is stale',
      )
    }
    if (submission.matchId !== this.matchId) {
      return this.reject(
        submission.actionId,
        'INVALID_SCHEMA',
        'Match ID does not match',
      )
    }
    if (this.status !== 'running') {
      return this.reject(
        submission.actionId,
        'MATCH_NOT_RUNNING',
        `Match is ${this.status}`,
      )
    }
    if (
      (this.game.mode === 'turn-based' &&
        submission.basedOnStateSequence !== this.stateSequence) ||
      (this.game.mode !== 'turn-based' &&
        submission.basedOnStateSequence > this.stateSequence)
    ) {
      return this.reject(
        submission.actionId,
        'STALE_OBSERVATION',
        `Expected state sequence ${this.stateSequence}`,
      )
    }
    if (
      this.game.mode !== 'turn-based' &&
      submission.targetTick !== undefined &&
      submission.targetTick < this.tickSequence + 1
    ) {
      return this.reject(
        submission.actionId,
        'TOO_LATE',
        `Expected target tick ${this.tickSequence + 1} or later`,
      )
    }
    if (
      this.game.mode === 'turn-based' &&
      submission.targetTurn !== undefined &&
      submission.targetTurn !== this.stateSequence + 1
    ) {
      return this.reject(
        submission.actionId,
        'TOO_LATE',
        `Expected target turn ${this.stateSequence + 1}`,
      )
    }
    if (!this.roster.some((entry) => entry.seatId === submission.seatId)) {
      return this.reject(
        submission.actionId,
        'CONTROL_REVOKED',
        'Seat is not in this match',
      )
    }

    let action: Action
    try {
      action = this.game.parseAction(submission.payload)
    } catch {
      return this.reject(
        submission.actionId,
        'INVALID_SCHEMA',
        'Action payload is invalid',
      )
    }

    const context = this.context(submission.seatId)
    const rejection = this.game.validateAction(this.state, action, context)
    if (rejection !== undefined) {
      return this.reject(submission.actionId, rejection.code, rejection.detail)
    }

    const transition = this.game.applyAction(this.state, action, context)
    this.state = transition.state
    this.stateSequence += 1
    this.appendEvents(transition.events)
    this.result = this.game.getResult(this.state)
    if (this.result !== undefined) {
      this.status = 'completed'
      this.appendEvents([
        {
          type: 'match.completed',
          visibility: 'public',
          payload: this.result,
        },
      ])
    }
    await this.recordCheckpoint()

    const result: ActionResult = {
      actionId: submission.actionId,
      disposition: 'accepted',
      ...(submission.targetTick === undefined
        ? {}
        : { acceptedForTick: submission.targetTick }),
      ...(submission.targetTurn === undefined
        ? {}
        : { acceptedForTurn: submission.targetTurn }),
      stateSequence: this.stateSequence,
      eventSequence: this.eventSequence,
    }
    this.actionResults.set(submission.actionId, result)
    this.commands.push({
      sequence: this.commands.length + 1,
      action: withoutControlLease(submission),
      result,
    })
    this.timeline.push({
      kind: 'action',
      sequence: this.timeline.length + 1,
      commandSequence: this.commands.length,
    })
    return result
  }

  exportReplay(): Replay {
    return {
      id: replayId(this.matchId),
      matchId: this.matchId,
      releaseId: this.game.releaseId,
      releaseDigest: this.game.releaseDigest,
      runtimeVersion: MATCH_RUNTIME_VERSION,
      seed: this.seed,
      profile: 'replay-v1',
      configuration: this.configuration,
      roster: this.roster.map((entry) => ({ ...entry })),
      commands: [...this.commands],
      timeline: [...this.timeline],
      events: [...this.events],
      checkpoints: [...this.checkpoints],
      finalStateHash: this.stateHash,
      createdAt: this.now().toISOString(),
    }
  }

  private context(seatId: string): GameActionContext {
    return {
      matchId: this.matchId,
      seatId,
      stateSequence: this.stateSequence,
      eventSequence: this.eventSequence,
      authoritativeTime: this.now().toISOString(),
      elapsedMs: this.elapsedMs,
    }
  }

  private reject(
    actionId: string,
    code: ActionErrorCode,
    detail: string,
  ): ActionResult {
    const result: ActionResult = {
      actionId,
      disposition: 'rejected',
      code,
      detail,
      stateSequence: this.stateSequence,
      eventSequence: this.eventSequence,
    }
    this.actionResults.set(actionId, result)
    return result
  }

  private appendEvents(events: readonly GameEventDraft[]): void {
    for (const event of events) {
      this.eventSequence += 1
      this.events.push({
        id: eventId(this.matchId, this.eventSequence),
        matchId: this.matchId,
        sequence: this.eventSequence,
        ...(this.game.mode === 'turn-based'
          ? { turn: this.stateSequence }
          : { tick: this.tickSequence }),
        type: event.type,
        visibility: event.visibility,
        ...(event.audienceId === undefined
          ? {}
          : { audienceId: event.audienceId }),
        at: this.now().toISOString(),
        payload: event.payload,
      })
    }
  }

  private async recordCheckpoint(): Promise<void> {
    const serialized = this.game.serializeState(this.state)
    this.stateHash = await sha256(canonicalJson(serialized))
    this.checkpoints.push({
      stateSequence: this.stateSequence,
      eventSequence: this.eventSequence,
      state: serialized,
      stateHash: this.stateHash,
    })
  }
}

async function replayInto<State, Action>(
  match: AuthoritativeMatch<State, Action>,
  replay: Replay,
  controlLease: string,
  afterStep?: (stateSequence: number, stateHash: string) => void,
): Promise<void> {
  const commands = new Map(
    replay.commands.map((command) => [command.sequence, command]),
  )
  const timeline =
    replay.timeline ??
    replay.commands.map((command, index) => ({
      kind: 'action' as const,
      sequence: index + 1,
      commandSequence: command.sequence,
    }))
  for (const step of timeline) {
    if (step.kind === 'tick') {
      if (!(await match.advanceTick(step.deltaMs))) break
    } else {
      const command = commands.get(step.commandSequence)
      if (!command) throw new Error('Replay timeline references no command.')
      const result = await match.submitAction(
        { ...command.action, controlLease },
        match.getOwnershipEpoch(),
      )
      if (result.disposition !== 'accepted') break
    }
    if (afterStep) {
      const snapshot = await match.snapshot()
      afterStep(snapshot.stateSequence, snapshot.stateHash)
    }
  }
}

export async function verifyReplay<State, Action>(
  game: GameDefinition<State, Action>,
  replay: Replay,
): Promise<ReplayVerification> {
  if (
    replay.releaseId !== game.releaseId ||
    replay.releaseDigest !== game.releaseDigest ||
    replay.runtimeVersion !== MATCH_RUNTIME_VERSION
  ) {
    return {
      valid: false,
      checkedCheckpoints: 0,
      mismatches: [
        {
          stateSequence: 0,
          expected: replay.releaseDigest,
          actual: game.releaseDigest,
        },
      ],
    }
  }

  const match = await AuthoritativeMatch.create({
    matchId: replay.matchId,
    game,
    seed: replay.seed,
    configuration: replay.configuration,
    roster: replay.roster,
    now: () => new Date(0),
  })
  match.start()
  const actualHashes = new Map<number, string>()
  actualHashes.set(0, (await match.snapshot()).stateHash)

  await replayInto(
    match,
    replay,
    'replay-verification-lease',
    (stateSequence, stateHash) => actualHashes.set(stateSequence, stateHash),
  )

  const mismatches = replay.checkpoints.flatMap((checkpoint) => {
    const actual = actualHashes.get(checkpoint.stateSequence)
    return actual === checkpoint.stateHash
      ? []
      : [
          {
            stateSequence: checkpoint.stateSequence,
            expected: checkpoint.stateHash,
            ...(actual === undefined ? {} : { actual }),
          },
        ]
  })
  const finalHash = actualHashes.get(
    Math.max(
      ...replay.checkpoints.map((checkpoint) => checkpoint.stateSequence),
    ),
  )
  if (finalHash !== replay.finalStateHash && mismatches.length === 0) {
    mismatches.push({
      stateSequence: replay.checkpoints.at(-1)?.stateSequence ?? 0,
      expected: replay.finalStateHash,
      ...(finalHash === undefined ? {} : { actual: finalHash }),
    })
  }

  return {
    valid: mismatches.length === 0,
    checkedCheckpoints: replay.checkpoints.length,
    mismatches,
  }
}
