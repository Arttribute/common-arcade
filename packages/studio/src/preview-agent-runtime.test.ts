import { describe, expect, it } from 'vitest'
import { createBrowserPolicy } from './browser-policy.js'
import { createPreviewAgentRuntime } from './preview-agent-runtime.js'

function harness(
  mode: 'pulse' | 'hold' | 'instant' = 'pulse',
  count = 2,
  rate = 10,
) {
  let now = 0
  let nextId = 1
  let phase = 'active'
  let legal = true
  const frames = new Map<number, (time: number) => void>()
  const applications: { seat: string; time: number; id: string }[] = []
  const messages: any[] = []
  const controllers = Array.from({ length: count }, (_, i) => ({
    seatId: 's' + i,
    label: 'Seat ' + i,
    kind: 'agent' as const,
    strategy: 'Win legally.',
  }))
  const actions = () =>
    controllers.flatMap((c) => [
      {
        id: 'seat:' + c.seatId + ':engage',
        label: 'Engage',
        ...(mode === 'instant'
          ? {}
          : {
              control: {
                mode,
                refreshMs: 40,
                releaseActionId: 'seat:' + c.seatId + ':release',
              },
            }),
      },
      { id: 'seat:' + c.seatId + ':release', label: 'Release' },
    ])
  const runtime = createPreviewAgentRuntime({
    policy: createBrowserPolicy(),
    now: () => now,
    api: {
      observe: () => ({
        arcade: {
          observations: Object.fromEntries(
            controllers.map((c) => [
              c.seatId,
              {
                phase,
                arcadeDecisionContext: { actionScores: { engage: 40 } },
              },
            ]),
          ),
        },
      }),
      actions: () => (legal ? actions() : []),
      step: (id) => {
        applications.push({ seat: id.split(':')[1]!, time: now, id })
        return true
      },
    },
    requestFrame: (callback) => {
      const id = nextId++
      frames.set(id, callback)
      return id
    },
    cancelFrame: (id) => {
      frames.delete(id)
    },
    emit: (message) => messages.push(message),
  })
  const config = {
    runId: 'run',
    epoch: 'epoch',
    controllers,
    decisionsPerSecond: rate,
  }
  runtime.start(config)
  function advance(ms: number, heartbeat = true, frameMs = 10) {
    for (let elapsed = 0; elapsed < ms; elapsed += frameMs) {
      now += frameMs
      if (heartbeat) runtime.heartbeat('epoch')
      const batch = [...frames.values()]
      frames.clear()
      for (const frame of batch) frame(now)
    }
  }
  return {
    runtime,
    config,
    applications,
    messages,
    advance,
    setPhase: (p: string) => {
      phase = p
    },
    setLegal: (value: boolean) => {
      legal = value
    },
  }
}

