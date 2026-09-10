import { afterEach, expect, it, vi } from 'vitest'
import { releaseLoader } from './releases.js'

afterEach(() => vi.unstubAllGlobals())

it('loads published games through a registry mounted under a proxy path', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('', { status: 404 }))
  vi.stubGlobal('fetch', fetch)
  await expect(
    releaseLoader('https://arcade.agentcommons.io/api/arcade/')('rel_test'),
  ).rejects.toThrow('Published release unavailable')
  expect(fetch).toHaveBeenCalledWith(
    'https://arcade.agentcommons.io/api/arcade/v1/studio/releases/rel_test',
    expect.objectContaining({ redirect: 'error' }),
  )
})
