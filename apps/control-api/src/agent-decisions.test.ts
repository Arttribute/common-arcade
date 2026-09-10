import { afterEach, expect, it, vi } from 'vitest'
import { commonsAgentText } from './studio.js'
const principal = {
  id: 'creator',
  scopes: ['matches:play'],
  token: 'test-token',
  provider: 'commons' as const,
}
afterEach(() => vi.unstubAllGlobals())
function stream(events: unknown[], finalNewline = true) {
  const text =
    events.map((event) => `data: ${JSON.stringify(event)}`).join('\r\n\r\n') +
    (finalNewline ? '\r\n\r\n' : '')
  // Split in the middle of JSON and UTF-8 to exercise actual network framing.
  const bytes = new TextEncoder().encode(text)
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              for (let i = 0; i < bytes.length; i += 7)
                controller.enqueue(bytes.slice(i, i + 7))
              controller.close()
            },
          }),
        ),
    ),
  )
}
it('reads native Commons serialized final messages and content blocks without token events', async () => {
  stream(
    [
      { type: 'keepalive' },
      {
        type: 'final',
        payload: {
          type: 'ai',
          data: {
            content: [
              { type: 'text', text: '{"actionIndex":1,"reason":"Go →"}' },
            ],
          },
        },
      },
    ],
    false,
  )
  expect(JSON.parse(await commonsAgentText(principal, {}))).toEqual({
    actionIndex: 1,
    reason: 'Go →',
  })
})
it('uses the complete final answer instead of incomplete streamed tokens', async () => {
  stream([
    { type: 'token', phase: 'final_answer', content: '{"actionIndex":' },
    { type: 'final', payload: { content: '{"actionIndex":2}' } },
  ])
  expect(JSON.parse(await commonsAgentText(principal, {}))).toEqual({
    actionIndex: 2,
  })
})
it('preserves upstream failure reasons instead of reporting a missing action', async () => {
  stream([{ type: 'error', message: 'Agent credit limit reached' }])
  await expect(commonsAgentText(principal, {})).rejects.toThrow(
    'Agent credit limit reached',
  )
})
it('rejects empty decisions without inventing an action', async () => {
  stream([{ type: 'final', payload: { type: 'ai', data: { content: [] } } }])
  await expect(commonsAgentText(principal, {})).rejects.toThrow(
    'returned no decision',
  )
})

it('turns the native Commons final message into the exact advertised live action', async () => {
  const { createStudioApi } = await import('./studio.js')
  const { MemoryDocumentStore } = await import('./store.js')
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      String(url).endsWith('/run/stream')
        ? new Response(
            'data: ' +
              JSON.stringify({
                type: 'final',
                payload: {
                  type: 'ai',
                  data: {
                    content: '{"actionIndex":1,"reason":"Keep accelerating"}',
                  },
                },
              }) +
              '\n\n',
          )
        : Response.json({ data: { agentId: 'driver' } }),
    ),
  )
  const app = createStudioApi(new MemoryDocumentStore(), async () => principal)
  const response = await app.request('/v1/commons/live-decisions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agentId: 'driver',
      observation: {
        seatId: 'sea_one',
        stateSequence: 12,
        visibleState: { speed: 40 },
        legalActions: [{ type: 'brake' }, { type: 'throttle', value: 1 }],
      },
    }),
  })
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({
    action: { type: 'throttle', value: 1 },
    reason: 'Keep accelerating',
    basedOnStateSequence: 12,
  })
})

it('retries safe agent lookups through transient gateway errors without exposing HTML', async () => {
  const { commonsRequest } = await import('./studio.js')
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(new Response('<html>503</html>', { status: 503 }))
    .mockResolvedValueOnce(Response.json({ data: { agentId: 'player' } }))
  vi.stubGlobal('fetch', fetcher)
  expect(await commonsRequest(principal, '/v1/agents/player')).toEqual({
    agentId: 'player',
  })
  expect(fetcher).toHaveBeenCalledTimes(2)
})
it('does not replay a potentially billable POST after an ambiguous upstream failure', async () => {
  const { commonsRequest } = await import('./studio.js')
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response('<html>Bad Gateway</html>', { status: 502 }),
    )
  vi.stubGlobal('fetch', fetcher)
  await expect(commonsRequest(principal, '/v1/agents/run', {})).rejects.toThrow(
    'temporarily unavailable (HTTP 502)',
  )
  expect(fetcher).toHaveBeenCalledTimes(1)
})