describe('frame-synchronized preview control', () => {
  it('reports integer feedback durations from fractional animation frame timestamps', () => {
    const h = harness()
    h.advance(1200, true, 1000 / 60)
    const feedback = h.messages
      .filter((message) => message.type === 'arcade.preview-policy.sample')
      .flatMap((message) =>
        message.event.feedback ? [message.event.feedback] : [],
      )
    expect(feedback.length).toBeGreaterThan(0)
    for (const sample of feedback) {
      expect(Number.isInteger(sample.observedAfterMs)).toBe(true)
      expect(sample.observedAfterMs).toBeGreaterThanOrEqual(0)
    }
  })
  it('renews arbitrary short inputs for both seats without waiting on diagnostics', () => {
    const h = harness('pulse', 2, 2)
    h.advance(5000)
    for (const seat of ['s0', 's1']) {
      const times = h.applications
        .filter((a) => a.seat === seat && a.id.endsWith(':engage'))
        .map((a) => a.time)
      const gaps = times.slice(1).map((time, i) => time - times[i]!)
      expect(Math.max(...gaps)).toBeLessThanOrEqual(40)
      expect(times).toEqual(
        h.applications
          .filter((a) => a.seat !== seat && a.id.endsWith(':engage'))
          .map((a) => a.time),
      )
      // A game with a 100 ms input lease remains active for the entire run.
      expect(gaps.every((gap) => gap < 100)).toBe(true)
    }
    expect(
      h.messages.filter((m) => m.type.endsWith('.sample')).length,
    ).toBeLessThanOrEqual(20)
  })
  it('applies durable intent once and releases it when paused', () => {
    const h = harness('hold', 1)
    h.advance(1500)
    expect(h.applications.filter((a) => a.id.endsWith(':engage'))).toHaveLength(
      1,
    )
    h.runtime.stop()
    const length = h.applications.length
    expect(h.applications.at(-1)?.id).toBe('seat:s0:release')
    h.advance(2000)
    expect(h.applications).toHaveLength(length)
  })
  it('does not repeat instantaneous actions at the frame rate', () => {
    const h = harness('instant', 1, 2)
    h.advance(1000)
    expect(h.applications).toHaveLength(2)
  })
  it('cancels held inputs on lost legality, terminal state, or expired lease', () => {
    const h = harness('hold', 1)
    h.advance(20)
    h.setPhase('finished')
    h.advance(20)
    expect(h.applications.at(-1)?.id).toBe('seat:s0:release')
    expect(h.messages.at(-1)?.reason).toContain('finished')
    const disconnected = harness('pulse', 1)
    disconnected.advance(4000, false)
    expect(disconnected.messages.at(-1)?.reason).toContain('expired')
    expect(disconnected.applications.at(-1)?.id).toBe('seat:s0:release')
    const illegal = harness('pulse', 1)
    illegal.advance(100)
    illegal.setLegal(false)
    const count = illegal.applications.length
    illegal.advance(1000)
    expect(illegal.applications).toHaveLength(count)
  })
  it('releases old controls when a strategy updates and isolates human seats', () => {
    const h = harness('hold', 2)
    h.advance(200)
    h.runtime.start({
      ...h.config,
      controllers: [
        { ...h.config.controllers[0]!, strategy: 'Prefer engage.' },
        { ...h.config.controllers[1]!, kind: 'human' },
      ],
    })
    const count = h.applications.filter((a) => a.seat === 's1').length
    h.advance(1000)
    expect(h.applications.filter((a) => a.seat === 's1')).toHaveLength(count)
    expect(
      h.applications.filter((a) => a.seat === 's0' && a.id.endsWith(':engage')),
    ).toHaveLength(2)
  })
})

it('replaces immediately at a slow decision rate, clears learning, and ignores old epochs', () => {
  const h = harness('hold', 1, 1)
  h.advance(10)
  const controller = {
    ...h.config.controllers[0]!,
    strategyEpoch: 2,
    strategy: 'Never engage. Prefer release.',
    executableStrategy: {
      actionWeights: { release: 100 },
      avoidActions: ['engage'],
      rules: [],
    },
    policyMemory: {
      actions: {
        engage: { samples: 100, meanReward: 100, totalReward: 10000 },
      },
    },
  }
  h.runtime.start({ ...h.config, controllers: [controller] })
  expect(h.applications.at(-1)?.id).toBe('seat:s0:release')
  h.advance(10)
  const sample = h.messages
    .filter((m) => m.type.endsWith('.sample'))
    .at(-1).event
  expect(sample.decision.actionId).toBe('seat:s0:release')
  expect(sample.controller.strategyEpoch).toBe(2)
  expect(sample.controller.policyMemory.actions).toEqual({})
  expect(sample.feedback).toBeUndefined()
  h.runtime.start({
    ...h.config,
    controllers: [
      { ...controller, strategyEpoch: 1, strategy: 'Prefer engage.' },
    ],
  })
  h.advance(1100)
  expect(h.applications.filter((a) => a.id.endsWith(':engage'))).toHaveLength(1)
  expect(
    h.messages.filter((m) => m.type.endsWith('.strategy-applied')),
  ).toHaveLength(1)
})
