import { afterEach, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { commonsAgentJson } from './studio.js'

const principal = {
  id: 'owner',
  token: 'test',
  provider: 'commons' as const,
  scopes: ['matches:play'],
}
const body = {
  agentId: 'player',
  messages: [{ role: 'user', content: 'Attack when legal.' }],
}
const schema = z
  .object({ actionIndex: z.number().int().min(0).max(1), reason: z.string() })
  .strict()
const options = {
  label: 'game decision',
  failureMessage: 'No valid decision; the current controller remains active.',
  timeoutMs: 45000,
}
const valid = '{"actionIndex":1,"reason":"Attack"}'
const response = (content: string) =>
  new Response(
    `data: ${JSON.stringify({ type: 'final', payload: { content } })}\n\n`,
  )
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it.each([
  '{"strategy":"Attack constantly: drive forward by default',
  '{"actionIndex":1,"reason":"Attack",}',
  '{"actionIndex":99,"reason":"Attack"}',
  '{"actionIndex":1}',
  'I will attack constantly.',
  '',
])('automatically corrects an unusable reply: %s', async (invalid) => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(response(invalid))
    .mockResolvedValueOnce(response(valid))
  vi.stubGlobal('fetch', fetcher)
  expect(await commonsAgentJson(principal, body, schema, options)).toEqual({
    actionIndex: 1,
    reason: 'Attack',
  })
  expect(fetcher).toHaveBeenCalledTimes(2)
  const retry = JSON.parse(fetcher.mock.calls[1]![1].body)
  expect(retry.messages[0]).toEqual(body.messages[0])
  expect(retry.messages.at(-1).content).toContain('COMPLETE, compact JSON')
})

it('uses complete valid deltas when a malformed final would overwrite them', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response(
        `data: ${JSON.stringify({ type: 'token', phase: 'final_answer', content: valid })}\n\ndata: ${JSON.stringify({ type: 'final', payload: { content: '{"actionIndex":' } })}\n\n`,
      ),
    )
  vi.stubGlobal('fetch', fetcher)
  expect(
    (await commonsAgentJson(principal, body, schema, options)).actionIndex,
  ).toBe(1)
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it('does not install partial JSON or retry indefinitely', async () => {
  const fetcher = vi
    .fn()
    .mockImplementation(async () => response('{"actionIndex":1'))
  vi.stubGlobal('fetch', fetcher)
  await expect(
    commonsAgentJson(principal, body, schema, options),
  ).rejects.toThrow(options.failureMessage)
  expect(fetcher).toHaveBeenCalledTimes(2)
})

it.each([401, 402, 403, 429, 502])(
  'does not replay HTTP %s failures',
  async (status) => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response('Unavailable', { status }))
    vi.stubGlobal('fetch', fetcher)
    await expect(
      commonsAgentJson(principal, body, schema, options),
    ).rejects.toThrow('Commons agent service')
    expect(fetcher).toHaveBeenCalledTimes(1)
  },
)

it('keeps correction inside the original request deadline', async () => {
  vi.spyOn(Date, 'now')
    .mockReturnValueOnce(0)
    .mockReturnValueOnce(0)
    .mockReturnValue(46000)
  const fetcher = vi.fn().mockResolvedValue(response('incomplete'))
  vi.stubGlobal('fetch', fetcher)
  await expect(
    commonsAgentJson(principal, body, schema, options),
  ).rejects.toThrow(options.failureMessage)
  expect(fetcher).toHaveBeenCalledTimes(1)
})
