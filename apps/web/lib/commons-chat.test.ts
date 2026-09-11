import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { readSession } from './session'
import { GET, POST } from '../app/api/commons-chat/route'
vi.mock('./session', () => ({ readSession: vi.fn() }))
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})
const auth = {
  id: 'creator',
  name: 'Creator',
  accessToken: 'token',
  expiresAt: Date.now() + 3600000,
}
const request = (body: unknown, origin = 'https://arcade.example') =>
  new NextRequest('https://arcade.example/api/commons-chat', {
    method: 'POST',
    headers: { origin, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
describe('general Commons chat boundary', () => {
  it('rejects cross-origin requests before accessing Commons', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    expect(
      (
        await POST(
          request({ agentId: 'a', message: 'Hi' }, 'https://other.example'),
        )
      ).status,
    ).toBe(403)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('requires a signed-in user', async () => {
    vi.mocked(readSession).mockResolvedValue(null)
    expect(
      (
        await GET(
          new NextRequest('https://arcade.example/api/commons-chat?agentId=a'),
        )
      ).status,
    ).toBe(401)
  })
  it('scopes history to the authenticated user and excludes build sessions', async () => {
    vi.mocked(readSession).mockResolvedValue(auth)
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        data: [
          { sessionId: 's1', initiatorType: 'arcade-chat' },
          { sessionId: 'build', initiatorType: 'web' },
        ],
      }),
    )
    vi.stubGlobal('fetch', fetch)
    const response = await GET(
      new NextRequest(
        'https://arcade.example/api/commons-chat?agentId=agent&initiator=other',
      ),
    )
    expect(await response.json()).toEqual({
      sessions: [{ sessionId: 's1', initiatorType: 'arcade-chat' }],
    })
    expect(fetch.mock.calls[0]?.[0]).toContain('/sessions/list/agent/creator/')
  })
  it('does not read or send into a session outside the caller’s chat list', async () => {
    vi.mocked(readSession).mockResolvedValue(auth)
    const fetch = vi.fn().mockResolvedValue(Response.json({ data: [] }))
    vi.stubGlobal('fetch', fetch)
    expect(
      (await POST(request({ agentId: 'a', sessionId: 'other', message: 'Hi' })))
        .status,
    ).toBe(404)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('creates a normal session and runs the agent without project or revision requests', async () => {
    vi.mocked(readSession).mockResolvedValue(auth)
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ data: [] }))
      .mockResolvedValueOnce(Response.json({ data: { sessionId: 'new' } }))
      .mockResolvedValueOnce(Response.json({ content: 'Hello' }))
      .mockResolvedValueOnce(
        Response.json({
          data: {
            sessionId: 'new',
            history: [{ role: 'assistant', content: 'Hello' }],
          },
        }),
      )
    vi.stubGlobal('fetch', fetch)
    const response = await POST(request({ agentId: 'a', message: 'Hi' }))
    expect(response.status).toBe(200)
    expect(JSON.parse(fetch.mock.calls[1]?.[1].body)).toEqual({
      agentId: 'a',
      title: 'Hi',
      source: 'arcade-chat',
    })
    expect(fetch.mock.calls[2]?.[0]).toContain('/agents/run')
    expect(JSON.parse(fetch.mock.calls[2]?.[1].body)).toEqual({
      agentId: 'a',
      sessionId: 'new',
      messages: [{ role: 'user', content: 'Hi' }],
    })
  })
})
