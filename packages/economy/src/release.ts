import {
  GAME_ECONOMY_EXTENSION,
  publishedGameEconomySchema,
  type GameManifest,
} from '@common-arcade/protocol'
import { type Address, zeroAddress } from 'viem'
import type { EconomyConfig } from './config.js'
export interface CreatorRevenue {
  creator: Address
  creatorShareBps: number
  releaseDigest: string
  royalties: { recipient: Address; bps: number }[]
}
/** Resolve payout terms from the immutable release, never from a match host's recipient input. */
export function resolveCreatorRevenue(
  manifest: GameManifest,
  selection: EconomyConfig,
): CreatorRevenue {
  const matches =
    manifest.spec.extensions?.filter((e) => e.id === GAME_ECONOMY_EXTENSION) ??
    []
  if (matches.length > 1) throw new Error('Ambiguous release economy')
  const policy = publishedGameEconomySchema.parse(
    matches[0]?.config ?? { mode: 'free' },
  )
  const empty = {
    creator: zeroAddress,
    creatorShareBps: 0,
    releaseDigest: manifest.metadata.digest,
    royalties: [],
  }
  if (selection.mode === 'free') return empty
  if (policy.mode === 'free')
    throw new Error('This release permits free play only')
  const mode = BigInt(selection.stakeUnits) > 0n ? 'staked' : 'sponsored'
  if (!policy.allowedModes.includes(mode))
    throw new Error('The creator has not enabled this earning mode')
  if (mode === 'sponsored' && !selection.bounties)
    throw new Error('Sponsored matches require bounties')
  if (selection.spectatorBets && !policy.spectatorBets)
    throw new Error('The creator has not enabled spectator betting')
  const creator = policy.payouts[selection.network]
  if (!creator) throw new Error('Creator payout network is not configured')
  if (selection.feeBps !== policy.feeBps)
    throw new Error('Fee must match the published release')
  return {
    creator: creator as Address,
    creatorShareBps: policy.creatorShareBps,
    releaseDigest: manifest.metadata.digest,
    royalties: (policy.royalties?.[selection.network] ?? []) as {
      recipient: Address
      bps: number
    }[],
  }
}
