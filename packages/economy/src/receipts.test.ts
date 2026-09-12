import { describe, expect, it } from 'vitest'
import { settlementAccounting, transactionExplorerUrl } from './receipts.js'

describe('payment receipt links', () => {
  const hash = `0x${'ab'.repeat(32)}`
  it('uses the receipt rail and the correct explorer route', () => {
    expect(transactionExplorerUrl('eip155:84532', hash)).toBe(
      `https://sepolia.basescan.org/tx/${hash}`,
    )
    expect(transactionExplorerUrl('hedera:testnet', hash)).toBe(
      `https://hashscan.io/testnet/transaction/${hash}`,
    )
    expect(transactionExplorerUrl('eip155:296', hash)).toBe(
      `https://hashscan.io/testnet/transaction/${hash}`,
    )
    expect(transactionExplorerUrl('celo-sepolia', hash)).toBe(
      `https://celo-sepolia.blockscout.com/tx/${hash}`,
    )
    expect(
      transactionExplorerUrl('hedera:testnet', '0.0.12@1234567890.123456789'),
    ).toBe(
      'https://hashscan.io/testnet/transaction/0.0.12%401234567890.123456789',
    )
  })
  it('does not manufacture a receipt for unknown networks or non-transactions', () => {
    expect(transactionExplorerUrl('unknown', hash)).toBeUndefined()
    expect(transactionExplorerUrl('base', 'pending')).toBeUndefined()
    expect(
      transactionExplorerUrl('base', '0.0.12@1234567890.123456789'),
    ).toBeUndefined()
  })
})

describe('confirmed escrow allocation accounting', () => {
  const input = {
    status: 3,
    prizePool: 2000000n,
    betPool: 1000000n,
    winningShares: 400000n,
    winnerRecipient: 'winner',
    terms: {
      feeBps: 250,
      creatorShareBps: 4000,
      creator: 'creator',
      treasury: 'platform',
      royalties: [{ recipient: 'original-creator', bps: 2500 }],
    },
  }
  it('accounts for all deposited funds including spectator profit fees and remix royalties', () => {
    const result = settlementAccounting(input)!
    expect(result.feeUnits).toBe('65000')
    expect(result.allocations).toEqual([
      { role: 'winner', recipient: 'winner', amountUnits: '1950000' },
      { role: 'creator', recipient: 'creator', amountUnits: '19500' },
      { role: 'royalty', recipient: 'original-creator', amountUnits: '6500' },
      { role: 'platform', recipient: 'platform', amountUnits: '39000' },
    ])
    expect(
      result.allocations.reduce(
        (sum, row) => sum + BigInt(row.amountUnits),
        BigInt(result.spectatorPayoutUnits),
      ),
    ).toBe(input.prizePool + input.betPool)
  })
  it('refunds spectator principal without a fee when no spectator backed the winner', () => {
    const result = settlementAccounting({ ...input, winningShares: 0n })!
    expect(result.spectatorPayoutUnits).toBe('1000000')
    expect(result.feeUnits).toBe('50000')
  })
  it('preserves integer rounding for large pools', () => {
    const prizePool = 9007199254740993123456789n
    const result = settlementAccounting({
      ...input,
      prizePool,
      betPool: 0n,
      winningShares: 0n,
    })!
    expect(
      result.allocations.reduce(
        (sum, row) => sum + BigInt(row.amountUnits),
        0n,
      ),
    ).toBe(prizePool)
  })
  it('shows refunded contributions, not earnings, for voided games', () => {
    const result = settlementAccounting({ ...input, status: 4 })!
    expect(result.status).toBe('refundable')
    expect(result.feeUnits).toBe('0')
    expect(result.allocations).toEqual([])
  })
  it('does not show projected allocations as settled payouts', () => {
    expect(settlementAccounting({ ...input, status: 2 })).toBeUndefined()
  })
})
