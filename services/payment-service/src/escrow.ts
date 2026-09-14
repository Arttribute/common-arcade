import {
  arcadeEscrowAbi,
  settlementAccounting,
  type SettlementAccounting,
  hashArcadeId,
  type EscrowDeployment,
  type EconomyConfig,
} from '@common-arcade/economy'
import {
  erc20Abi,
  parseAbi,
  parseEventLogs,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem'
/** The escrow contract argument for a payer-signed EIP-3009 transfer. */
export interface RelayedAuthorization {
  from: Address
  value: bigint
  validAfter: bigint
  validBefore: bigint
  nonce: Hex
  v: number
  r: Hex
  s: Hex
}
const eip3009Abi = parseAbi([
  'function authorizationState(address authorizer, bytes32 nonce) view returns (bool)',
  'event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
])
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
  verifySignature?(input: {
    address: Address
    message: string
    signature: Hex
  }): Promise<boolean>
  create(terms: PoolTerms): Promise<Hex>
  lock(id: Hex): Promise<Hex | undefined>
  cancelFunding?(id: Hex): Promise<Hex | undefined>
  settle(
    id: Hex,
    winner: string | undefined,
    resultHash: Hex,
  ): Promise<Hex | undefined>
  inspect(id: Hex): Promise<unknown>
  blockNumber?(): Promise<bigint>
  controller?(id: Hex, seat: Hex): Promise<Address>
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
  /** Relay a signed stake transfer; the payer owns the seat. Idempotent per authorization nonce. */
  authorizedEntry?(input: {
    id: Hex
    seat: Hex
    controller: Address
    authorization: RelayedAuthorization
    fromBlock?: string
  }): Promise<{ transaction?: Hex; recovered: boolean }>
  /** Relay a player-signed request for a zero-stake open seat. */
  sponsoredEntry?(input: {
    id: Hex
    seat: Hex
    player: Address
    controller: Address
  }): Promise<Hex>
  tokenBalance?(owner: Address): Promise<bigint>
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
      | 'createMatch'
      | 'createOpenMatch'
      | 'lock'
      | 'settle'
      | 'voidMatch'
      | 'stakeWithAuthorization'
      | 'recoverAuthorizedStake'
      | 'claimSeatFor',
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
    ...(deployment.seatControllers
      ? {
          controller: async (id: Hex, seat: Hex) => {
            const head = await reader.getBlockNumber({ cacheTime: 0 })
            return reader.readContract({
              address: deployment.contract,
              abi: arcadeEscrowAbi,
              functionName: 'controller',
              args: [id, seat],
              blockNumber: head - BigInt((deployment.confirmations ?? 2) - 1),
            })
          },
        }
      : {}),
    ...(deployment.authorizedEntry
      ? {
          tokenBalance: (owner: Address) =>
            reader.readContract({
              address: deployment.token,
              abi: erc20Abi,
              functionName: 'balanceOf',
              args: [owner],
            }),
          async sponsoredEntry({ id, seat, player, controller }) {
            const match = await read(id)
            if (match.status !== 1 || match.terms.stake !== 0n)
              throw new Error('This seat is not a sponsored open seat')
            return send('claimSeatFor', [id, seat, player, controller])
          },
          async authorizedEntry({
            id,
            seat,
            controller,
            authorization,
            fromBlock,
          }) {
            const args = [id, seat, controller, authorization] as const
            const [credited, used] = await Promise.all([
              reader.readContract({
                address: deployment.contract,
                abi: arcadeEscrowAbi,
                functionName: 'creditedAuthorization',
                args: [
                  deployment.token,
                  authorization.from,
                  authorization.nonce,
                ],
              }),
              reader.readContract({
                address: deployment.token,
                abi: eip3009Abi,
                functionName: 'authorizationState',
                args: [authorization.from, authorization.nonce],
              }),
            ])
            // A lost response is retried with the same payment: never relay it twice.
            if (credited) return { recovered: false }
            if (!used)
              return {
                transaction: await send('stakeWithAuthorization', args),
                recovered: false,
              }
            // The nonce was spent outside this contract. Credit it only for a
            // confirmed transfer of exactly the stake into this escrow; a
            // cancelAuthorization also marks the nonce used without moving funds.
            const head = await reader.getBlockNumber({ cacheTime: 0 })
            const start = fromBlock ? BigInt(fromBlock) : head - 5000n
            let transfer: Hex | undefined
            for (let from = start; from <= head && !transfer; from += 2000n) {
              const logs = await reader.getContractEvents({
                address: deployment.token,
                abi: eip3009Abi,
                eventName: 'AuthorizationUsed',
                args: {
                  authorizer: authorization.from,
                  nonce: authorization.nonce,
                },
                fromBlock: from,
                toBlock: from + 1999n < head ? from + 1999n : head,
              })
              for (const log of logs) {
                const receipt = await reader.getTransactionReceipt({
                  hash: log.transactionHash,
                })
                const moved = parseEventLogs({
                  abi: eip3009Abi,
                  eventName: 'Transfer',
                  logs: receipt.logs,
                }).some(
                  (event) =>
                    event.address.toLowerCase() ===
                      deployment.token.toLowerCase() &&
                    event.args.from.toLowerCase() ===
                      authorization.from.toLowerCase() &&
                    event.args.to.toLowerCase() ===
                      deployment.contract.toLowerCase() &&
                    event.args.value === authorization.value,
                )
                if (receipt.status === 'success' && moved)
                  transfer = log.transactionHash
              }
            }
            if (!transfer)
              throw new Error(
                'This payment authorization was already used or canceled',
              )
            return {
              transaction: await send('recoverAuthorizedStake', args),
              recovered: true,
            }
          },
        }
      : {}),
    verifySignature: (input) => reader.verifyMessage(input),
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
    async cancelFunding(id) {
      const match = await read(id)
      if (match.status === 4) return undefined
      if (match.status !== 1)
        throw new Error('A started game cannot be canceled by its host')
      return send('voidMatch', [id])
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
