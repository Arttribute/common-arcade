import {
  gameDocumentSchema,
  gameManifestSchema,
  gameMonetizationSchema,
  publishedGameEconomySchema,
  GAME_ECONOMY_EXTENSION,
  type StudioRelease,
} from '@common-arcade/protocol'
import { documentDigest, assessLiveReadiness } from '@common-arcade/studio'
import { computeManifestDigest } from '@common-arcade/manifest'
/** Trusted registry URL is deployment configuration; callers supply only a release ID. */
export function releaseLoader(registry: string) {
  const base = new URL(registry).href.replace(/\/$/, '')
  return async (id: string): Promise<StudioRelease> => {
    if (!/^rel_[A-Za-z0-9_-]{1,190}$/.test(id))
      throw new Error('Invalid release ID')
    // Only new tables use this loader. Existing tables retain their pinned
    // release payload and continue after a creator unpublishes the game.
    const availability = await fetch(`${base}/v1/releases/${id}`, {
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    })
    if (!availability.ok)
      throw new Error('Published release unavailable for new tables')
    const descriptor = (await availability.json()) as {
      id?: string
      status?: string
    }
    if (descriptor.id !== id || descriptor.status !== 'published')
      throw new Error('Published release unavailable for new tables')
    const response = await fetch(`${base}/v1/studio/releases/${id}`, {
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) throw new Error('Published release unavailable')
    const text = await response.text()
    if (text.length > 2_000_000)
      throw new Error('Release exceeds preview size limit')
    const release = JSON.parse(text) as StudioRelease
    release.document = gameDocumentSchema.parse(release.document)
    release.manifest = gameManifestSchema.parse(release.manifest)
    if (
      release.id !== id ||
      (await documentDigest(release.document)) !== release.digest ||
      (await computeManifestDigest(release.manifest)) !==
        release.manifest.metadata.digest
    )
      throw new Error('Published release digest mismatch')
    const published = publishedGameEconomySchema.parse(
      release.manifest.spec.extensions.find(
        (e) => e.id === GAME_ECONOMY_EXTENSION,
      )?.config ?? { mode: 'free' },
    )
    const { royalties: _royalties, ...authoredPublished } =
      published as Extract<typeof published, { mode: 'revenue-share' }>
    if (
      JSON.stringify(authoredPublished) !==
      JSON.stringify(
        gameMonetizationSchema.parse(
          release.document.monetization ?? { mode: 'free' },
        ),
      )
    )
      throw new Error('Published earning terms mismatch')
    if (
      !assessLiveReadiness(release.document).liveReady ||
      release.manifest.spec.mode !== 'turn-based' ||
      release.manifest.spec.seats.min > 2 ||
      release.manifest.spec.seats.max < 2
    )
      throw new Error(
        'Paid preview currently supports two-seat turn-based authoritative games',
      )
    return release
  }
}
