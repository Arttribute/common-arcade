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
    'https://arcade.agentcommons.io/api/arcade/v1/releases/rel_test',
    expect.objectContaining({ redirect: 'error' }),
  )
})

it('checks current availability before loading an immutable release for a new table', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ id: 'rel_test', status: 'published' }),
    )
    .mockResolvedValueOnce(new Response('', { status: 404 }))
  vi.stubGlobal('fetch', fetch)
  await expect(
    releaseLoader('https://registry.example')('rel_test'),
  ).rejects.toThrow('Published release unavailable')
  expect(fetch.mock.calls.map(([url]) => url)).toEqual([
    'https://registry.example/v1/releases/rel_test',
    'https://registry.example/v1/studio/releases/rel_test',
  ])
})

it('rejects an unpublished or mismatched descriptor without loading its retained payload', async () => {
  for (const descriptor of [
    { id: 'rel_test', status: 'unpublished' },
    { id: 'rel_other', status: 'published' },
  ]) {
    const fetch = vi.fn().mockResolvedValue(Response.json(descriptor))
    vi.stubGlobal('fetch', fetch)
    await expect(
      releaseLoader('https://registry.example')('rel_test'),
    ).rejects.toThrow('unavailable for new tables')
    expect(fetch).toHaveBeenCalledTimes(1)
  }
})
