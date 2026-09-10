import {
  GAME_ECONOMY_EXTENSION,
  GAME_REMIX_EXTENSION,
  publishedGameEconomySchema,
  type GameMonetization,
  type PublishedGameEconomy,
  type StudioRelease,
} from '@common-arcade/protocol'
/** Flatten inherited obligations once at the fork boundary; no recursive contract calls. */
export function inheritedRemixEconomy(
  source: StudioRelease,
): PublishedGameEconomy | undefined {
  const policy = publishedGameEconomySchema.parse(
    source.manifest.spec.extensions.find((e) => e.id === GAME_ECONOMY_EXTENSION)
      ?.config ?? { mode: 'free' },
  )
  const rate = source.distribution?.revenueShareBps ?? 0
  if (policy.mode === 'free') {
    const lineage = source.manifest.spec.extensions.find(
      (e) => e.id === GAME_REMIX_EXTENSION,
    )?.config as { inheritedEconomy?: unknown } | undefined
    return lineage?.inheritedEconomy
      ? publishedGameEconomySchema.parse(lineage.inheritedEconomy)
      : undefined
  }
  const royalties: NonNullable<
    Extract<PublishedGameEconomy, { mode: 'revenue-share' }>['royalties']
  > = {}
  for (const network of Object.keys(
    policy.payouts,
  ) as (keyof typeof policy.payouts)[]) {
    const previous = policy.royalties?.[network] ?? [],
      total = previous.reduce((sum, p) => sum + p.bps, 0)
    const shares = new Map(
      previous.map((p) => [p.recipient.toLowerCase(), p.bps]),
    )
    const added = Math.floor(((10000 - total) * rate) / 10000),
      recipient = policy.payouts[network]!
    if (added)
      shares.set(
        recipient.toLowerCase(),
        (shares.get(recipient.toLowerCase()) ?? 0) + added,
      )
    if (shares.size > 8)
      throw new Error('Remix royalty recipient limit reached (8)')
    royalties[network] = [...shares].map(([recipient, bps]) => ({
      recipient,
      bps,
    }))
  }
  return { ...policy, royalties }
}
export function publishGameEconomy(
  authored: GameMonetization | undefined,
  inherited: PublishedGameEconomy | undefined,
): PublishedGameEconomy {
  const policy = authored ?? { mode: 'free' }
  if (policy.mode === 'free') return policy
  if (inherited?.mode !== 'revenue-share') return policy
  for (const network of Object.keys(
    policy.payouts,
  ) as (keyof typeof policy.payouts)[]) {
    const hasRoyalties = Object.values(inherited.royalties ?? {}).some(
      (list) => list.length,
    )
    if (hasRoyalties && !inherited.payouts[network])
      throw new Error('This network has no inherited royalty recipients')
    if (hasRoyalties && policy.creatorShareBps < inherited.creatorShareBps)
      throw new Error('Creator share cannot reduce inherited royalties')
  }
  return publishedGameEconomySchema.parse({
    ...policy,
    royalties: inherited.royalties,
  })
}

/** Legacy royalty metadata can be remixed freely, but paid publication needs resolvable recipients. */
export function unresolvedRemixRoyalty(source: StudioRelease): boolean {
  const policy = source.manifest.spec.extensions.find(
    (e) => e.id === GAME_ECONOMY_EXTENSION,
  )?.config as { mode?: string } | undefined
  const lineage = source.manifest.spec.extensions.find(
    (e) => e.id === GAME_REMIX_EXTENSION,
  )?.config as { unresolvedRemixRoyalty?: boolean } | undefined
  return (
    !!lineage?.unresolvedRemixRoyalty ||
    ((source.distribution?.revenueShareBps ?? 0) > 0 &&
      policy?.mode !== 'revenue-share')
  )
}
