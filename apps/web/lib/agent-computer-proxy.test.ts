import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { readSession } from './session'
import { GET, POST, PUT } from '../app/api/agent-computer/[...path]/route'

vi.mock('./session', () => ({ readSession: vi.fn() }))
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

const context = (operation = '') => ({
  params: Promise.resolve({
    path: [
      'agents',
      'agent_123',
      'computer',
      ...operation.split('/').filter(Boolean),
    ],
  }),
})
const request = (
  operation = '',
  method = 'GET',
  origin = 'https://arcade.example',
  body?: string,
) =>
  new NextRequest(
    `https://arcade.example/api/agent-computer/agents/agent_123/computer/${operation}`,
    {
      method,
      headers: {
        origin,
        authorization: 'Bearer malicious-caller',
        'content-type': 'application/json',
      },
      ...(body ? { body } : {}),
    },
  )
function authenticate() {
  vi.mocked(readSession).mockResolvedValue({
    id: 'owner',
    name: 'Owner',
    accessToken: 'owner-session-token',
    expiresAt: Date.now() + 3600000,
  })
  const fetch = vi
    .fn()
    .mockResolvedValue(Response.json({ data: { enabled: true } }))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

describe('Agent computer proxy', () => {
  it('requires a Commons owner session even when caller provides a bearer token', async () => {
    vi.mocked(readSession).mockResolvedValue(null)
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    expect((await GET(request(), context())).status).toBe(401)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('sends only the session credential to the owner-authorized Commons endpoint', async () => {
    const fetch = authenticate()
    const response = await GET(request('config'), context('config'))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toMatch(/\/v1\/agents\/agent_123\/computer\/config$/)
    expect(init.headers.Authorization).toBe('Bearer owner-session-token')
    expect(init.headers.cookie).toBeUndefined()
    expect(init.redirect).toBe('error')
  })
  it.each(['https://evil.example', 'null', ''])(
    'rejects write origin %s before authenticating or forwarding',
    async (origin) => {
      const fetch = authenticate()
      expect(
        (
          await POST(
            request('commands', 'POST', origin, '{"command":"pwd"}'),
            context('commands'),
          )
        ).status,
      ).toBe(403)
      expect(readSession).not.toHaveBeenCalled()
      expect(fetch).not.toHaveBeenCalled()
    },
  )
  it.each([
    'config/other',
    'files/write',
    '../wallets',
    'browser/test',
    'exec',
  ])('does not expose unused upstream operation %s', async (path) => {
    const fetch = authenticate()
    expect(
      (await POST(request('commands', 'POST'), context(path))).status,
    ).toBe(404)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('uses PUT for the real Commons config API without changing it on GET', async () => {
    const fetch = authenticate()
    expect(
      (
        await PUT(
          request('config', 'PUT', undefined, '{"enabled":true}'),
          context('config'),
        )
      ).status,
    ).toBe(200)
    expect(fetch.mock.calls[0]![1].method).toBe('PUT')
    expect(fetch.mock.calls[0]![1].body).toBe('{"enabled":true}')
  })
  it('preserves a file path as a query value and strips unrelated query parameters', async () => {
    const fetch = authenticate()
    const path = '/mnt/shared/a b.ts?scope=other'
    expect(
      (
        await GET(
          request(`files/read?path=${encodeURIComponent(path)}&agentId=other`),
          context('files/read'),
        )
      ).status,
    ).toBe(200)
    const url = new URL(fetch.mock.calls[0]![0])
    expect(url.searchParams.get('path')).toBe(path)
    expect(url.searchParams.has('agentId')).toBe(false)
  })
  it('bounds event reads and refuses missing file paths', async () => {
    const fetch = authenticate()
    expect(
      (await GET(request('events?limit=10000'), context('events'))).status,
    ).toBe(400)
    expect(
      (await GET(request('files/read'), context('files/read'))).status,
    ).toBe(400)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('rejects malformed and oversized commands without forwarding', async () => {
    const fetch = authenticate()
    expect(
      (
        await POST(
          request('commands', 'POST', undefined, '{broken'),
          context('commands'),
        )
      ).status,
    ).toBe(400)
    expect(
      (
        await POST(
          request(
            'commands',
            'POST',
            undefined,
            JSON.stringify({ command: 'x'.repeat(33000) }),
          ),
          context('commands'),
        )
      ).status,
    ).toBe(413)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('preserves upstream ownership denial', async () => {
    const fetch = authenticate()
    fetch.mockResolvedValue(
      Response.json({ error: 'Forbidden' }, { status: 403 }),
    )
    expect((await GET(request(), context())).status).toBe(403)
  })
  it('returns a recoverable error for unexpected upstream content', async () => {
    const fetch = authenticate()
    fetch.mockResolvedValue(
      new Response('<html>Bad gateway</html>', { status: 502 }),
    )
    expect((await GET(request(), context())).status).toBe(502)
  })
})
