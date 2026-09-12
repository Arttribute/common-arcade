import { afterEach, expect, it, vi } from 'vitest'
import { createBrowserTestApi } from './browser-tests.js'
import { MemoryDocumentStore, StoreConflict } from './store.js'

afterEach(() => vi.unstubAllGlobals())
const observation = {
  state: { you: { speed: 0 } },
  actions: [
    { id: 'accelerate', label: 'Accelerate' },
    { id: 'brake', label: 'Brake' },
  ],
}
const planned = {
  strategy: 'Accelerate immediately.',
  reason: 'Owner asked to stop braking.',
  executableStrategy: {
    actionWeights: { accelerate: 100 },
    avoidActions: ['brake'],
    rules: [],
  },
}
const streamed = (value: unknown) =>
  new Response(
    `data: ${JSON.stringify({ type: 'token', phase: 'final_answer', content: JSON.stringify(value) })}\n\ndata: {"type":"final"}\n\n`,
    { headers: { 'Content-Type': 'text/event-stream' } },
  )
async function setup() {
  const store = new MemoryDocumentStore()
  await store.put('browser-runs:owner', 'run', {
    version: 1,
    id: 'run',
    ownerId: 'owner',
    projectId: 'project',
    revision: 1,
    digest: 'digest',
    step: 0,
    pendingUntil: 0,
    createdAt: new Date().toISOString(),
    controllers: [
      {
        seatId: 'seat',
        label: 'Driver',
        kind: 'agent',
        agentId: 'agent',
        sessionId: 'session',
        strategy: 'Brake.',
        strategyEpoch: 1,
        policyMemory: {
          actions: { brake: { samples: 5, meanReward: 10, totalReward: 50 } },
        },
        lastActionId: 'brake',
      },
    ],
  })
  const app = createBrowserTestApi(store, async () => ({
    id: 'owner',
    token: 'test',
    provider: 'commons',
    scopes: ['projects:write'],
  }))
  app.onError((error, c) =>
    c.json(
      { detail: error.message },
      error instanceof StoreConflict ? 409 : 500,
    ),
  )
  const post = (path: string, body: unknown) =>
    app.request(`/v1/studio/browser-runs/run/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  return { store, app, post }
}
it('turns owner coaching into a clean executable replacement used by the next decision', async () => {
  const { post } = await setup()
  vi.stubGlobal('fetch', async () => streamed(planned))
  const response = await post('controllers/seat/coach', {
    prompt: 'Stop braking and accelerate.',
    observation,
  })
  expect(response.status, await response.clone().text()).toBe(200)
  const applied = await response.json()
  expect(applied.controller).toMatchObject({
    strategyEpoch: 2,
    strategy: planned.strategy,
    policyMemory: { actions: {} },
    executableStrategy: planned.executableStrategy,
  })
  expect(applied.controller.lastActionId).toBeUndefined()
  const next = await post('decide', {
    step: 0,
    seatId: 'seat',
    observation,
    decisionMode: 'realtime-policy',
  })
  expect(next.status).toBe(200)
  expect((await next.json()).decision.actionId).toBe('accelerate')
})
it('discards a slow coaching response when a newer owner instruction wins', async () => {
  const { post, store } = await setup()
  let finish!: (response: Response) => void
  let started!: () => void
  const waiting = new Promise<void>((r) => {
    started = r
  })
  vi.stubGlobal('fetch', () => {
    started()
    return new Promise<Response>((r) => {
      finish = r
    })
  })
  const pending = post('controllers/seat/coach', {
    prompt: 'Accelerate.',
    observation,
  })
  await waiting
  expect(
    (await post('controllers/seat/strategy', { prompt: 'Never accelerate.' }))
      .status,
  ).toBe(200)
  finish(streamed(planned))
  expect((await pending).status).toBe(409)
  const saved: any = await store.get('browser-runs:owner', 'run')
  expect(saved.controllers[0].strategy).toBe('Never accelerate.')
})
it('does not return a slow old decision or overwrite coaching when its model finishes', async () => {
  const { post, store } = await setup()
  let finish!: (response: Response) => void
  let started!: () => void
  const waiting = new Promise<void>((r) => {
    started = r
  })
  vi.stubGlobal('fetch', () => {
    started()
    return new Promise<Response>((r) => {
      finish = r
    })
  })
  const pending = post('decide', { step: 0, seatId: 'seat', observation })
  await waiting
  expect(
    (await post('controllers/seat/strategy', { prompt: 'Accelerate.' })).status,
  ).toBe(200)
  const replacementDecision = await post('decide', {
    step: 0,
    seatId: 'seat',
    observation,
    decisionMode: 'realtime-policy',
  })
  expect(replacementDecision.status).toBe(200)
  expect((await replacementDecision.json()).decision.actionId).toBe(
    'accelerate',
  )
  finish(streamed({ actionId: 'brake', reason: 'Old strategy' }))
  expect((await pending).status).toBe(409)
  const saved: any = await store.get('browser-runs:owner', 'run')
  expect(saved.controllers[0].strategy).toBe('Accelerate.')
  expect(saved.pendingUntil).toBe(0)
  expect(saved.step).toBe(1)
  expect(await store.list('browser-events:run')).toHaveLength(1)
})
it('keeps the active strategy if the model produces an invalid policy', async () => {
  const { post, store } = await setup()
  vi.stubGlobal('fetch', async () =>
    streamed({
      ...planned,
      executableStrategy: { source: 'run arbitrary code' },
    }),
  )
  expect(
    (
      await post('controllers/seat/coach', {
        prompt: 'Accelerate.',
        observation,
      })
    ).status,
  ).toBe(500)
  const saved: any = await store.get('browser-runs:owner', 'run')
  expect(saved.controllers[0].strategyEpoch).toBe(1)
  expect(saved.controllers[0].policyMemory.actions.brake.samples).toBe(5)
})

it('reads native Commons final responses even without token deltas or a trailing newline', async () => {
  const { post } = await setup()
  vi.stubGlobal(
    'fetch',
    async () =>
      new Response(
        `data: ${JSON.stringify({ type: 'completed', payload: { type: 'ai', data: { content: JSON.stringify(planned) } } })}`,
        {
          headers: { 'Content-Type': 'text/event-stream' },
        },
      ),
  )
  const response = await post('controllers/seat/coach', {
    prompt: 'Accelerate.',
    observation,
  })
  expect(response.status, await response.clone().text()).toBe(200)
  expect((await response.json()).controller.strategy).toBe(planned.strategy)
})

it('repairs incomplete coaching before replacing the active strategy', async () => {
  const { post } = await setup()
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        'data: {"type":"final","payload":{"content":"{\\"strategy\\":\\"Attack constantly"}}\n\n',
      ),
    )
    .mockResolvedValueOnce(streamed(planned))
  vi.stubGlobal('fetch', fetcher)
  const response = await post('controllers/seat/coach', {
    prompt: 'Accelerate.',
    observation,
  })
  expect(response.status).toBe(200)
  expect((await response.json()).controller).toMatchObject({
    strategy: planned.strategy,
    strategyEpoch: 2,
  })
  expect(fetcher).toHaveBeenCalledTimes(2)
})

it('preserves the active strategy and learned memory when correction also fails', async () => {
  const { post, store } = await setup()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => streamed({ strategy: 'incomplete' })),
  )
  const response = await post('controllers/seat/coach', {
    prompt: 'Accelerate.',
    observation,
  })
  expect(response.status).toBe(500)
  expect((await response.json()).detail).toContain(
    'Your current strategy is still active',
  )
  const saved: any = await store.get('browser-runs:owner', 'run')
  expect(saved.controllers[0]).toMatchObject({
    strategy: 'Brake.',
    strategyEpoch: 1,
    policyMemory: { actions: { brake: { samples: 5 } } },
  })
})
