import { z } from 'zod'
import {
  isBrowserGame,
  isManagedBrowserGame,
  type GameDocument,
} from '@common-arcade/studio'
import { compileGame } from '@common-arcade/studio/runtime'

/** Exercise the contract shared by human controls and agent policies. */
export async function smokeTestRuntime(document: GameDocument, digest: string) {
  try {
    await validateRuntime(document, digest)
  } catch (error) {
    throw new z.ZodError([
      {
        code: 'custom',
        path: ['document', 'runtime'],
        message: error instanceof Error ? error.message : String(error),
      },
    ])
  }
}

async function validateRuntime(document: GameDocument, digest: string) {
  const game = await compileGame(document, 'rel_validation', digest)
  const roles = isBrowserGame(document) ? document.play?.roles : undefined
  const roster = (
    roles ?? [
      {
        id: 'player',
        count: isBrowserGame(document)
          ? (document.play?.seats.default ?? 2)
          : 2,
      },
    ]
  )
    .flatMap((role) =>
      Array.from({ length: role.count }, () => ({
        role: role.id,
        ...('team' in role && role.team ? { team: role.team } : {}),
      })),
    )
    .map((seat, i) => ({ ...seat, seatId: `sea_validation_${i + 1}` }))
  const matchId = 'mat_runtime_validation'
  let state = game.initialize({
    matchId,
    seed: 'arcade-validation-seed',
    configuration: {},
    roster,
  })
  let stateSequence = 0,
    eventSequence = 0,
    elapsedMs = 0
  const acted = new Set<string>()
  const deltaMs =
    1000 / (isManagedBrowserGame(document) ? document.runtime.tickRate : 30)
  game.serializeState(state)
  if (game.getResult(state))
    throw new Error(
      'The game ends at initialization; players must be able to play before it ends.',
    )
  // Allow a short countdown/cooldown, while bounding validation work.
  const maxSteps = game.advanceTick
    ? Math.ceil(5_000 / deltaMs)
    : roster.length * 4
  for (let step = 0; step < maxSteps; step++) {
    let moved = false
    for (const seat of roster) {
      const context = {
        matchId,
        seatId: seat.seatId,
        stateSequence,
        eventSequence,
        elapsedMs,
        authoritativeTime: new Date(elapsedMs).toISOString(),
      }
      const observation = game.projectObservation(state, seat.seatId, context)
      const candidate = observation.legalActions[0]
      if (candidate === undefined) continue
      for (const advertised of observation.legalActions) {
        const rejection = game.validateAction(
          state,
          game.parseAction(advertised),
          context,
        )
        if (rejection)
          throw new Error(
            `Seat ${seat.seatId} advertises an illegal action: ${rejection.detail}. Make observe().legalActions agree with validateAction().`,
          )
      }
      // Opaque IDs must be checked by the rules too. A fallback-to-home game
      // can advertise moves for both seats while routing every move to one player.
      if (
        !game.validateAction(state, game.parseAction(candidate), {
          ...context,
          seatId: 'sea_unregistered_probe',
        })
      )
        throw new Error(
          'The runtime accepts actions for an unregistered seat. Initialize players from context.roster and reject unknown context.seatId values.',
        )
      const action = game.parseAction(candidate)
      const applied = game.applyAction(state, action, context)
      state = applied.state
      stateSequence++
      eventSequence += applied.events.length
      moved = true
      acted.add(seat.seatId)
      game.serializeState(state)
      if (game.getResult(state)) return
    }
    if (game.advanceTick) {
      const next = game.advanceTick(state, {
        matchId,
        tick: step + 1,
        stateSequence,
        eventSequence,
        elapsedMs,
        deltaMs,
      })
      state = next.state
      elapsedMs += deltaMs
      stateSequence++
      eventSequence += next.events.length
      game.serializeState(state)
      if (game.getResult(state)) {
        if (!acted.size)
          throw new Error('The game ends before any player has a legal action.')
        return
      }
    } else if (!moved) {
      throw new Error(
        'The game is not terminal, but no seat has a legal action. Repair the turn transition or expose a legal waiting action.',
      )
    }
    if (acted.size === roster.length) return
  }
  const missing = roster
    .filter((s) => !acted.has(s.seatId))
    .map((s) => s.seatId)
  throw new Error(
    `No playable action was reached for ${missing.join(', ')}. Return concrete legalActions for each active player within the five-second runtime smoke test.`,
  )
}
