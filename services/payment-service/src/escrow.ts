import {
  arcadeEscrowAbi,
  settlementAccounting,
  type SettlementAccounting,
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
  openSeats?: boolean
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
  blockNumber?(): Promise<bigint>
  seats?(
    id: Hex,
    fromBlock?: string,
  ): Promise<{
    recipients: Address[]
    funded: boolean[]
    payments?: {
      hash: Hex
      payer: Address
      kind: number
      seat: Hex
      amount: string
    }[]
  }>
  accounting?(id: Hex): Promise<SettlementAccounting | undefined>
}
const resolverQueues = new Map<string, Promise<unknown>>()
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
  const queueKey = `${deployment.chainId}:${wallet.account?.address.toLowerCase()}`
  async function send(
    functionName:
      'createMatch' | 'createOpenMatch' | 'lock' | 'settle' | 'voidMatch',
    args: readonly unknown[],
  ) {
    const operation = (resolverQueues.get(queueKey) ?? Promise.resolve()).then(
      async () => {
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
      },
    )
    resolverQueues.set(
      queueKey,
      operation.then(
        () => undefined,
        () => undefined,
      ),
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
      if (t.openSeats && !deployment.openSeats)
        throw new Error('Open seats are unavailable on this deployment')
      return send(t.openSeats ? 'createOpenMatch' : 'createMatch', [
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
        ...(t.openSeats ? [] : [t.recipients]),
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
    async accounting(id) {
      const match = await read(id)
      if (match.status !== 3 && match.status !== 4) return undefined
      const [winningShares, winnerRecipient] =
        match.status === 3
          ? await Promise.all([
              reader.readContract({
                address: deployment.contract,
                abi: arcadeEscrowAbi,
                functionName: 'outcomePool',
                args: [id, match.winner],
              }),
              reader.readContract({
                address: deployment.contract,
                abi: arcadeEscrowAbi,
                functionName: 'recipient',
                args: [id, match.winner],
              }),
            ])
          : ([0n, ''] as const)
      return settlementAccounting({ ...match, winningShares, winnerRecipient })
    },
    blockNumber: () => reader.getBlockNumber({ cacheTime: 0 }),
    async seats(id, fromBlock) {
      // Read all seat ownership at one confirmed block, never a browser assertion.
      const head = await reader.getBlockNumber({ cacheTime: 0 })
      const blockNumber = head - BigInt((deployment.confirmations ?? 2) - 1)
      const seatIds = await reader.readContract({
        address: deployment.contract,
        abi: arcadeEscrowAbi,
        functionName: 'getSeats',
        args: [id],
        blockNumber,
      })
      const values = await Promise.all(
        seatIds.map(async (seat) =>
          Promise.all([
            reader.readContract({
              address: deployment.contract,
              abi: arcadeEscrowAbi,
              functionName: 'recipient',
              args: [id, seat],
              blockNumber,
            }),
            reader.readContract({
              address: deployment.contract,
              abi: arcadeEscrowAbi,
              functionName: 'staked',
              args: [id, seat],
              blockNumber,
            }),
          ]),
        ),
      )
      const payments: {
        hash: Hex
        payer: Address
        kind: number
        seat: Hex
        amount: string
      }[] = []
      if (fromBlock) {
        for (
          let start = BigInt(fromBlock);
          start <= blockNumber;
          start += 500n
        ) {
          const logs = await reader.getContractEvents({
            address: deployment.contract,
            abi: arcadeEscrowAbi,
            eventName: 'Deposited',
            args: { matchId: id },
            fromBlock: start,
            toBlock: start + 499n < blockNumber ? start + 499n : blockNumber,
            strict: true,
          })
          payments.push(
            ...logs.map((log) => ({
              hash: log.transactionHash,
              payer: log.args.payer,
              kind: log.args.kind,
              seat: log.args.seatId,
              amount: log.args.amount.toString(),
            })),
          )
        }
      }
      return {
        recipients: values.map((v) => v[0]),
        funded: values.map((v) => v[1]),
        payments,
      }
    },
    inspect: read,
  }
}
