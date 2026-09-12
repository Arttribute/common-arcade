import {
  StoreConflict,
  type DocumentStore,
  type StoredDocument,
} from './store.js'

/** Curation is mutable catalog metadata, never part of a signed manifest. */
export type GameCatalogRecord = StoredDocument & {
  gameId: string
  isFeatured: boolean
}
const initialFeaturedGames = [
  'gam_cc8de8704f48428cb0cd4d3e3aba5810', // Redline Run
  'gam_310da5dfaaab49f080756583615e5af2', // Highstakes Blackjack
] as const

export async function catalogMetadata(
  store: DocumentStore,
  publishedGameIds: string[],
) {
  const records = new Map(
    (await store.list<GameCatalogRecord>('game-catalog')).map((record) => [
      record.gameId,
      record,
    ]),
  )
  const published = new Set(publishedGameIds)
  // Bootstrap the requested curation once. Existing true/false records win,
  // so subsequent administrative updates never require changing releases.
  for (const gameId of initialFeaturedGames) {
    if (!published.has(gameId) || records.has(gameId)) continue
    const record: GameCatalogRecord = { version: 1, gameId, isFeatured: true }
    try {
      await store.put('game-catalog', gameId, record)
      records.set(gameId, record)
    } catch (error) {
      if (!(error instanceof StoreConflict)) throw error
      const current = await store.get<GameCatalogRecord>('game-catalog', gameId)
      if (current) records.set(gameId, current)
    }
  }
  // Draft/private game IDs and internal curation records never enter discovery.
  return Object.fromEntries(
    publishedGameIds.map((gameId) => [
      gameId,
      {
        isFeatured: records.get(gameId)?.isFeatured === true,
      },
    ]),
  )
}
