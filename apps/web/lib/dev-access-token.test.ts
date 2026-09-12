import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { readSession } from './session'
import { devAccessToken, devAccessTokenUser } from './dev-access-token'
import {
  GET as proxyGet,
  POST as proxyPost,
} from '../app/api/arcade/[...path]/route'
import { GET as sessionGet } from '../app/api/auth/session/route'

vi.mock('./session', () => ({
  readSession: vi.fn(),
  copilotCredentialLifetimeMs: 660_000,
  cookieOptions: {},
  sessionCookie: 'test',
}))
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

const KEY = 'arc_localdevkey123'
function developmentWithKey() {
  vi.stubEnv('NODE_ENV', 'development')
  vi.stubEnv('ARCADE_DEV_ACCESS_TOKEN', KEY)
  vi.stubEnv('ARCADE_API_URL', 'https://api.example')
}
const context = { params: Promise.resolve({ path: ['v1', 'projects'] }) }
const request = (method: string, origin?: string) =>
  new NextRequest('https://arcade.example/api/arcade/v1/projects', {
    method,
    headers: origin ? { origin } : {},
    ...(method === 'GET' ? {} : { body: '{}' }),
  })

describe('local development access key', () => {
  it('is ignored outside local development', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('ARCADE_DEV_ACCESS_TOKEN', KEY)
    expect(devAccessToken()).toBeUndefined()
  })

  it('only accepts Arcade access keys', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('ARCADE_DEV_ACCESS_TOKEN', 'eyJhbGciOi.not.an.arcade.key')
    expect(devAccessToken()).toBeUndefined()
  })

  it('authorises reads through the proxy when nobody is signed in', async () => {
    developmentWithKey()
    vi.mocked(readSession).mockResolvedValue(null)
    const fetch = vi.fn().mockResolvedValue(Response.json({ projects: [] }))
    vi.stubGlobal('fetch', fetch)
    expect((await proxyGet(request('GET'), context)).status).toBe(200)
    expect(fetch.mock.calls[0]![1].headers.get('authorization')).toBe(
      `Bearer ${KEY}`,
    )
  })

  it('does not attach the key to changes from another site', async () => {
    developmentWithKey()
    vi.mocked(readSession).mockResolvedValue(null)
    const fetch = vi.fn().mockResolvedValue(Response.json({}))
    vi.stubGlobal('fetch', fetch)
    await proxyPost(request('POST', 'https://other.example'), context)
    expect(fetch.mock.calls[0]![1].headers.get('authorization')).toBeNull()
  })

  it('attaches the key to changes made from the page itself', async () => {
    developmentWithKey()
    vi.mocked(readSession).mockResolvedValue(null)
    const fetch = vi.fn().mockResolvedValue(Response.json({}))
    vi.stubGlobal('fetch', fetch)
    await proxyPost(request('POST', 'https://arcade.example'), context)
    expect(fetch.mock.calls[0]![1].headers.get('authorization')).toBe(
      `Bearer ${KEY}`,
    )
  })

  it('prefers a real Commons session over the key', async () => {
    developmentWithKey()
    vi.mocked(readSession).mockResolvedValue({
      id: 'creator',
      name: 'Creator',
      accessToken: 'commons',
      expiresAt: Date.now() + 3600_000,
    })
    const fetch = vi.fn().mockResolvedValue(Response.json({}))
    vi.stubGlobal('fetch', fetch)
    await proxyGet(request('GET'), context)
    expect(fetch.mock.calls[0]![1].headers.get('authorization')).toBe(
      'Bearer commons',
    )
  })

  it("reports the key's account as the signed-in user", async () => {
    developmentWithKey()
    vi.mocked(readSession).mockResolvedValue(null)
    const fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json({ id: 'user_123', provider: 'api-key', scopes: [] }),
      )
    vi.stubGlobal('fetch', fetch)
    const body = await (await sessionGet()).json()
    expect(body.user).toEqual({ id: 'user_123', name: 'Local dev key' })
    expect(fetch.mock.calls[0]![0]).toBe('https://api.example/v1/me')
  })

  it('stays signed out when the API rejects the key', async () => {
    developmentWithKey()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({}, { status: 401 })),
    )
    expect(await devAccessTokenUser()).toBeNull()
  })
})
