import {
  arcadeEscrowAbi,
  hashArcadeId,
  type EscrowDeployment,
  type EconomyConfig,
} from '@common-arcade/economy'
import {
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem'
export interface PoolTerms {
  id: Hex
  rulesHash: Hex
  recipients: Address[]
  seatIds: string[]
  fundingDeadline: number
  settlementDeadline: number
  creator?: Address
  creatorShareBps?: number
  royalties?: { recipient: Address; bps: number }[]
  config: Extract<EconomyConfig, { mode: 'escrow' }>
}
export interface MatchSettlementAdapter {
  deployment: EscrowDeployment
  create(terms: PoolTerms): Promise<Hex>
  lock(id: Hex): Promise<Hex | undefined>
  settle(
    id: Hex,
    winner: string | undefined,
    resultHash: Hex,
  ): Promise<Hex | undefined>
  inspect(id: Hex): Promise<unknown>
}
/** All calls reconcile contract state before submission; a lost HTTP receipt never authorizes another payout. */
export function createSettlementAdapter(
  deployment: EscrowDeployment,
  reader: PublicClient,
  wallet: WalletClient,
  treasury: Address,
): MatchSettlementAdapter {
  const read = (id: Hex) =>
    reader.readContract({
      address: deployment.contract,
      abi: arcadeEscrowAbi,
      functionName: 'getMatch',
      args: [id],
    })
  let pending = Promise.resolve()
  async function send(
    functionName: 'createMatch' | 'lock' | 'settle' | 'voidMatch',
    args: readonly unknown[],
  ) {
    const operation = pending.then(async () => {
      if (
        !wallet.account ||
        (await reader.getChainId()) !== deployment.chainId ||
        (await wallet.getChainId()) !== deployment.chainId
      )
        throw new Error('Resolver account or chain mismatch')
      const request = {
        address: deployment.contract,
        abi: arcadeEscrowAbi,
        functionName,
        args,
        account: wallet.account,
        chain: wallet.chain,
      } as Parameters<typeof wallet.writeContract>[0]
      await reader.simulateContract(
        request as Parameters<typeof reader.simulateContract>[0],
      )
      const hash = await wallet.writeContract(request)
      const receipt = await reader.waitForTransactionReceipt({
        hash,
        confirmations: deployment.confirmations ?? 2,
      })
      if (receipt.status !== 'success')
        throw new Error(`Escrow transaction reverted: ${hash}`)
      return hash
    })
    pending = operation.then(
      () => undefined,
      () => undefined,
    )
    return operation
  }
  return {
    deployment,
    async create(t) {
      const existing = await read(t.id)
      if (existing.status !== 0) {
        if (existing.terms.rulesHash !== t.rulesHash)
          throw new Error('Pool terms conflict')
        // A durable prepared record is written before create; recover through inspect instead of creating twice.
        throw new Error('Pool already exists; recover the prepared match')
      }
      return send('createMatch', [
        t.id,
        {
          token: deployment.token,
          resolver: wallet.account!.address,
          treasury,
          fundingDeadline: BigInt(t.fundingDeadline),
          settlementDeadline: BigInt(t.settlementDeadline),
          feeBps: t.config.feeBps,
          stake: BigInt(t.config.stakeUnits),
          bounties: t.config.bounties,
          betting: t.config.spectatorBets,
          rulesHash: t.rulesHash,
          creator: t.creator ?? '0x0000000000000000000000000000000000000000',
          creatorShareBps: t.creatorShareBps ?? 0,
          royalties: t.royalties ?? [],
        },
        t.seatIds.map(hashArcadeId),
        t.recipients,
      ])
    },
    async lock(id) {
      const m = await read(id)
      if (m.status === 2) return undefined
      if (m.status !== 1) throw new Error('Pool is not funding')
      return send('lock', [id])
    },
    async settle(id, winner, resultHash) {
      const m = await read(id)
      if (m.status === 3) {
        if (
          m.resultHash !== resultHash ||
          m.winner !== hashArcadeId(winner ?? '')
        )
          throw new Error('Settlement conflict')
        return undefined
      }
      if (m.status === 4) {
        if (winner) throw new Error('Match was voided')
        return undefined
      }
      return winner
        ? send('settle', [id, hashArcadeId(winner), resultHash])
        : send('voidMatch', [id])
    },
    inspect: read,
  }
}
