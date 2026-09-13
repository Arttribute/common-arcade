import { AuthoritativeMatch } from '@common-arcade/match-runtime'
import { canonicalJson, sha256 } from '@common-arcade/manifest'
import {
  isBrowserGame,
  isManagedBrowserGame,
  type GameDocument,
  type JsonValue,
} from '@common-arcade/protocol'
import { compileGame } from './runtime.js'

export interface RuntimeTestInput {
  seed?: string
  steps?: number
  configuration?: JsonValue
  actions?: { step: number; seat: number; action: JsonValue }[]
}

export interface RuntimeTestOptions {
  /** Wall-clock budget shared by both determinism attempts. */
  readonly budgetMs?: number
  /** Clock in milliseconds; injectable for tests. */
  readonly now?: () => number
}

/** Default wall-clock budget for one headless test request. */
export const RUNTIME_TEST_BUDGET_MS = 10_000

/**
 * A bounded, DOM-free test of the same authoritative runtime used by live
 * matches. It is genre-independent: any document with authoritative rules is
 * tested the same way, whatever its mode, seat count, roles or controls.
 *
 * Both attempts run the same number of steps. When the first attempt cannot
 * reach the requested step count inside half the budget, it stops early and the
 * second attempt stops at the same step, so a slow or long game still gets a
 * determinism and timing report for the steps that ran instead of a failure.
 */
