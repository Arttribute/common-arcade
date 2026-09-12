import type { StudioRelease } from '@common-arcade/studio'
import type { DocumentStore, StoredDocument } from './store.js'

/** Availability is mutable; immutable release payloads and pinned games remain intact. */
export type GamePublicationRecord = StoredDocument & {
  projectId: string
  isPublished: boolean
  updatedAt: string
}
export type ReleaseRecord = StoredDocument & { release: StudioRelease }

export async function publicationRecord(
  store: DocumentStore,
  projectId: string,
) {
  return store.get<GamePublicationRecord>('game-publications', projectId)
}

export async function setPublication(
  store: DocumentStore,
  projectId: string,
  isPublished: boolean,
  previous: GamePublicationRecord | undefined,
) {
  if (previous?.isPublished === isPublished) return previous
  const next: GamePublicationRecord = {
    version: (previous?.version ?? 0) + 1,
    projectId,
    isPublished,
    updatedAt: new Date().toISOString(),
  }
  await store.put('game-publications', projectId, next, previous?.version)
  return next
}

export async function publishedReleases(store: DocumentStore) {
  const [releases, availability] = await Promise.all([
    store.list<ReleaseRecord>('releases'),
    store.list<GamePublicationRecord>('game-publications'),
  ])
  const unpublished = new Set(
    availability
      .filter((record) => !record.isPublished)
      .map((record) => record.projectId),
  )
  // Pre-existing releases have no availability record and stay published.
  return releases.filter(({ release }) => !unpublished.has(release.projectId))
}

export async function releaseIsPublished(
  store: DocumentStore,
  releaseId: string,
) {
  if (releaseId === 'rel_tictactoe1') return true
  const record = await store.get<ReleaseRecord>('releases', releaseId)
  return Boolean(
    record &&
    (await publicationRecord(store, record.release.projectId))?.isPublished !==
      false,
  )
}
