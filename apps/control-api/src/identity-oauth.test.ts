import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAuthenticator } from './identity.js'
import { MemoryDocumentStore } from './store.js'
afterEach(() => vi.unstubAllGlobals())
describe('Commons opaque OAuth credentials', () => {
  const auth = () =>
    createAuthenticator(new MemoryDocumentStore(), {
      issuer: 'https://auth.agentcommons.io/api/auth',
    })
  it('uses verified actor and least-privilege grants from the Commons gateway', async () => {
    const fetcher = vi.fn().mockImplementation(async () =>
      Response.json({
        actorId: 'usr_verified',
        credentialType: 'oauth',
        actorType: 'user',
        scopes: ['agents:read'],
      }),
    )
    vi.stubGlobal('fetch', fetcher)
    expect(await auth()('Bearer opaque-token', 'projects:read')).toMatchObject({
      id: 'usr_verified',
      provider: 'commons',
      scopes: ['projects:read', 'matches:play'],
    })
    await expect(
      auth()('Bearer opaque-token', 'projects:write'),
    ).rejects.toMatchObject({ status: 403 })
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      'https://api.agentcommons.io/v1/identity',
    )
  })
  it('rejects revoked credentials and never resolves hosted local tokens remotely', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(Response.json({ error: 'inactive' }, { status: 401 }))
    vi.stubGlobal('fetch', fetcher)
    await expect(auth()('Bearer revoked-token')).rejects.toMatchObject({
      status: 401,
    })
    fetcher.mockClear()
    await expect(auth()('Bearer local:creator')).rejects.toMatchObject({
      status: 401,
    })
    expect(fetcher).not.toHaveBeenCalled()
  })
})
