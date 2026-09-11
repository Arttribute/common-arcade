import { z } from 'zod'
import {
  isBrowserGame,
  isManagedBrowserGame,
  resolveGameConfiguration,
  type BrowserGameDocument,
  type GameDocument,
} from '@common-arcade/studio'
import {
  MAX_GAME_CONFIGURATION_STRING_LENGTH,
  type JsonValue,
} from '@common-arcade/protocol'
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
  const configuration = resolveGameConfiguration(
    isBrowserGame(document) ? document.configurationSchema : undefined,
    {},
  )
  const roles = isBrowserGame(document)
    ? declaredRoles(document)
    : [{ id: 'player', count: 2 }]
  const roster = rosterFromCounts(
    roles,
    roles.map((role) => role.count),
    'default',
  )
  const setups: ValidationSetup[] = [
    { label: 'default setup', roster, configuration },
  ]
  if (isBrowserGame(document)) {
    setups.push(
      {
        label: 'minimum roster',
        roster: rosterAtLimit(document, 'min'),
        configuration,
      },
      {
        label: 'maximum roster',
        roster: rosterAtLimit(document, 'max'),
        configuration,
      },
      ...roleRosterVariants(document, configuration),
      ...configurationVariants(document, roster, configuration),
    )
  }

  const seen = new Set<string>()
  for (const setup of setups) {
    const key = JSON.stringify([
      setup.roster.map(({ role, team }) => ({ role, team })),
      setup.configuration,
    ])
    if (seen.has(key)) continue
    seen.add(key)
    try {
      validatePlayableSetup(game, document, setup)
    } catch (error) {
      throw new Error(
        `The game cannot play its ${setup.label}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
}

type CompiledGame = Awaited<ReturnType<typeof compileGame>>
type ValidationRole = {
  id: string
  count: number
  minCount?: number
  maxCount?: number
  team?: string
}
type ValidationRoster = Array<{
  seatId: string
  role: string
  team?: string
}>
type ValidationSetup = {
  label: string
  roster: ValidationRoster
  configuration: Record<string, JsonValue>
}

function validatePlayableSetup(
  game: CompiledGame,
  document: GameDocument,
  setup: ValidationSetup,
) {
  const matchId = 'mat_runtime_validation'
  const { roster, configuration } = setup
  let state = game.initialize({
    matchId,
    seed: 'arcade-validation-seed',
    configuration,
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

function declaredRoles(document: BrowserGameDocument): ValidationRole[] {
  const seats = document.play?.seats ?? { min: 1, max: 2, default: 2 }
  return (
    document.play?.roles ?? [
      {
        id: 'player',
        count: seats.default,
        minCount: seats.min,
        maxCount: seats.max,
      },
    ]
  )
}

function rosterFromCounts(
  roles: ValidationRole[],
  counts: number[],
  label: string,
): ValidationRoster {
  return roles
    .flatMap((role, roleIndex) =>
      Array.from({ length: counts[roleIndex]! }, () => ({
        role: role.id,
        ...(role.team ? { team: role.team } : {}),
      })),
    )
    .map((seat, index) => ({
      ...seat,
      seatId:
        label === 'default'
          ? `sea_validation_${index + 1}`
          : `sea_validation_${label}_${index + 1}`,
    }))
}

function rosterAtLimit(document: BrowserGameDocument, limit: 'min' | 'max') {
  const seatRange = document.play?.seats ?? { min: 1, max: 2, default: 2 }
  const roles = declaredRoles(document)
  const target = seatRange[limit]
  const counts = roles.map((role) => role.minCount ?? role.count)
  let remaining = target - counts.reduce((sum, count) => sum + count, 0)
  for (let index = 0; index < roles.length && remaining > 0; index++) {
    const role = roles[index]!
    const available = (role.maxCount ?? role.count) - counts[index]!
    const added = Math.min(available, remaining)
    counts[index]! += added
    remaining -= added
  }
  if (remaining !== 0)
    throw new Error(`Role ranges cannot produce the ${limit}imum roster.`)
  return rosterFromCounts(roles, counts, limit)
}

function roleRosterVariants(
  document: BrowserGameDocument,
  configuration: Record<string, JsonValue>,
): ValidationSetup[] {
  const seats = document.play?.seats ?? { min: 1, max: 2, default: 2 }
  const roles = declaredRoles(document)
  const variants: ValidationSetup[] = []
  for (const [targetIndex, role] of roles.entries()) {
    for (const limit of ['min', 'max'] as const) {
      const count =
        limit === 'min'
          ? (role.minCount ?? role.count)
          : (role.maxCount ?? role.count)
      if (count === role.count) continue
      const counts = roles.map((candidate) => candidate.count)
      counts[targetIndex] = count
      let total = counts.reduce((sum, value) => sum + value, 0)
      const needsIncrease = total < seats.min
      const targetTotal = needsIncrease ? seats.min : seats.max
      for (
        let index = 0;
        index < roles.length && total !== targetTotal;
        index++
      ) {
        if (index === targetIndex) continue
        const candidate = roles[index]!
        if (needsIncrease) {
          const added = Math.min(
            (candidate.maxCount ?? candidate.count) - counts[index]!,
            targetTotal - total,
          )
          counts[index]! += added
          total += added
        } else if (total > seats.max) {
          const removed = Math.min(
            counts[index]! - (candidate.minCount ?? candidate.count),
            total - targetTotal,
          )
          counts[index]! -= removed
          total -= removed
        }
      }
      if (total < seats.min || total > seats.max)
        throw new Error(
          `Role "${role.id}" cannot use its declared ${limit}Count within the supported seat range.`,
        )
      variants.push({
        label: `${role.id} role ${limit}imum`,
        roster: rosterFromCounts(roles, counts, `role_${targetIndex}_${limit}`),
        configuration,
      })
    }
  }
  return variants
}

function configurationVariants(
  document: BrowserGameDocument,
  roster: ValidationRoster,
  defaults: Record<string, JsonValue>,
): ValidationSetup[] {
  if (!document.configurationSchema) return []
  const variants: ValidationSetup[] = []
  const add = (name: string, label: string, value: JsonValue) => {
    const configuration = resolveGameConfiguration(
      document.configurationSchema,
      { ...defaults, [name]: value },
    )
    variants.push({ label, roster, configuration })
  }
  for (const [name, property] of Object.entries(
    document.configurationSchema.properties,
  )) {
    if ('enum' in property && property.enum) {
      for (const [index, value] of property.enum.entries())
        add(name, `${name} option ${index + 1}`, value)
      continue
    }
    if (property.type === 'boolean') {
      add(name, `${name} alternate`, !property.default)
      continue
    }
    if (property.type === 'string') {
      add(name, `${name} minimum length`, 'x'.repeat(property.minLength ?? 0))
      add(
        name,
        `${name} maximum length`,
        'x'.repeat(property.maxLength ?? MAX_GAME_CONFIGURATION_STRING_LENGTH),
      )
      continue
    }
    const candidates = new Set<number>()
    if (property.minimum !== undefined) {
      candidates.add(property.minimum)
      if (property.multipleOf)
        candidates.add(
          Math.ceil(property.minimum / property.multipleOf) *
            property.multipleOf,
        )
    }
    if (property.maximum !== undefined) {
      candidates.add(property.maximum)
      if (property.multipleOf)
        candidates.add(
          Math.floor(property.maximum / property.multipleOf) *
            property.multipleOf,
        )
    }
    for (const [index, value] of [...candidates].entries()) {
      try {
        add(name, `${name} numeric boundary ${index + 1}`, value)
      } catch {
        // A raw inclusive bound may not itself satisfy multipleOf.
      }
    }
  }
  return variants
}
