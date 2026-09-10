import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { cookies } from 'next/headers'
import {
  copilotCredentialLifetimeMs,
  readSession,
  seal,
  unseal,
} from './session'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))
beforeEach(() => {
  vi.stubEnv(
    'ARCADE_SESSION_SECRET',
    'test-secret-with-at-least-thirty-two-characters',
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('Copilot credential lifetime', () => {
  async function setup(
    remainingMs: number,
    refreshToken: string | undefined = 'refresh',
  ) {
    const session = {
      id: 'user-1',
      name: 'Creator',
      accessToken: 'old',
      refreshToken,
      expiresAt: Date.now() + remainingMs,
    }
    const set = vi.fn()
    vi.mocked(cookies).mockResolvedValue({
      get: () => ({ value: '' }),
      set,
    } as never)
    const value = await seal(session)
    vi.mocked(cookies).mockResolvedValue({
      get: () => ({ value }),
      set,
    } as never)
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        access_token: 'fresh',
        refresh_token: 'rotated',
        expires_in: 3600,
      }),
    )
    vi.stubGlobal('fetch', fetch)
    return { set, fetch }
  }
  it('renews an otherwise valid token before a long-running job and persists the rotation', async () => {
    const { set, fetch } = await setup(60_000)
    expect((await readSession(copilotCredentialLifetimeMs))?.accessToken).toBe(
      'fresh',
    )
    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch.mock.calls[0]![1].body.get('resource')).toBe(
      'commons-platform',
    )
    expect(await unseal(set.mock.calls[0]![1])).toMatchObject({
      accessToken: 'fresh',
      refreshToken: 'rotated',
    })
  })
  it('does not refresh the same token for an ordinary short request', async () => {
    const { fetch } = await setup(60_000)
    expect((await readSession())?.accessToken).toBe('old')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('keeps a token that covers the entire job', async () => {
    const { fetch } = await setup(3600_000)
    expect((await readSession(copilotCredentialLifetimeMs))?.accessToken).toBe(
      'old',
    )
    expect(fetch).not.toHaveBeenCalled()
  })
  it('does not dispatch a job with a token whose renewal fails', async () => {
    const { fetch } = await setup(60_000)
    fetch.mockResolvedValue(Response.json({}, { status: 401 }))
    expect(await readSession(copilotCredentialLifetimeMs)).toBeNull()
  })
})
