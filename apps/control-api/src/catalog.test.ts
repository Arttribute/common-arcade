import { expect, it } from 'vitest'
import { getTicTacToeManifest } from '@common-arcade/example-tic-tac-toe'
import { starterDocument, type StudioRelease } from '@common-arcade/studio'
import { createApp } from './app.js'
import { MemoryDocumentStore } from './store.js'
import type { GameCatalogRecord } from './catalog.js'

const redline = 'gam_cc8de8704f48428cb0cd4d3e3aba5810'
const blackjack = 'gam_310da5dfaaab49f080756583615e5af2'
async function published(
  store: MemoryDocumentStore,
  gameId: string,
  title: string,
  releaseId = `rel_${gameId}`,
) {
  const manifest = await getTicTacToeManifest()
  const release: StudioRelease = {
    id: releaseId,
    projectId: `prj_${gameId}`,
    revision: 1,
    document: starterDocument,
    digest: manifest.metadata.digest,
    publishedAt: '2026-01-01T00:00:00.000Z',
    manifest: {
      ...manifest,
      metadata: { ...manifest.metadata, id: gameId, title },
    },
  }
  await store.put('releases', releaseId, { version: 1, release })
  return release.manifest
}

it('persists the two featured games separately without changing their immutable manifests', async () => {
  const store = new MemoryDocumentStore()
  const redlineManifest = await published(store, redline, 'Redline Run')
  const blackjackManifest = await published(
    store,
    blackjack,
    'Highstakes Blackjack',
  )
  const ordinaryManifest = await published(store, 'gam_other', 'Another game')
  const app = createApp({ store, logRequests: false })
  // Concurrent first reads must converge on the same CAS-created settings.
  const bodies = await Promise.all(
    [1, 2].map(async () => (await app.request('/v1/games')).json()),
  )
  for (const body of bodies) {
    expect(body.catalog).toEqual({
      [redline]: { isFeatured: true },
      [blackjack]: { isFeatured: true },
      gam_other: { isFeatured: false },
    })
    expect(body.games).toEqual([
      redlineManifest,
      blackjackManifest,
      ordinaryManifest,
    ])
  }
  expect(await store.list('game-catalog')).toHaveLength(2)
  // The flag survives another control-plane instance and another game release.
  await published(store, redline, 'Redline Run updated', 'rel_redline_second')
  const next = await (
    await createApp({ store, logRequests: false }).request('/v1/games')
  ).json()
  expect(next.catalog[redline].isFeatured).toBe(true)
  expect(next.games).toHaveLength(3)
})

it('respects explicit curation overrides and excludes unpublished/private game metadata', async () => {
  const store = new MemoryDocumentStore()
  await published(store, redline, 'Redline Run')
  await published(store, 'gam_new_feature', 'New feature')
  for (const record of [
    { gameId: redline, isFeatured: false },
    { gameId: 'gam_new_feature', isFeatured: true },
    { gameId: 'gam_private', isFeatured: true },
  ])
    await store.put('game-catalog', record.gameId, { version: 1, ...record })
  await store.put('owner:private-owner', 'prj_private', {
    version: 1,
    project: { id: 'prj_private', document: starterDocument },
  })
  const body = await (
    await createApp({ store, logRequests: false }).request('/v1/games')
  ).json()
  expect(body.catalog).toEqual({
    [redline]: { isFeatured: false },
    gam_new_feature: { isFeatured: true },
  })
  expect(
    (await store.get<GameCatalogRecord>('game-catalog', redline))?.version,
  ).toBe(1)
  expect(JSON.stringify(body)).not.toContain('gam_private')
  expect(body.catalog[blackjack]).toBeUndefined()
})
