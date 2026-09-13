import {
  GAME_ECONOMY_EXTENSION,
  publishedGameEconomySchema,
  type GameManifest,
} from '@common-arcade/protocol'

/** Discovery only; the payment service validates the pinned release before funding. */
export function paidHostingUnavailable(game: GameManifest): string | undefined {
  if (!['turn-based', 'realtime'].includes(game.spec.mode))
    return 'Entry stakes and prize pools are not available for this game mode yet. Paid hosting supports two-player turn-based and realtime games.'
  if (game.spec.seats.min > 2 || game.spec.seats.max < 2)
    return 'This release cannot run a two-player match. Paid hosting currently requires two players.'
  if (
    game.spec.runtime.type !== 'declarative' ||
    !['grid-placement', 'sandboxed-script-v1'].includes(
      game.spec.runtime.module,
    )
  )
    return 'This release does not have a supported live game runtime for paid matches.'
}

export function offersPaidHosting(game: GameManifest): boolean {
  if (paidHostingUnavailable(game)) return false
  const terms = publishedGameEconomySchema.safeParse(
    game.spec.extensions.find(
      (extension) => extension.id === GAME_ECONOMY_EXTENSION,
    )?.config,
  )
  return terms.success && terms.data.mode === 'revenue-share'
}
