import {
  DiagnosticTimeline,
  type DiagnosticRecord,
} from '@common-arcade/diagnostics'
import {
  ticTacToeGame,
  type PlaceAction,
  type TicTacToeState,
} from '@common-arcade/example-tic-tac-toe'
import {
  AuthoritativeMatch,
  type RuntimeSnapshot,
  type GameDefinition,
} from '@common-arcade/match-runtime'
import {
  ARCADE_API_VERSION,
  type ActionResult,
  type JsonValue,
  type Replay,
} from '@common-arcade/protocol'
import {
  compilePolicy,
  type CompiledPolicy,
  type PolicyIr,
} from '@common-arcade/policy-ir'
import {
  DeterministicPolicyRuntime,
  type PolicyDecision,
} from '@common-arcade/policy-runtime'

export interface TestSeatController {
  readonly seatId: string
  readonly policy: CompiledPolicy
}

export interface CreateTestRunInput {
  readonly runId?: string
  readonly matchId?: string
  readonly seed: string
  readonly game?: GameDefinition<TicTacToeState, PlaceAction>
  readonly controllers: readonly TestSeatController[]
  readonly now?: () => Date
}

export interface TestStep {
  readonly seatId: string
  readonly decision: PolicyDecision
  readonly result: ActionResult
}

export interface TestRunResult {
  readonly runId: string
  readonly matchId: string
  readonly status: RuntimeSnapshot<TicTacToeState>['status']
  readonly result?: JsonValue
  readonly steps: number
  readonly replay: Replay
  readonly diagnostics: readonly DiagnosticRecord[]
}