export async function testGameRuntime(
  document: GameDocument,
  digest: string,
  input: RuntimeTestInput = {},
  options: RuntimeTestOptions = {},
) {
  if (isBrowserGame(document) && !isManagedBrowserGame(document))
    throw new Error(
      'Headless tests need authoritative rules. Add a runtime block to make this a live game, or use browser playtests for a preview-only game.',
    )
  const play = isBrowserGame(document) ? document.play : undefined
  const tickRate = isManagedBrowserGame(document)
    ? document.runtime.tickRate
    : undefined
  const decisionsPerSecond = play?.maxDecisionsPerSecond ?? 2
  const mode = play?.mode ?? 'turn-based'
  const requestedSteps = input.steps ?? 60
  if (
    !Number.isInteger(requestedSteps) ||
    requestedSteps < 1 ||
    requestedSteps > 600
  )
    throw new Error('steps must be between 1 and 600.')
  const roster = (
    play?.roles ?? [{ id: 'player', count: play?.seats.default ?? 2 }]
  )
    .flatMap((role) =>
      Array.from({ length: role.count }, () => ({
        role: role.id,
        ...('team' in role && role.team ? { team: role.team } : {}),
      })),
    )
    .map((seat, index) => ({ ...seat, seatId: `sea_test_${index + 1}` }))
  for (const action of input.actions ?? [])
    if (
      !Number.isInteger(action.step) ||
      action.step < 0 ||
      action.step >= requestedSteps ||
      !Number.isInteger(action.seat) ||
      action.seat < 0 ||
      action.seat >= roster.length
    )
      throw new Error(
        'Scripted inputs need a valid zero-based step and seat index.',
      )
  const budgetMs = options.budgetMs ?? RUNTIME_TEST_BUDGET_MS
  const now = options.now ?? (() => performance.now())
  const started = now()
  const decisionEvery = tickRate
    ? Math.max(1, Math.round(tickRate / decisionsPerSecond))
    : 1
  const costs: number[] = []
  const warnings = new Set<string>()
  const observationHashes: string[][] = []
  const runs = []
  let stepLimit = requestedSteps
  for (let attempt = 0; attempt < 2; attempt++) {
    const game = await compileGame(document, 'rel_runtime_test', digest)
    const match = await AuthoritativeMatch.create({
      game,
      matchId: 'mat_runtime_test',
      seed: input.seed ?? 'arcade-test',
      configuration: input.configuration ?? {},
      roster,
      now: () => new Date(0),
    })
    match.start()
    const observations: string[] = []
    let sequence = 0
    let executed = 0
    const seatDecisions = roster.map(() => 0)
    for (
      let step = 0;
      step < stepLimit && match.getStatus() === 'running';
      step++
    ) {
      if (attempt === 0 && step > 0 && now() - started > budgetMs / 2) {
        stepLimit = step
        break
      }
      if (attempt === 1 && now() - started > budgetMs)
        throw new Error(
          `Headless test exceeded ${budgetMs / 1000} seconds. Reduce steps or runtime cost.`,
        )
      const tickStarted = now()
      for (const seat of roster) {
        const observation = match.observation(seat.seatId)
        observations.push(await sha256(canonicalJson(observation)))
        if (observation.feedback == null)
          warnings.add(
            'Emit per-seat observation.feedback so agents can measure the effects of their actions.',
          )
        const state = observation.visibleState
        if (state && typeof state === 'object' && !Array.isArray(state)) {
          const perception = state.perception
          if (
            perception &&
            typeof perception === 'object' &&
            !Array.isArray(perception) &&
            typeof perception.horizonMs === 'number' &&
            perception.horizonMs < 1000 / decisionsPerSecond
          )
            warnings.add(
              'Observation perception.horizonMs is shorter than one agent decision interval.',
            )
        }
      }
      const scripted = input.actions?.filter((action) => action.step === step)
      const actions =
        scripted ??
        roster.flatMap((seat, index) => {
          if (game.advanceTick && step % decisionEvery !== 0) return []
          const legal = match.observation(seat.seatId).legalActions
          const action = legal[seatDecisions[index]!++ % legal.length]
          return action === undefined ? [] : [{ seat: index, action }]
        })
      for (const entry of actions) {
        const seat = roster[entry.seat]!
        const observation = match.observation(seat.seatId)
        const result = await match.submitAction(
          {
            actionId: `act_runtime_${++sequence}`,
            matchId: match.matchId,
            seatId: seat.seatId,
            controlLease: 'headless-test',
            clientSequence: sequence,
            basedOnStateSequence: observation.stateSequence,
            payload: entry.action,
          },
          match.getOwnershipEpoch(),
        )
        if (input.actions && result.disposition === 'rejected')
          throw new Error(`Step ${step}, seat ${entry.seat}: ${result.detail}`)
      }
      if (game.advanceTick && tickRate)
        await match.advanceTick(Math.max(1, Math.round(1000 / tickRate)))
      executed++
      if (attempt === 0) costs.push(now() - tickStarted)
    }
    observationHashes.push(observations)
    runs.push({ match, executed })
  }
  const replay = runs[0]!.match.exportReplay()
  const second = runs[1]!.match.exportReplay()
  const deterministic =
    runs[0]!.executed === runs[1]!.executed &&
    replay.finalStateHash === second.finalStateHash &&
    canonicalJson(observationHashes[0]!) ===
      canonicalJson(observationHashes[1]!)
  // Compare every saved checkpoint as well as the final state, rather than trusting a final-state-only assertion.
  const checkpointsMatch =
    canonicalJson(replay.checkpoints) === canonicalJson(second.checkpoints)
  const truncated =
    runs[0]!.executed < requestedSteps &&
    runs[0]!.match.getStatus() === 'running'
  if (truncated)
    warnings.add(
      `Stopped after ${runs[0]!.executed} of ${requestedSteps} steps to stay within the ${budgetMs / 1000}-second test budget; determinism and timing cover the steps that ran. Test later phases with scripted actions, fewer steps, or a local run.`,
    )
  costs.sort((a, b) => a - b)
  const frameBudgetMs =
    ['realtime', 'hybrid'].includes(mode) && tickRate
      ? 1000 / tickRate
      : 1000 / decisionsPerSecond
  const p95 =
    costs[Math.min(costs.length - 1, Math.floor(costs.length * 0.95))] ?? 0
  if (p95 > frameBudgetMs)
    warnings.add('The p95 runtime step cost exceeds the simulation interval.')
  return {
    kind: 'runtime-test' as const,
    deterministic: deterministic && checkpointsMatch,
    steps: costs.length,
    requestedSteps,
    truncated,
    seatCount: roster.length,
    status: runs[0]!.match.getStatus(),
    timing: {
      medianMs: costs[Math.floor(costs.length / 2)] ?? 0,
      p95Ms: p95,
      maximumMs: costs.at(-1) ?? 0,
      simulationBudgetMs: frameBudgetMs,
      includes: 'tick, actions, and all seat observations',
      perSeatMs: p95 / roster.length,
    },
    warnings: [...warnings],
    replay,
    replayDiff: checkpointsMatch
      ? []
      : replay.checkpoints
          .filter(
            (checkpoint, index) =>
              checkpoint.stateHash !== second.checkpoints[index]?.stateHash,
          )
          .map((checkpoint) => ({ stateSequence: checkpoint.stateSequence })),
    result: (await runs[0]!.match.snapshot()).result ?? null,
  }
}
