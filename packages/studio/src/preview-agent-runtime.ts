import type {
  createBrowserPolicy,
  BrowserController,
} from './browser-policy.js'

type Control = {
  mode: 'pulse' | 'hold'
  refreshMs?: number
  releaseActionId?: string
}
type Action = { id: string; label: string; control?: Control }
type Controller = BrowserController & {
  kind: 'agent' | 'human'
  label: string
  agentId?: string
  strategyEpoch?: number
}
type Configuration = {
  runId: string
  epoch: string
  controllers: Controller[]
  decisionsPerSecond: number
}
type Environment = {
  api: {
    observe(): unknown
    actions(): Action[]
    step(id: string): unknown
    release?(seatId: string): unknown
  }
  policy: ReturnType<typeof createBrowserPolicy>
  now(): number
  requestFrame(callback: (time: number) => void): number
  cancelFrame(id: number): void
  emit(message: Record<string, unknown>): void
}

/** The same frame clock as the preview, with no network in the control path.
 * Keep this factory self-contained: its compiled source is embedded in previews.
 */
export function createPreviewAgentRuntime(env: Environment) {
  type Seat = {
    controller: Controller
    generation: number
    awaitingStrategy?: number
    nextDecision: number
    lastApply: number
    lastSample: number
    held?: { action: Action; control: Control }
    pending: boolean
    prior?: { state: unknown; actionId: string; at: number }
    decisions: number
    applications: number
    cumulativeReward: number
    feedbackSamples: number
    sampled: boolean
  }
  let config: Configuration | undefined
  let frame: number | undefined
  let lease = 0
  let started = 0
  let lastFrame = 0
  let sequence = 0
  let generation = 0
  const seats = new Map<string, Seat>()
  const object = (value: unknown): Record<string, any> =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, any>)
      : {}
  const verb = (id: string) => {
    try {
      return decodeURIComponent(id.split(':').at(-1) ?? id).toLowerCase()
    } catch {
      return ''
    }
  }
  function emit(type: string, value: Record<string, unknown> = {}) {
    if (config)
      env.emit({ type, runId: config.runId, epoch: config.epoch, ...value })
  }
  function release(seat: Seat) {
    const held = seat.held
    seat.held = undefined
    if (!held) return
    try {
      const result = env.api.release
        ? env.api.release(seat.controller.seatId)
        : held.control.releaseActionId &&
            env.api.actions().some((a) => a.id === held.control.releaseActionId)
          ? env.api.step(held.control.releaseActionId)
          : undefined
      Promise.resolve(result).catch(() => {})
    } catch {
      /* No stale input is reapplied after a failed release. */
    }
  }
  function stop(reason = 'paused') {
    generation++
    if (frame !== undefined) env.cancelFrame(frame)
    frame = undefined
    for (const seat of seats.values()) release(seat)
    emit('arcade.preview-policy.stopped', { reason, decisions: sequence })
    config = undefined
  }
  function controlFor(
    action: Action,
    state: Record<string, any>,
    available: Action[],
  ): Control | undefined {
    let localId = action.id.split(':').at(-1) ?? action.id
    try {
      localId = decodeURIComponent(localId)
    } catch {
      /* literal ID */
    }
    const controls = object(object(state.arcadeDecisionContext).actionControls)
    const raw = action.control ?? controls[action.id] ?? controls[localId]
    const releaseId =
      raw?.releaseActionId &&
      available.find(
        (a) =>
          a.id === raw.releaseActionId ||
          a.id.endsWith(':' + encodeURIComponent(raw.releaseActionId)),
      )?.id
    const declared = raw ? { ...raw, releaseActionId: releaseId } : undefined
    if (
      declared &&
      (declared.mode === 'hold' || declared.mode === 'pulse') &&
      (env.api.release ||
        available.some((a) => a.id === declared.releaseActionId))
    ) {
      return {
        mode: declared.mode,
        refreshMs: Math.max(
          16,
          Math.min(250, Number(declared.refreshMs) || 50),
        ),
        releaseActionId: declared.releaseActionId,
      }
    }
    // Compatibility for existing racing bridges whose step() sets a short input
    // lease. Only directional drive controls are renewed; never menu/reset/fire.
    const you = object(state.you ?? state.me)
    const coast = available.find((a) => verb(a.id) === 'coast')
    if (
      typeof you.speedPercent === 'number' &&
      typeof you.lanePosition === 'number' &&
      coast &&
      /^(accelerate|brake)(left|right)?$/.test(verb(action.id))
    )
      return { mode: 'pulse', refreshMs: 50, releaseActionId: coast.id }
    return undefined
  }
  function strategyApplied(seat: Seat) {
    if (seat.awaitingStrategy === undefined) return
    emit('arcade.preview-policy.strategy-applied', {
      seatId: seat.controller.seatId,
      strategyEpoch: seat.awaitingStrategy,
    })
    seat.awaitingStrategy = undefined
  }
  function apply(seat: Seat, action: Action, now: number) {
    if (seat.pending) return
    const currentGeneration = generation
    const seatGeneration = seat.generation
    const pendingControl = seat.held
    const result = env.api.step(action.id)
    if (result === false) throw new Error('Game rejected action ' + action.id)
    seat.lastApply = now
    seat.applications++
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      seat.pending = true
      Promise.resolve(result).then(
        (accepted) => {
          seat.pending = false
          if (
            currentGeneration !== generation ||
            seatGeneration !== seat.generation
          ) {
            // An asynchronous input may finish after pause. Clear its intent too.
            release({ ...seat, held: pendingControl })
            return
          }
          if (accepted === false) stop('Game rejected action ' + action.id)
          else strategyApplied(seat)
        },
        (error) => {
          seat.pending = false
          if (
            currentGeneration === generation &&
            seatGeneration === seat.generation
          )
            stop(String(error))
        },
      )
    } else strategyApplied(seat)
  }
  function tick(now: number) {
    frame = undefined
    if (!config) return
    if (now - lease > 3000) {
      stop('Controller connection expired')
      return
    }
    if (now - started >= 300000 || sequence >= 100000) {
      stop('Five-minute playtest budget reached')
      return
    }
    const frameDeltaMs = lastFrame ? Math.max(0, now - lastFrame) : 0
    lastFrame = now
    try {
      // One consistent observation snapshot for all seats on this frame.
      const capturedAt = env.now()
      const snapshot = object(env.api.observe())
      const observations = object(object(snapshot.arcade).observations)
      const allActions = env.api.actions()
      let active = false
      for (const [seatId, seat] of seats) {
        const state = object(observations[seatId])
        const phase = env.policy.phase(state)
        if (
          phase === 'terminal' ||
          phase === 'paused' ||
          object(state.you ?? state.me).finished === true
        ) {
          release(seat)
          continue
        }
        active = true
        const available = allActions.filter((a) =>
          a.id.startsWith('seat:' + encodeURIComponent(seatId) + ':'),
        )
        if (!available.length) {
          release(seat)
          continue
        }
        if (seat.pending) {
          if (now - seat.lastApply > 1000)
            throw new Error('Game action exceeded one second for ' + seatId)
          continue
        }
        // Refresh a short input lease independently of policy cadence. Recheck
        // legality and phase every frame; never replay a catch-up burst.
        if (now < seat.nextDecision) {
          const held = seat.held
          if (held && !available.some((a) => a.id === held.action.id))
            release(seat)
          else if (
            held?.control.mode === 'pulse' &&
            now - seat.lastApply >= (held.control.refreshMs ?? 50)
          )
            apply(seat, held.action, now)
          continue
        }
        seat.nextDecision =
          now + 1000 / Math.max(1, Math.min(20, config.decisionsPerSecond))
        const observation = {
          state: env.policy.enrich(state),
          actions: available
            .slice(0, 80)
            .map((a) => ({ id: a.id, label: a.label.slice(0, 200) })),
        }
        const feedback = seat.prior
          ? env.policy.feedback(
              seat.prior.state,
              state,
              seat.prior.actionId,
              Math.max(0, Math.round(now - seat.prior.at)),
            )
          : undefined
        const learned = env.policy.learn(seat.controller, feedback)
        seat.controller = { ...seat.controller, policyMemory: learned.memory }
        const decision = env.policy.choose(
          observation,
          seat.controller,
          sequence,
        )
        const chosen = available.find((a) => a.id === decision.actionId)
        if (!chosen) throw new Error('Policy chose an unavailable action')
        const control = controlFor(chosen, state, available)
        const changed =
          seat.held?.action.id !== chosen.id ||
          seat.held?.control.mode !== control?.mode
        const gapMs = seat.applications ? now - seat.lastApply : 0
        if (changed) release(seat)
        if (control) seat.held = { action: chosen, control }
        if (!control || changed || control.mode === 'pulse')
          apply(seat, chosen, now)
        seat.prior = {
          state: JSON.parse(JSON.stringify(state)),
          actionId: chosen.id,
          at: now,
        }
        seat.decisions++
        if (feedback?.outcome !== 'unknown' && feedback) {
          seat.cumulativeReward += feedback.reward
          seat.feedbackSamples++
        }
        const step = sequence++
        // Diagnostics are sampled; control decisions and input renewals are not.
        // Never stringify a full scene or update React at the animation rate.
        if (!seat.sampled || now - seat.lastSample >= 500) {
          seat.sampled = true
          seat.lastSample = now
          const event = {
            step,
            seatId,
            observation,
            decision,
            controller: seat.controller,
            ...(feedback ? { feedback } : {}),
            decisionSource: 'preview-frame-policy',
            timing: {
              decisionLatencyMs: env.now() - capturedAt,
              observationAgeMs: env.now() - capturedAt,
              frameDeltaMs,
              actionGapMs: gapMs,
              elapsedMs: Math.max(0, now - started),
              applications: seat.applications,
            },
            performance: {
              decisions: seat.decisions,
              feedbackSamples: seat.feedbackSamples,
              cumulativeReward: seat.cumulativeReward,
              recentReward: feedback?.reward ?? 0,
              improving: feedback?.outcome === 'positive',
            },
          }
          // Large game observations cannot create an unbounded diagnostics queue.
          if (JSON.stringify(event).length <= 30000)
            emit('arcade.preview-policy.sample', { event, decisions: sequence })
          else
            emit('arcade.preview-policy.warning', {
              reason: 'Observation exceeds the 30 KB diagnostic sample limit',
            })
        }
      }
      if (!active && seats.size) {
        stop('All controlled seats finished or paused')
        return
      }
    } catch (error) {
      stop(error instanceof Error ? error.message : String(error))
      return
    }
    if (config) frame = env.requestFrame(tick)
  }
  function start(next: Configuration) {
    if (!next.runId || !next.epoch || !Array.isArray(next.controllers)) return
    if (config?.epoch !== next.epoch || config?.runId !== next.runId) {
      stop('replaced')
      seats.clear()
      sequence = 0
      started = env.now()
      lastFrame = 0
    }
    config = next
    lease = env.now()
    const requested = next.controllers
      .filter((c) => c.kind === 'agent')
      .slice(0, 16)
    for (const [id, seat] of seats) {
      if (!requested.some((c) => c.seatId === id)) {
        release(seat)
        seats.delete(id)
      }
    }
    for (const controller of requested) {
      const seat = seats.get(controller.seatId)
      if (seat) {
        const epoch = controller.strategyEpoch ?? 0
        const currentEpoch = seat.controller.strategyEpoch ?? 0
        if (epoch < currentEpoch) continue
        const replaced =
          epoch > currentEpoch ||
          (controller.strategyEpoch === undefined &&
            controller.strategy !== seat.controller.strategy) ||
          controller.agentId !== seat.controller.agentId
        if (replaced) {
          seat.generation++
          release(seat)
          seat.controller = { ...controller, policyMemory: { actions: {} } }
          seat.prior = undefined
          seat.nextDecision = 0
          seat.sampled = false
          seat.awaitingStrategy = epoch
        }
      } else
        seats.set(controller.seatId, {
          controller,
          generation: 0,
          nextDecision: 0,
          lastApply: 0,
          lastSample: 0,
          pending: false,
          decisions: 0,
          applications: 0,
          cumulativeReward: 0,
          feedbackSamples: 0,
          sampled: false,
        })
    }
    if (!seats.size) {
      stop('No agent-controlled seats')
      return
    }
    if (frame === undefined) frame = env.requestFrame(tick)
    emit('arcade.preview-policy.started')
  }
  return {
    start,
    stop,
    heartbeat(epoch: string) {
      if (config?.epoch === epoch) lease = env.now()
    },
  }
}