function opaque(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

export class TicTacToeTestRun {
  readonly runId: string
  readonly matchId: string
  readonly timeline: DiagnosticTimeline
  private readonly runtime: AuthoritativeMatch<TicTacToeState, PlaceAction>
  private readonly controllers: Map<string, DeterministicPolicyRuntime>
  private readonly now: () => Date
  private steps = 0

  private constructor(
    input: CreateTestRunInput,
    runtime: AuthoritativeMatch<TicTacToeState, PlaceAction>,
  ) {
    this.runId = input.runId ?? opaque('tst')
    this.matchId = input.matchId ?? runtime.matchId
    this.runtime = runtime
    this.controllers = new Map(
      input.controllers.map((controller) => [
        controller.seatId,
        new DeterministicPolicyRuntime(controller.policy),
      ]),
    )
    this.now = input.now ?? (() => new Date())
    this.timeline = new DiagnosticTimeline(20_000, this.now)
  }

  static async create(input: CreateTestRunInput): Promise<TicTacToeTestRun> {
    if (input.controllers.length !== 2)
      throw new Error('Tic-tac-toe Test Arena requires exactly two controllers')
    const matchId = input.matchId ?? opaque('mat')
    const runtime = await AuthoritativeMatch.create({
      matchId,
      game: input.game ?? ticTacToeGame,
      seed: input.seed,
      configuration: {},
      roster: input.controllers.map((controller) => ({
        seatId: controller.seatId,
        role: 'player',
      })),
      now: input.now,
    })
    runtime.start()
    return new TicTacToeTestRun({ ...input, matchId }, runtime)
  }

  async step(): Promise<TestStep | undefined> {
    const snapshot = await this.runtime.snapshot()
    if (snapshot.status !== 'running') return undefined
    const observations = [...this.controllers.keys()].map((seatId) =>
      this.runtime.observation(seatId),
    )
    const observation = observations.find(
      (candidate) => candidate.legalActions.length > 0,
    )
    if (observation === undefined)
      throw new Error('Running match produced no actionable observation')
    const controller = this.controllers.get(observation.seatId)
    if (controller === undefined)
      throw new Error(`No policy controls seat ${observation.seatId}`)

    this.timeline.append({
      runId: this.runId,
      matchId: this.matchId,
      turn: observation.turn,
      gameTimeMs: this.steps,
      source: {
        kind: 'agent',
        id: observation.seatId,
        seatId: observation.seatId,
      },
      visibility: 'test-owner',
      category: 'policy',
      level: 'info',
      type: 'agent.observation.delivered',
      summary: `${observation.seatId} received observation ${observation.stateSequence}.`,
      data: observation as unknown as JsonValue,
      correlation: { observationSequence: observation.stateSequence },
    })

    const decision = controller.decide(observation)
    this.timeline.append({
      runId: this.runId,
      matchId: this.matchId,
      turn: observation.turn,
      gameTimeMs: this.steps,
      source: {
        kind: 'policy',
        id: controller.policy.digest,
        seatId: observation.seatId,
      },
      visibility: 'test-owner',
      category: 'policy',
      level: 'info',
      type: 'policy.decision.made',
      summary: decision.explanation,
      data: decision as unknown as JsonValue,
      correlation: { observationSequence: observation.stateSequence },
    })
    if (decision.action === undefined)
      throw new Error(`Policy for ${observation.seatId} produced no action`)

    this.steps += 1
    const actionId = `act_${this.runId.slice(4)}_${this.steps.toString().padStart(4, '0')}`
    const result = await this.runtime.submitAction(
      {
        actionId,
        matchId: this.matchId,
        seatId: observation.seatId,
        controlLease: `test-arena-lease-${observation.seatId}`,
        clientSequence: this.steps,
        basedOnStateSequence: observation.stateSequence,
        targetTurn: observation.turn,
        payload: decision.action,
        policyExecutionId: controller.policy.digest,
      },
      1,
    )
    this.timeline.append({
      runId: this.runId,
      matchId: this.matchId,
      turn: observation.turn,
      gameTimeMs: this.steps,
      source: { kind: 'runtime', id: 'tic-tac-toe-authority' },
      visibility: 'test-owner',
      category: 'runtime',
      level: result.disposition === 'accepted' ? 'info' : 'warn',
      type: 'runtime.action.resolved',
      summary: `${actionId} was ${result.disposition}.`,
      data: result as unknown as JsonValue,
      correlation: {
        observationSequence: observation.stateSequence,
        actionId,
      },
    })
    return { seatId: observation.seatId, decision, result }
  }

  async runToCompletion(maxSteps = 64): Promise<TestRunResult> {
    while ((await this.runtime.snapshot()).status === 'running') {
      if (this.steps >= maxSteps)
        throw new Error('Test run step limit exceeded')
      await this.step()
    }
    return this.result()
  }

  async result(): Promise<TestRunResult> {
    const snapshot = await this.runtime.snapshot()
    return {
      runId: this.runId,
      matchId: this.matchId,
      status: snapshot.status,
      ...(snapshot.result === undefined ? {} : { result: snapshot.result }),
      steps: this.steps,
      replay: this.runtime.exportReplay(),
      diagnostics: this.timeline.query(),
    }
  }
}

export async function createPreferencePolicy(input: {
  readonly id: string
  readonly name: string
  readonly preferredCells: readonly number[]
  readonly releaseId?: string
}): Promise<CompiledPolicy> {
  const source: PolicyIr = {
    apiVersion: ARCADE_API_VERSION,
    kind: 'Policy',
    metadata: { id: input.id, name: input.name, version: '0.1.0' },
    spec: {
      compatible: {
        releaseIds: [input.releaseId ?? 'rel_tictactoe1'],
        profiles: ['policy-v1'],
      },
      initialState: 'playing',
      initialMemory: {},
      states: {
        playing: {
          onObservation: [
            {
              id: 'choose-preferred-cell',
              when: 'true',
              select: {
                kind: 'prefer-legal',
                actions: input.preferredCells.map((cell) => ({
                  type: 'place',
                  cell,
                })),
              },
              priority: 100,
              cooldownSteps: 0,
              explanation: 'Selected the highest-ranked currently legal cell.',
            },
          ],
        },
      },
      fallback: { kind: 'first-legal' },
      budget: { maxSteps: 100, maxActionsPerStep: 1, memoryKiB: 16 },
    },
  }
  return compilePolicy(source)
}

export const testArenaStatus = {
  stability: 'v0alpha1',
  runners: ['tic-tac-toe-policy-vs-policy'],
  timelineAvailable: true,
  controls: ['step', 'run-to-completion'],
} as const
