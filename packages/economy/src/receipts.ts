import { NETWORKS } from './networks.js'

/** A receipt belongs to its payment rail, never to the currently selected form network. */
export function transactionExplorerUrl(
  network: string,
  transaction: string,
): string | undefined {
  const rail = Object.values(NETWORKS).find(
    (item) =>
      item.id === network ||
      item.x402Network === network ||
      `eip155:${item.chain.id}` === network,
  )
  if (!rail) return undefined
  const evmHash = /^0x[0-9a-fA-F]{64}$/.test(transaction)
  const hederaId =
    /^\d+\.\d+\.\d+[@-]\d+[.-]\d+$/.test(transaction) ||
    /^\d+\.\d{9}$/.test(transaction)
  if (!evmHash && !(rail.id === 'hedera-testnet' && hederaId)) return undefined
  return `${rail.explorer}/${rail.id === 'hedera-testnet' ? 'transaction' : 'tx'}/${encodeURIComponent(transaction)}`
}

export interface SettlementAccounting {
  status: 'allocated' | 'refundable'
  prizePoolUnits: string
  spectatorPoolUnits: string
  /** Pool-level entitlements; withdrawal is a separate transaction. */
  allocations: {
    role: 'winner' | 'creator' | 'royalty' | 'platform'
    recipient: string
    amountUnits: string
  }[]
  spectatorPayoutUnits: string
  feeUnits: string
}

/** Reproduce contract integer arithmetic from confirmed onchain terms and pools. */
export function settlementAccounting(input: {
  status: number
  prizePool: bigint
  betPool: bigint
  winningShares: bigint
  winnerRecipient: string
  terms: {
    feeBps: number
    creatorShareBps: number
    creator: string
    treasury: string
    royalties: readonly { recipient: string; bps: number }[]
  }
}): SettlementAccounting | undefined {
  if (input.status !== 3 && input.status !== 4) return undefined
  const { prizePool, betPool, terms } = input
  if (input.status === 4)
    return {
      status: 'refundable',
      prizePoolUnits: prizePool.toString(),
      spectatorPoolUnits: betPool.toString(),
      allocations: [],
      spectatorPayoutUnits: betPool.toString(),
      feeUnits: '0',
    }
  const prizeFee = (prizePool * BigInt(terms.feeBps)) / 10000n
  const betFee =
    input.winningShares === 0n
      ? 0n
      : ((betPool - input.winningShares) * BigInt(terms.feeBps)) / 10000n
  const fee = prizeFee + betFee
  const creatorFee = (fee * BigInt(terms.creatorShareBps)) / 10000n
  const royalties = terms.royalties.map((share) => ({
    role: 'royalty' as const,
    recipient: share.recipient,
    amountUnits: ((creatorFee * BigInt(share.bps)) / 10000n).toString(),
  }))
  const royaltyTotal = royalties.reduce(
    (total, share) => total + BigInt(share.amountUnits),
    0n,
  )
  return {
    status: 'allocated',
    prizePoolUnits: prizePool.toString(),
    spectatorPoolUnits: betPool.toString(),
    allocations: [
      {
        role: 'winner' as const,
        recipient: input.winnerRecipient,
        amountUnits: (prizePool - prizeFee).toString(),
      },
      {
        role: 'creator' as const,
        recipient: terms.creator,
        amountUnits: (creatorFee - royaltyTotal).toString(),
      },
      ...royalties,
      {
        role: 'platform' as const,
        recipient: terms.treasury,
        amountUnits: (fee - creatorFee).toString(),
      },
    ].filter((allocation) => BigInt(allocation.amountUnits) > 0n),
    spectatorPayoutUnits: (betPool - betFee).toString(),
    feeUnits: fee.toString(),
  }
}
