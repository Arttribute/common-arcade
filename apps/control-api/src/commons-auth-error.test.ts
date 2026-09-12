import { afterEach, expect, it, vi } from 'vitest'
import { commonsRequest } from './studio.js'

afterEach(() => vi.unstubAllGlobals())
it('preserves an upstream credential rejection as 401 so the web session can recover', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { error: { message: 'Missing or invalid Commons credential' } },
          { status: 401 },
        ),
      ),
  )
  await expect(
    commonsRequest(
      { id: 'creator', provider: 'commons', scopes: [], token: 'expired' },
      '/v1/agents',
    ),
  ).rejects.toMatchObject({
    status: 401,
    message: 'Commons agent service: Missing or invalid Commons credential',
  })
})
