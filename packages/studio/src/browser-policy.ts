import type { ExecutableStrategy } from './coached-strategy.js'
export type BrowserFeedback = {
  actionId: string
  outcome: 'positive' | 'negative' | 'neutral' | 'unknown'
  reward: number
  summary: string
  observedAfterMs: number
  metrics: Record<string, number>
}
export type BrowserController = {
  seatId: string
  strategy: string
  executableStrategy?: ExecutableStrategy
  policyMemory?: {
    preferredDefense?: string
    actions: Record<
      string,
      { samples: number; totalReward: number; meanReward: number }
    >
    lastLesson?: string
  }
}

// Self-contained so the exact same policy can run inside an opaque preview frame.
// No host state, credentials, network, or game internals are captured.
export function createBrowserPolicy() {
  function actionVerb(actionId: string): string {
    const encoded = actionId.split(':').at(-1) ?? actionId
    try {
      return decodeURIComponent(encoded).split(':')[0]!.toLowerCase()
    } catch {
      return encoded.split(':')[0]!.toLowerCase()
    }
  }

  function learnFromFeedback(
    controller: BrowserController,
    feedback?: BrowserFeedback,
  ): {
    memory: NonNullable<BrowserController['policyMemory']>
    preferenceChanged: boolean
  } {
    const before = controller.policyMemory ?? { actions: {} }
    if (!feedback) return { memory: before, preferenceChanged: false }
    const verb = actionVerb(feedback.actionId)
    // An unknown outcome is not evidence. Recording it as a zero-reward sample
    // made the old policy "explore" every control (including brake/restart) and
    // then permanently prefer the alphabetically first action when all samples
    // tied. Keep the diagnostic lesson, but do not train on absent feedback.
    if (feedback.outcome === 'unknown')
      return {
        memory: {
          ...before,
          lastLesson: `${verb} has no attributable feedback yet: ${feedback.summary}`,
        },
        preferenceChanged: false,
      }
    const current = before.actions[verb] ?? {
      samples: 0,
      totalReward: 0,
      meanReward: 0,
    }
    const samples = current.samples + 1
    const totalReward = current.totalReward + feedback.reward
    const actions = {
      ...before.actions,
      [verb]: { samples, totalReward, meanReward: totalReward / samples },
    }
    let preferredDefense = before.preferredDefense
    if (
      ['jump', 'duck', 'dodge', 'block'].includes(verb) &&
      feedback.outcome === 'positive'
    ) {
      const ranked = Object.entries(actions)
        .filter(([name]) => ['jump', 'duck', 'dodge', 'block'].includes(name))
        .sort(
          ([leftName, left], [rightName, right]) =>
            right.meanReward - left.meanReward ||
            right.samples - left.samples ||
            leftName.localeCompare(rightName),
        )
      preferredDefense = ranked[0]?.[0]
    }
    const lesson = `${verb} produced ${feedback.outcome} feedback (${feedback.reward >= 0 ? '+' : ''}${feedback.reward.toFixed(2)}): ${feedback.summary}`
    return {
      memory: {
        ...before,
        actions,
        ...(preferredDefense ? { preferredDefense } : {}),
        lastLesson: lesson,
      },
      preferenceChanged:
        preferredDefense !== undefined &&
        preferredDefense !== before.preferredDefense,
    }
  }

  function chooseRealtimePolicyAction(
    observation: { state: unknown; actions: { id: string; label: string }[] },
    controller: BrowserController,
    step: number,
  ): { actionId: string; reason: string; learning?: unknown } {
    const available = observation.actions
    const state =
      observation.state && typeof observation.state === 'object'
        ? (observation.state as Record<string, unknown>)
        : {}
    const context =
      state.arcadeDecisionContext &&
      typeof state.arcadeDecisionContext === 'object'
        ? (state.arcadeDecisionContext as Record<string, unknown>)
        : {}
    const threats = Array.isArray(context.incomingThreats)
      ? context.incomingThreats
      : []
    const imminent = threats
      .filter(
        (threat): threat is Record<string, unknown> =>
          Boolean(threat) && typeof threat === 'object',
      )
      .map((threat) => Number(threat.timeToImpactMs))
      .filter((time) => Number.isFinite(time) && time >= 0)
      .sort((left, right) => left - right)[0]
    const phase = gamePhase(state)
    const racing = racingSituation(state, available)
    const preferred = controller.policyMemory?.preferredDefense
    const plan = controller.executableStrategy
    const matches = (id: string, target: string) => {
      let local = id.split(':').at(-1) ?? id
      try {
        local = decodeURIComponent(local)
      } catch {
        /* literal ID */
      }
      return id === target || local === target
    }
    const permitted = available.filter(
      (a) => !plan?.avoidActions.some((id) => matches(a.id, id)),
    )
    const ranked = (permitted.length ? permitted : available)
      .map((action) => {
        const words = actionWords(action)
        let score = baseActionScore(words, phase)
        score += strategyScore(words, controller.strategy)
        if (plan) {
          for (const [id, weight] of Object.entries(plan.actionWeights))
            if (matches(action.id, id)) score += weight
          for (const rule of plan.rules) {
            if (!matches(action.id, rule.actionId)) continue
            const applies = rule.when.every((condition) => {
              let value: unknown = state
              for (const part of condition.path.split('.')) {
                if (['__proto__', 'prototype', 'constructor'].includes(part))
                  return false
                if (
                  !value ||
                  typeof value !== 'object' ||
                  !Object.prototype.hasOwnProperty.call(value, part)
                ) {
                  value = undefined
                  break
                }
                value = (value as Record<string, unknown>)[part]
              }
              if (condition.op === 'exists')
                return (value !== undefined) === condition.value
              if (value === undefined) return false
              if (condition.op === 'eq') return value === condition.value
              if (condition.op === 'ne') return value !== condition.value
              if (
                typeof value !== 'number' ||
                typeof condition.value !== 'number'
              )
                return false
              if (condition.op === 'lt') return value < condition.value
              if (condition.op === 'lte') return value <= condition.value
              if (condition.op === 'gt') return value > condition.value
              return value >= condition.value
            })
            if (applies) score += rule.weight
          }
        }
        score += semanticContextScore(action, context)
        score += racingActionScore(words, racing)
        if (imminent !== undefined && imminent <= 1_000) {
          if (hasAny(words, DEFENSE_WORDS)) score += 45
          else if (hasAny(words, IDLE_WORDS)) score -= 30
          else score -= 12
        }
        if (preferred && words.has(preferred)) score += 12
        const learned = controller.policyMemory?.actions[actionVerb(action.id)]
        // Global action reward cannot override immediate steering geometry.
        if (learned) {
          const limit = racing.active ? 2 : 30
          score += Math.max(-limit, Math.min(limit, learned.meanReward * 6))
        }
        return { action, score }
      })
      .sort(
        (left, right) =>
          right.score - left.score ||
          stableActionOrder(left.action.id, controller.seatId, step) -
            stableActionOrder(right.action.id, controller.seatId, step),
      )
    const selected = ranked[0]!.action
    const verb = actionVerb(selected.id)
    const learned = controller.policyMemory?.actions[verb]
    const reason = policyReason({
      verb,
      phase,
      imminent,
      racing,
      learnedReward: learned?.meanReward,
    })
    return {
      actionId: selected.id,
      reason,
      ...(controller.policyMemory?.lastLesson
        ? {
            learning: {
              lesson: controller.policyMemory.lastLesson,
              confidence: learned
                ? Math.min(0.95, 0.35 + learned.samples * 0.1)
                : 0.25,
            },
          }
        : {}),
    }
  }

  const DEFENSE_WORDS = ['jump', 'duck', 'dodge', 'block', 'shield', 'evade']
  const IDLE_WORDS = ['idle', 'wait', 'pass', 'noop']
  const DESTRUCTIVE_WORDS = [
    'restart',
    'reset',
    'quit',
    'exit',
    'forfeit',
    'abandon',
  ]
  const SETUP_COMMIT_WORDS = [
    'start',
    'ready',
    'confirm',
    'lock',
    'submit',
    'begin',
    'play',
    'join',
  ]
  const SETUP_CHANGE_WORDS = [
    'select',
    'choose',
    'cycle',
    'next',
    'previous',
    'character',
    'car',
    'loadout',
  ]
  const ACCELERATE_WORDS = [
    'accelerate',
    'throttle',
    'boost',
    'sprint',
    'forward',
  ]
  const BRAKE_WORDS = ['brake', 'slow', 'reverse']
  const ATTACK_WORDS = ['shoot', 'fire', 'attack', 'strike', 'hit', 'cast']

  type GamePhase =
    'setup' | 'countdown' | 'active' | 'paused' | 'terminal' | 'unknown'

  type RacingSituation = {
    active: boolean
    speedPercent?: number
    lane?: number
    offRoad: boolean
    curve: number
    immediateCurve: number
    trafficGap?: number
    trafficLane?: number
  }

  function actionWords(action: { id: string; label: string }): Set<string> {
    let id = action.id.split(':').at(-1) ?? action.id
    try {
      id = decodeURIComponent(id)
    } catch {
      // A malformed escape must not make a legal action unusable.
    }
    const spaced = `${id} ${action.label}`
      .replace(/([a-z\d])([A-Z])/g, '$1 $2')
      .toLowerCase()
    return new Set(spaced.split(/[^a-z\d]+/).filter(Boolean))
  }

  function hasAny(words: Set<string>, choices: readonly string[]): boolean {
    return choices.some((choice) => words.has(choice))
  }

  function gamePhase(state: Record<string, unknown>): GamePhase {
    const raw = ['phase', 'status', 'gamePhase', 'roundState']
      .map((key) => state[key])
      .find((value) => typeof value === 'string')
    const value = typeof raw === 'string' ? raw.toLowerCase() : ''
    if (/countdown|starting|counting/.test(value)) return 'countdown'
    if (/select|setup|lobby|menu|choose|ready/.test(value)) return 'setup'
    if (/pause/.test(value)) return 'paused'
    if (/finished|complete|game.?over|won|lost|ended/.test(value))
      return 'terminal'
    if (/race|play|active|running|combat|round/.test(value)) return 'active'
    return 'unknown'
  }

  function baseActionScore(words: Set<string>, phase: GamePhase): number {
    const destructive = hasAny(words, DESTRUCTIVE_WORDS)
    const setupCommit = hasAny(words, SETUP_COMMIT_WORDS)
    const setupChange = hasAny(words, SETUP_CHANGE_WORDS)
    const accelerate = hasAny(words, ACCELERATE_WORDS)
    const brake = hasAny(words, BRAKE_WORDS)
    const idle = hasAny(words, IDLE_WORDS)
    const attack = hasAny(words, ATTACK_WORDS)
    const defense = hasAny(words, DEFENSE_WORDS)
    let score = 0
    if (destructive) score -= 100
    if (idle) score -= 12
    if (phase === 'setup') {
      if (setupCommit) score += 90
      else if (setupChange) score += 12
      if (accelerate || brake || attack || defense) score -= 25
    } else if (phase === 'countdown') {
      if (accelerate) score += 35
      if (setupCommit) score += 10
      if (setupChange) score -= 30
      if (brake) score -= 35
    } else if (phase === 'active') {
      if (setupCommit || setupChange) score -= 55
      if (accelerate) score += 10
      if (attack) score += 10
      if (defense) score += 2
      if (brake) score -= 3
      if (words.has('move') || words.has('advance')) score += 6
      if (words.has('collect') || words.has('capture')) score += 7
    } else if (phase === 'paused') {
      if (words.has('resume') || words.has('play')) score += 90
    } else if (phase === 'terminal') {
      // Do not silently restart a finished test; preserving the result is more
      // useful than beginning an unrequested second game.
      if (destructive || words.has('play')) score -= 20
    } else {
      if (setupCommit || accelerate || attack || words.has('move')) score += 7
    }
    return score
  }

  function strategyScore(words: Set<string>, strategy: string): number {
    const normalized = strategy
      .replace(/([a-z\d])([A-Z])/g, '$1 $2')
      .toLowerCase()
    let score = 0
    for (const word of words) {
      if (word.length < 4 || !normalized.includes(word)) continue
      const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      if (
        new RegExp(
          `(?:do\\s+not|don't|never|avoid|without)(?:\\s+\\w+){0,3}\\s+${escaped}\\b`,
        ).test(normalized)
      )
        score -= 80
      else if (
        new RegExp(
          `(?:always|prefer|prioriti[sz]e)\\s+(?:\\w+\\s+){0,3}${escaped}\\b`,
        ).test(normalized)
      )
        score += 14
      else score += 3
    }
    if (
      hasAny(words, ACCELERATE_WORDS) &&
      /(?:full|top|highest|max(?:imum)?)\s+speed/.test(normalized)
    )
      score += 12
    return score
  }

  function semanticContextScore(
    action: { id: string; label: string },
    context: Record<string, unknown>,
  ): number {
    const verb = actionVerb(action.id)
    let localId = action.id.split(':').at(-1) ?? action.id
    try {
      localId = decodeURIComponent(localId)
    } catch {
      /* use the literal ID */
    }
    const actionScores = recordValue(context.actionScores)
    const supplied = finiteNumber(
      actionScores?.[action.id] ??
        actionScores?.[localId] ??
        actionScores?.[verb],
    )
    let score =
      supplied === undefined ? 0 : Math.max(-40, Math.min(40, supplied))
    const preferred = Array.isArray(context.preferredActions)
      ? context.preferredActions.filter(
          (value): value is string => typeof value === 'string',
        )
      : []
    const avoided = Array.isArray(context.avoidActions)
      ? context.avoidActions.filter(
          (value): value is string => typeof value === 'string',
        )
      : []
    if (
      preferred.includes(action.id) ||
      preferred.includes(localId) ||
      preferred.includes(verb)
    )
      score += 20
    if (
      avoided.includes(action.id) ||
      avoided.includes(localId) ||
      avoided.includes(verb)
    )
      score -= 30
    return score
  }

  function racingSituation(
    state: Record<string, unknown>,
    actions: { id: string; label: string }[],
  ): RacingSituation {
    const actionSets = actions.map(actionWords)
    const active =
      actionSets.some((words) => hasAny(words, ACCELERATE_WORDS)) &&
      actionSets.some((words) => hasAny(words, BRAKE_WORDS))
    const you = recordValue(state.you) ?? recordValue(state.me)
    const road = Array.isArray(state.roadCurveAhead)
      ? state.roadCurveAhead
          .map(Number)
          .filter((value) => Number.isFinite(value))
      : []
    const weights = road.map((_, index) => road.length - index)
    const curve = road.length
      ? road.reduce((sum, value, index) => sum + value * weights[index]!, 0) /
        weights.reduce((sum, value) => sum + value, 0)
      : 0
    const traffic = recordValue(state.nearestTrafficAhead)
    return {
      active,
      speedPercent: finiteNumber(you?.speedPercent),
      lane: finiteNumber(you?.lanePosition ?? you?.lane),
      offRoad: you?.offRoad === true,
      curve,
      immediateCurve: road
        .slice(0, 2)
        .reduce(
          (largest, value) =>
            Math.abs(value) > Math.abs(largest) ? value : largest,
          0,
        ),
      trafficGap: finiteNumber(traffic?.gap ?? traffic?.distance),
      trafficLane: finiteNumber(traffic?.lane ?? traffic?.lanePosition),
    }
  }

  function racingActionScore(
    words: Set<string>,
    situation: RacingSituation,
  ): number {
    if (!situation.active) return 0
    const accelerate = hasAny(words, ACCELERATE_WORDS)
    const brake = hasAny(words, BRAKE_WORDS)
    const left = words.has('left')
    const right = words.has('right')
    const steering = left || right
    let score = 0

    if ((situation.speedPercent ?? 0) < 0.6) {
      if (accelerate) score += 16
      if (brake) score -= 22
    }

    let desiredDirection: 'left' | 'right' | undefined
    let steeringPriority = 0
    if (
      situation.lane !== undefined &&
      (situation.offRoad || Math.abs(situation.lane) > 0.75)
    ) {
      desiredDirection = situation.lane > 0 ? 'left' : 'right'
      steeringPriority = 55
    } else if (
      situation.trafficGap !== undefined &&
      situation.trafficGap < 1_800 &&
      situation.trafficLane !== undefined &&
      situation.lane !== undefined &&
      Math.abs(situation.trafficLane - situation.lane) < 0.55
    ) {
      desiredDirection =
        situation.trafficLane <= situation.lane ? 'right' : 'left'
      steeringPriority = 42 * (1 - situation.trafficGap / 2_500)
    } else if (situation.lane !== undefined) {
      // Aim at a bounded lane target; holding "right" for an entire right bend
      // drives off the road once decisions become fast enough.
      const target = Math.max(-0.45, Math.min(0.45, situation.curve * 0.55))
      const error = target - situation.lane
      if (Math.abs(error) > 0.1) {
        desiredDirection = error > 0 ? 'right' : 'left'
        steeringPriority = 10 + Math.min(24, Math.abs(error) * 32)
      }
    } else if (Math.abs(situation.curve) >= 0.08) {
      desiredDirection = situation.curve > 0 ? 'right' : 'left'
      steeringPriority = 10
    }
    if (desiredDirection) {
      const desired = desiredDirection === 'left' ? left : right
      const wrong = desiredDirection === 'left' ? right : left
      if (desired) score += steeringPriority
      if (wrong) score -= steeringPriority
      if (!steering) score -= steeringPriority * 0.55
    } else if (steering) score -= 8

    const highSpeedSharpTurn =
      (situation.speedPercent ?? 0) > 0.78 &&
      Math.abs(situation.immediateCurve) > 0.55
    const collisionImminent =
      situation.trafficGap !== undefined && situation.trafficGap < 350
    if (highSpeedSharpTurn || (collisionImminent && !steering)) {
      if (brake) score += 30
      if (accelerate && !steering) score -= 28
    }
    return score
  }

  function policyReason(input: {
    verb: string
    phase: GamePhase
    imminent?: number
    racing: RacingSituation
    learnedReward?: number
  }): string {
    if (input.imminent !== undefined && input.imminent <= 1_000)
      return `Realtime policy reacted to an incoming threat with ${Math.round(input.imminent)} ms to impact and selected ${input.verb}.`
    if (input.phase === 'setup')
      return `Realtime policy selected ${input.verb} to complete the current setup phase.`
    if (input.phase === 'countdown')
      return `Realtime policy selected ${input.verb} to launch competitively when play begins.`
    if (input.racing.active) {
      if (input.racing.offRoad)
        return `Realtime driving policy selected ${input.verb} to recover toward the road while preserving speed.`
      if (
        input.racing.trafficGap !== undefined &&
        input.racing.trafficGap < 1_800
      )
        return `Realtime driving policy selected ${input.verb} to avoid traffic ${Math.round(input.racing.trafficGap)} units ahead.`
      if (Math.abs(input.racing.curve) >= 0.08)
        return `Realtime driving policy selected ${input.verb} for the upcoming ${input.racing.curve > 0 ? 'right' : 'left'} bend.`
      return `Realtime driving policy selected ${input.verb} to maintain competitive progress.`
    }
    if (input.learnedReward !== undefined)
      return `Realtime policy selected ${input.verb} using measured action reward ${input.learnedReward.toFixed(2)} and the latest observation.`
    return `Realtime policy selected ${input.verb} from the current phase, strategy, threats, and legal actions without blocking the game clock.`
  }

  function recordValue(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined
  }

  function finiteNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value)
      ? value
      : undefined
  }

  function stableActionOrder(id: string, seatId: string, step: number): number {
    let hash = step + 1
    for (const character of `${seatId}:${id}`)
      hash = (hash * 31 + character.charCodeAt(0)) >>> 0
    return hash
  }

  function valueAt(state: unknown, path: readonly string[]): unknown {
    let value = state
    for (const key of path) {
      if (!value || typeof value !== 'object') return undefined
      value = (value as Record<string, unknown>)[key]
    }
    return value
  }

  function numberAt(
    state: unknown,
    path: readonly string[],
  ): number | undefined {
    const value = valueAt(state, path)
    return typeof value === 'number' && Number.isFinite(value)
      ? value
      : undefined
  }

  function textAt(state: unknown, path: readonly string[]): string | undefined {
    const value = valueAt(state, path)
    return typeof value === 'string' ? value : undefined
  }

  function booleanAt(
    state: unknown,
    path: readonly string[],
  ): boolean | undefined {
    const value = valueAt(state, path)
    return typeof value === 'boolean' ? value : undefined
  }

  function clamp(value: number, minimum: number, maximum: number): number {
    return Math.max(minimum, Math.min(maximum, value))
  }

  function transitionFeedback(
    before: unknown,
    after: unknown,
    actionId: string,
    observedAfterMs: number,
  ): BrowserFeedback {
    const supplied =
      after && typeof after === 'object'
        ? (after as Record<string, unknown>).feedback
        : undefined
    if (supplied && typeof supplied === 'object') {
      const feedback = supplied as Record<string, unknown>
      if (
        typeof feedback.reward === 'number' &&
        Number.isFinite(feedback.reward) &&
        typeof feedback.summary === 'string'
      ) {
        const outcome =
          feedback.outcome === 'good'
            ? 'positive'
            : feedback.outcome === 'poor'
              ? 'negative'
              : feedback.outcome
        const metrics =
          feedback.metrics && typeof feedback.metrics === 'object'
            ? (Object.fromEntries(
                Object.entries(feedback.metrics)
                  .filter(
                    ([, value]) =>
                      typeof value === 'number' && Number.isFinite(value),
                  )
                  .slice(0, 32),
              ) as Record<string, number>)
            : {}
        return {
          actionId,
          reward: Math.max(-100, Math.min(100, feedback.reward)),
          summary: feedback.summary.slice(0, 500),
          observedAfterMs,
          outcome: ['positive', 'negative', 'neutral', 'unknown'].includes(
            String(outcome),
          )
            ? (outcome as BrowserFeedback['outcome'])
            : 'unknown',
          metrics,
        }
      }
    }
    const metrics: Record<string, number> = {}
    let reward = 0
    const measure = (
      name: string,
      path: readonly string[],
      rewardWeight: number,
    ) => {
      const prior = numberAt(before, path)
      const current = numberAt(after, path)
      if (prior === undefined || current === undefined) return
      const delta = current - prior
      metrics[name] = delta
      reward += delta * rewardWeight
    }
    measure('ownLivesDelta', ['me', 'lives'], 2)
    measure('opponentLivesDelta', ['opponent', 'lives'], -2)
    measure('ownHitsDelta', ['me', 'shotsHit'], 1)
    measure('opponentHitsDelta', ['opponent', 'shotsHit'], -1)
    measure('scoreDelta', ['score'], 1)
    measure('ownScoreDelta', ['you', 'score'], 1)
    measure('opponentScoreDelta', ['opponent', 'score'], -1)
    measure('progressDelta', ['progress'], 2)
    measure('ownProgressDelta', ['you', 'progress'], 2)

    // Common racing/navigation observations expose distance rather than points.
    // Normalize it so a fast tick is useful evidence without dwarfing terminal
    // rewards or overflowing the feedback contract.
    const distanceBefore =
      numberAt(before, ['you', 'distanceToFinish']) ??
      numberAt(before, ['distanceToFinish']) ??
      numberAt(before, ['distanceRemaining'])
    const distanceAfter =
      numberAt(after, ['you', 'distanceToFinish']) ??
      numberAt(after, ['distanceToFinish']) ??
      numberAt(after, ['distanceRemaining'])
    if (distanceBefore !== undefined && distanceAfter !== undefined) {
      const delta = distanceAfter - distanceBefore
      metrics.distanceRemainingDelta = delta
      reward += clamp(-delta / 1_500, -2, 2)
    }
    const placeBefore = numberAt(before, ['you', 'place'])
    const placeAfter = numberAt(after, ['you', 'place'])
    if (placeBefore !== undefined && placeAfter !== undefined) {
      metrics.placeDelta = placeAfter - placeBefore
      if (placeBefore > 0 && placeAfter > 0)
        reward += clamp(placeBefore - placeAfter, -2, 2)
    }
    const wasOffRoad = booleanAt(before, ['you', 'offRoad'])
    const isOffRoad = booleanAt(after, ['you', 'offRoad'])
    if (wasOffRoad !== undefined && isOffRoad !== undefined) {
      metrics.offRoadDelta = Number(isOffRoad) - Number(wasOffRoad)
      if (!wasOffRoad && isOffRoad) reward -= 3
      if (wasOffRoad && !isOffRoad) reward += 2
    }
    const wasFinished = booleanAt(before, ['you', 'finished'])
    const isFinished = booleanAt(after, ['you', 'finished'])
    if (wasFinished === false && isFinished === true) {
      metrics.finished = 1
      reward += 5
    }

    // Games can provide an authoritative, already-attributed reward signal in
    // the semantic context. This is preferred over guessing from arbitrary UI.
    const explicitReward = numberAt(after, [
      'arcadeDecisionContext',
      'rewardDelta',
    ])
    if (explicitReward !== undefined) {
      metrics.explicitReward = explicitReward
      reward += clamp(explicitReward, -20, 20)
    }

    const phaseBefore = textAt(before, ['phase'])
    const phaseAfter = textAt(after, ['phase'])
    if (phaseBefore && phaseAfter && phaseBefore !== phaseAfter) {
      metrics.phaseChanged = 1
      if (/select|setup|lobby|countdown/i.test(phaseBefore)) reward += 0.5
    }
    const winner = textAt(after, ['winner'])
    const me = textAt(after, ['me', 'id'])
    if (winner && me) reward += winner === me ? 5 : -5
    const rounded = Math.round(clamp(reward, -100, 100) * 100) / 100
    const outcome =
      rounded > 0
        ? ('positive' as const)
        : rounded < 0
          ? ('negative' as const)
          : Object.keys(metrics).length
            ? ('neutral' as const)
            : ('unknown' as const)
    const changed = Object.entries(metrics)
      .filter(([, delta]) => delta !== 0)
      .map(([name, delta]) => `${name} ${delta >= 0 ? '+' : ''}${delta}`)
    return {
      actionId,
      outcome,
      reward: rounded,
      summary: changed.length
        ? `Observed ${changed.join(', ')} after the prior action.`
        : `No measurable outcome change was visible after the prior action.`,
      observedAfterMs: Math.max(0, Math.round(observedAfterMs)),
      metrics,
    }
  }

  function enrichRealtimeState(state: unknown): unknown {
    if (!state || typeof state !== 'object' || Array.isArray(state))
      return state
    const source = state as Record<string, unknown>
    const existing = recordValue(source.arcadeDecisionContext) ?? {}
    const me =
      source.me && typeof source.me === 'object'
        ? (source.me as Record<string, unknown>)
        : undefined
    const bullets = Array.isArray(source.bullets) ? source.bullets : []
    const meX = typeof me?.x === 'number' ? me.x : undefined
    const meId = typeof me?.id === 'string' ? me.id : undefined
    const incomingThreats = bullets.flatMap((candidate) => {
      if (!candidate || typeof candidate !== 'object' || meX === undefined)
        return []
      const bullet = candidate as Record<string, unknown>
      if (
        typeof bullet.x !== 'number' ||
        typeof bullet.vx !== 'number' ||
        bullet.vx === 0 ||
        (meId && bullet.owner === meId)
      )
        return []
      const seconds = (meX - bullet.x) / bullet.vx
      if (!Number.isFinite(seconds) || seconds < 0) return []
      return [
        {
          owner: typeof bullet.owner === 'string' ? bullet.owner : undefined,
          distance: Math.round(Math.abs(meX - bullet.x)),
          timeToImpactMs: Math.round(seconds * 1000),
          ...(typeof bullet.y === 'number' ? { y: bullet.y } : {}),
        },
      ]
    })
    return {
      ...source,
      arcadeDecisionContext: {
        ...existing,
        capturedAt: new Date().toISOString(),
        incomingThreats: Array.isArray(existing.incomingThreats)
          ? existing.incomingThreats
          : incomingThreats,
        urgency: incomingThreats.some((threat) => threat.timeToImpactMs <= 500)
          ? 'immediate'
          : incomingThreats.length
            ? 'approaching'
            : 'clear',
      },
    }
  }
  return {
    choose: chooseRealtimePolicyAction,
    learn: learnFromFeedback,
    feedback: transitionFeedback,
    phase: gamePhase,
    enrich: enrichRealtimeState,
  }
}
