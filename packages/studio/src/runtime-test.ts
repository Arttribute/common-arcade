import { AuthoritativeMatch } from '@common-arcade/match-runtime'
import { canonicalJson, sha256 } from '@common-arcade/manifest'
import {
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

/** A bounded, DOM-free test of the same authoritative runtime used by live matches. */
export async function testGameRuntime(
  document: GameDocument,
  digest: string,
  input: RuntimeTestInput = {},
) {
  if (!isManagedBrowserGame(document))
    throw new Error('Headless tests require an authoritative runtime.')
  const steps = input.steps ?? 60
  if (!Number.isInteger(steps) || steps < 1 || steps > 600)
    throw new Error('steps must be between 1 and 600.')
  const roster = (
    document.play?.roles ?? [
      { id: 'player', count: document.play?.seats.default ?? 2 },
    ]
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
      action.step >= steps ||
      !Number.isInteger(action.seat) ||
      action.seat < 0 ||
      action.seat >= roster.length
    )
      throw new Error(
        'Scripted inputs need a valid zero-based step and seat index.',
      )
  const started = performance.now()
  const deadline = started + 10_000
  const costs: number[] = []
  const warnings = new Set<string>()
  const observationHashes: string[][] = []
  const runs = []
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
    for (
      let step = 0;
      step < steps && match.getStatus() === 'running';
      step++
    ) {
      if (performance.now() > deadline)
        throw new Error(
          'Headless test exceeded 10 seconds. Reduce steps or runtime cost.',
        )
      const tickStarted = performance.now()
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
            perception.horizonMs <
              1000 / (document.play?.maxDecisionsPerSecond ?? 2)
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
          if (
            game.advanceTick &&
            step %
              Math.max(
                1,
                Math.round(
                  document.runtime.tickRate /
                    (document.play?.maxDecisionsPerSecond ?? 2),
                ),
              ) !==
              0
          )
            return []
          const action = match.observation(seat.seatId).legalActions[0]
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
      if (game.advanceTick)
        await match.advanceTick(
          Math.max(1, Math.round(1000 / document.runtime.tickRate)),
        )
      if (attempt === 0) costs.push(performance.now() - tickStarted)
    }
    observationHashes.push(observations)
    runs.push({ match, game })
  }
  const replay = runs[0]!.match.exportReplay()
  const second = runs[1]!.match.exportReplay()
  const deterministic =
    replay.finalStateHash === second.finalStateHash &&
    canonicalJson(observationHashes[0]!) ===
      canonicalJson(observationHashes[1]!)
  // Compare every saved checkpoint as well as the final state, rather than trusting a final-state-only assertion.
  const checkpointsMatch =
    canonicalJson(replay.checkpoints) === canonicalJson(second.checkpoints)
  costs.sort((a, b) => a - b)
  const frameBudgetMs = ['realtime', 'hybrid'].includes(
    document.play?.mode ?? '',
  )
    ? 1000 / document.runtime.tickRate
    : 1000 / (document.play?.maxDecisionsPerSecond ?? 2)
  const p95 =
    costs[Math.min(costs.length - 1, Math.floor(costs.length * 0.95))] ?? 0
  if (p95 > frameBudgetMs)
    warnings.add('The p95 runtime step cost exceeds the simulation interval.')
  return {
    kind: 'runtime-test' as const,
    deterministic: deterministic && checkpointsMatch,
    steps: costs.length,
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
