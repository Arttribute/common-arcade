import { randomBytes, randomUUID } from 'node:crypto'
import { compileGame } from '@common-arcade/studio/runtime'
import {
  createBrowserPolicy,
  livePolicyObservation,
} from '@common-arcade/studio'
import type { StudioRelease, JsonValue } from '@common-arcade/protocol'
import {
  resolveCreatorRevenue,
  type CreatorRevenue,
  type SettlementAccounting,
} from '@common-arcade/economy'
import { AuthoritativeMatch } from '@common-arcade/match-runtime'
import {
  blackjackGame,
  publicBlackjackState,
  BLACKJACK_RULES,
  type BlackjackState,
} from '@common-arcade/example-blackjack'
import {
  economyConfigSchema,
  poolId,
  hashArcadeId,
  entryRequirements,
  escrowAuthorization,
  transferAuthorizationTypedData,
  type EconomyConfig,
  type EntryPayment,
  type EntryRequirements,
} from '@common-arcade/economy'
import type { Replay, ActionSubmission } from '@common-arcade/protocol'
import {
  getAddress,
  verifyMessage,
  verifyTypedData,
  zeroAddress,
  type Address,
  type Hex,
} from 'viem'
import { z } from 'zod'
import type { MatchStore } from './store.js'
import type { MatchSettlementAdapter } from './escrow.js'
const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .transform((v) => v as Address)
export const createTableSchema = z
  .object({
    id: z.string().uuid(),
    releaseId: z
      .string()
      .regex(/^rel_[A-Za-z0-9_-]{1,190}$/)
      .optional(),
    recipients: z.tuple([address, address]).optional(),
    economy: economyConfigSchema.default({ mode: 'free' }),
    startWhenReady: z.boolean().optional(),
  })
  .strict()
export interface TableRecord {
  id: string
  requestHash: Hex
  host?: Address
  openSeats?: boolean
  deploymentContract?: Address
  funded?: boolean[]
  fundingBlock?: string
  payments?: {
    hash: Hex
    payer: Address
    kind: number
    seat: Hex
    amount: string
  }[]
  recipients: Address[]
  economy: EconomyConfig
  release?: StudioRelease
  releaseDigest: string
  revenue?: CreatorRevenue
  seed: string
  commitment: Hex
  rulesHash: Hex
  pool?: Hex
  fundingDeadline: number
  settlementDeadline: number
  stage: 'prepared' | 'funding' | 'playing' | 'settlement-pending' | 'settled'
  result?: JsonValue
  accounting?: SettlementAccounting
  replay?: Replay
  transactions: Hex[]
  actions: Record<string, string>
  runtimeError?: string
  cancelRequested?: boolean
  startWhenReady?: boolean
  readyAt?: number
  autoplay?: Record<
    string,
    {
      address: Address
      expiresAt: number
      step: number
      lastDecisionAt?: number
    }
  >
}
export interface SignedCommand {
  address: Address
  expiresAt: number
  signature: Hex
}
export const entryBodySchema = z
  .object({
    /** 1-based seat. Omit to take the first open seat. */
    seat: z.number().int().min(1).max(2).optional(),
    /** Game-only key allowed to play the seat. Defaults to the paying wallet. */
    controller: address.optional(),
    /** Let the Arcade policy play this seat on the worker until the game ends. */
    autoplay: z.boolean().optional(),
  })
  .strict()
export type EntryBody = z.infer<typeof entryBodySchema>
/** x402 challenge: the caller pays the seat stake with a signed USDC transfer and retries. */
export class EntryPaymentRequired extends Error {
  constructor(
    readonly requirements: EntryRequirements,
    reason: string,
  ) {
    super(reason)
  }
}
export interface EntryResult {
  seat: number
  player: Address
  controller: Address
  transaction?: Hex
  network: string
  table: Awaited<ReturnType<MatchHost['view']>>
}
export function commandMessage(
  matchId: string,
  operation: string,
  body: unknown,
  expiresAt: number,
  domain: string,
) {
  return JSON.stringify({ domain, matchId, operation, body, expiresAt })
}
export class MatchHost {
  configuredNetworks() {
    return Object.keys(this.adapters).filter((key) => !key.includes(':'))
  }
  openSeatNetworks() {
    return this.configuredNetworks().filter(
      (id) => this.adapters[id]?.deployment.openSeats,
    )
  }
  /** Networks whose escrow accepts gasless x402 seat entry. */
  entryNetworks() {
    return this.configuredNetworks().filter(
      (id) => this.adapters[id]?.deployment.authorizedEntry,
    )
  }
  private entryLocks = new Map<string, Promise<unknown>>()
  private lobbyCache?: { at: number; lobbies: unknown[] }
  private lobbyReadAt = new Map<string, number>()
  private closing = false
  private starting = new Set<string>()
  private runtimes = new Map<string, AuthoritativeMatch<unknown, unknown>>()
  private liveRecords = new Map<string, TableRecord>()
  private clocks = new Map<string, ReturnType<typeof setInterval>>()
  private agentClocks = new Map<string, ReturnType<typeof setInterval>>()
  private fundingClocks = new Map<string, ReturnType<typeof setInterval>>()
  private controllers = new Map<string, symbol>()
  private tickets = new Map<
    string,
    { id: string; seat: number; expiresAt: number }
  >()
  private operations = new Map<string, Promise<unknown>>()
  private listeners = new Map<string, Set<(value: unknown) => void>>()
  private policy = createBrowserPolicy()
  constructor(
    private store: MatchStore,
    private adapters: Partial<Record<string, MatchSettlementAdapter>>,
    readonly domain: string,
    private readonly seedSource: () => string = () =>
      randomBytes(32).toString('hex'),
    private readonly paidCreators?: ReadonlySet<string>,
    private readonly loadRelease?: (id: string) => Promise<StudioRelease>,
  ) {}
  private async exclusive<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.operations.get(id) ?? Promise.resolve()
    const operation = previous.catch(() => undefined).then(fn)
    this.operations.set(id, operation)
    try {
      return await operation
    } finally {
      if (this.operations.get(id) === operation) this.operations.delete(id)
    }
  }
  private async verify(
    id: string,
    operation: string,
    body: unknown,
    auth: SignedCommand,
    network?: string,
  ) {
    const now = Date.now()
    if (
      !Number.isSafeInteger(auth.expiresAt) ||
      auth.expiresAt < now ||
      auth.expiresAt > now + 300_000
    )
      throw new Error('Signature expired or validity too long')
    const input = {
      address: auth.address,
      message: commandMessage(id, operation, body, auth.expiresAt, this.domain),
      signature: auth.signature,
    }
    if (await verifyMessage(input).catch(() => false)) return
    // Smart-wallet signatures must be checked on this session's chain.
    const record = network ? undefined : await this.store.get<TableRecord>(id)
    const adapter = network
      ? this.adapters[network]
      : record
        ? this.adapter(record)
        : undefined
    if (!(await adapter?.verifySignature?.(input).catch(() => false)))
      throw new Error('Invalid wallet signature')
  }
  private adapter(record: TableRecord) {
    if (record.economy.mode === 'free') return undefined
    const network = record.economy.network
    const primary = this.adapters[network]
    const adapter = record.deploymentContract
      ? primary?.deployment.contract.toLowerCase() ===
        record.deploymentContract.toLowerCase()
        ? primary
        : this.adapters[`${network}:${record.deploymentContract.toLowerCase()}`]
      : (this.adapters[`${network}:legacy`] ?? primary)
    if (
      !record.deploymentContract &&
      primary?.deployment.openSeats &&
      !this.adapters[`${network}:legacy`]
    )
      throw new Error('Original escrow deployment is required for this session')
    if (!adapter) throw new Error('Testnet escrow deployment is not configured')
    return adapter
  }
  async create(input: unknown, auth: SignedCommand) {
    const body = createTableSchema.parse(input),
      id = `mat_${body.id}`
    if (body.economy.mode === 'escrow' && body.economy.feeBps !== 250)
      throw new Error('The platform fee is 250 basis points')
    await this.verify(
      id,
      'create',
      body,
      auth,
      body.economy.mode === 'escrow' ? body.economy.network : undefined,
    )
    if (!body.recipients && body.economy.mode !== 'escrow')
      throw new Error('Open lobbies require a paid session')
    if (
      body.recipients &&
      body.recipients[0].toLowerCase() !== auth.address.toLowerCase()
    )
      throw new Error('Creator must own first seat')
    if (
      body.recipients &&
      body.recipients[0].toLowerCase() === body.recipients[1].toLowerCase()
    )
      throw new Error('Use two distinct player wallets')
    if (
      body.economy.mode === 'escrow' &&
      this.paidCreators &&
      !this.paidCreators.has(auth.address.toLowerCase())
    )
      throw new Error(
        'This wallet is not enabled for the testnet paid-match preview',
      )
    return this.exclusive(id, async () => {
      if (this.closing)
        throw new Error('Payment worker is restarting; try again shortly')
      let record = await this.store.get<TableRecord>(id)
      const requestHash = hashArcadeId(JSON.stringify(body))
      if (
        record?.host &&
        record.host.toLowerCase() !== auth.address.toLowerCase()
      )
        throw new Error('Session belongs to another host')
      if (record && record.requestHash !== requestHash)
        throw new Error('Match ID already bound to different terms')
      if (!record) {
        const release = body.releaseId
          ? await this.loadRelease?.(body.releaseId)
          : undefined
        if (body.releaseId && !release)
          throw new Error('Published game loader unavailable')
        const revenue = release
          ? resolveCreatorRevenue(release.manifest, body.economy)
          : undefined
        const seed = this.seedSource(),
          now = Math.floor(Date.now() / 1000)
        record = {
          id,
          requestHash,
          releaseDigest: release?.digest ?? blackjackGame.releaseDigest,
          ...(release ? { release, revenue } : {}),
          host: auth.address,
          openSeats: !body.recipients,
          startWhenReady: body.startWhenReady ?? false,
          recipients: body.recipients ?? [zeroAddress, zeroAddress],
          ...(body.economy.mode === 'escrow'
            ? {
                deploymentContract:
                  this.adapters[body.economy.network]?.deployment.contract,
              }
            : {}),
          economy: body.economy,
          seed,
          commitment: hashArcadeId(JSON.stringify([id, seed])),
          rulesHash: hashArcadeId(
            JSON.stringify([
              release?.digest ?? blackjackGame.releaseDigest,
              revenue ?? null,
              body.economy,
              body.recipients,
              hashArcadeId(JSON.stringify([id, seed])),
            ]),
          ),
          fundingDeadline:
            now +
            (body.economy.mode === 'escrow'
              ? body.economy.fundingSeconds
              : 600),
          settlementDeadline:
            now +
            (body.economy.mode === 'escrow'
              ? body.economy.fundingSeconds + body.economy.settlementSeconds
              : 3600),
          stage: 'prepared',
          transactions: [],
          actions: {},
        }
        const adapter = this.adapter(record)
        if (record.openSeats && !adapter?.deployment.openSeats)
          throw new Error(
            'Open paid sessions are not available on this network yet',
          )
        if (adapter)
          record.pool = poolId(
            adapter.deployment.chainId,
            adapter.deployment.contract,
            id,
            release?.digest ?? blackjackGame.releaseDigest,
          )
        if (record.openSeats && adapter?.blockNumber)
          record.fundingBlock = (await adapter.blockNumber()).toString()
        await this.store.put(id, record) // Commitment/terms survive a lost deployment receipt.
      }
      if (
        record.releaseDigest !==
        (record.release?.digest ?? blackjackGame.releaseDigest)
      )
        throw new Error(
          'Match release is unavailable in this worker; restore its version or claim timeout refunds',
        )
      if (record.stage === 'prepared') {
        const adapter = this.adapter(record)
        if (adapter) {
          const existing = (await adapter.inspect(record.pool!)) as {
            status: number
            terms: { rulesHash: Hex }
          }
          if (existing.status === 0)
            record.transactions.push(
              await adapter.create({
                id: record.pool!,
                rulesHash: record.rulesHash,
                creator: record.revenue?.creator,
                creatorShareBps: record.revenue?.creatorShareBps,
                royalties: record.revenue?.royalties,
                openSeats: record.openSeats,
                recipients: record.recipients,
                seatIds: ['sea_player_1', 'sea_player_2'],
                fundingDeadline: record.fundingDeadline,
                settlementDeadline: record.settlementDeadline,
                config: record.economy as Extract<
                  EconomyConfig,
                  { mode: 'escrow' }
                >,
              }),
            )
          else if (existing.terms.rulesHash !== record.rulesHash)
            throw new Error('Onchain terms conflict')
        }
        record.stage = 'funding'
        await this.store.put(id, record)
      }
      this.watchFunding(record)
      return this.viewRecord(record)
    })
  }
  private async runtime(record: TableRecord) {
    const cached = this.runtimes.get(record.id)
    if (cached) return cached
    const game = record.release
      ? await compileGame(
          record.release.document,
          record.release.id,
          record.release.digest,
        )
      : { ...blackjackGame, projectSpectatorState: publicBlackjackState }
    if (record.releaseDigest !== game.releaseDigest)
      throw new Error(
        'Match release is unavailable in this worker; restore its version or claim timeout refunds',
      )
    const runtime = record.replay
      ? await AuthoritativeMatch.recover(
          game,
          record.replay,
          record.stage === 'playing' ? 'running' : 'completed',
          1,
        )
      : await AuthoritativeMatch.create({
          matchId: record.id,
          game,
          seed: record.seed,
          configuration: {},
          roster: (() => {
            const roles = record.release?.manifest.spec.seats.roles.flatMap(
              (role) =>
                Array.from({ length: role.count }, () => ({
                  role: role.id,
                  ...(role.team ? { team: role.team } : {}),
                })),
            ) ?? [{ role: 'player' }, { role: 'player' }]
            return (roles.length === 1 ? [roles[0]!, roles[0]!] : roles)
              .slice(0, 2)
              .map((role, index) => ({
                ...role,
                seatId: `sea_player_${index + 1}`,
              }))
          })(),
        })
    if (record.stage !== 'settled' && !record.runtimeError) {
      this.runtimes.set(record.id, runtime)
      this.liveRecords.set(record.id, record)
    }
    return runtime
  }
  async start(id: string, auth: SignedCommand) {
    await this.verify(id, 'start', {}, auth)
    return this.startForHost(id, auth.address)
  }
  private async startForHost(id: string, address: Address) {
    return this.exclusive(id, async () => {
      const record = await this.require(id)
      if (this.closing)
        throw new Error('Payment worker is restarting; try again shortly')
      if (
        (record.host ?? record.recipients[0]!).toLowerCase() !==
        address.toLowerCase()
      )
        throw new Error('Only the table creator can start')
      if (record.stage !== 'funding') return this.viewRecord(record)
      if (record.cancelRequested)
        throw new Error('Session cancellation is pending')
      await this.refreshSeats(record)
      if (record.openSeats && !record.funded?.every(Boolean))
        throw new Error('Waiting for both players to join their seats')
      if (Date.now() / 1000 >= record.fundingDeadline)
        throw new Error('Funding expired; claim refunds')
      // The 0.5-vCPU preview task also serves payment/facilitator requests.
      if (
        record.release?.manifest.spec.mode === 'realtime' &&
        this.clocks.size + this.starting.size >= 1
      )
        throw new Error(
          'Paid realtime tables are at capacity. Try starting again shortly.',
        )
      if (record.release?.manifest.spec.mode === 'realtime')
        this.starting.add(id)
      try {
        const runtime = await this.runtime(record)
        const adapter = this.adapter(record)
        try {
          if (adapter) {
            const hash = await adapter.lock(record.pool!)
            if (hash) record.transactions.push(hash)
            await this.refreshSeats(record)
          }
        } catch (error) {
          this.runtimes.delete(id)
          this.liveRecords.delete(id)
          throw error
        }
        runtime.start()
        record.replay = runtime.exportReplay()
        record.stage = 'playing'
        try {
          await this.store.put(id, record)
        } catch (error) {
          this.runtimes.delete(id)
          this.liveRecords.delete(id)
          throw error
        }
        this.startClock(record)
        clearInterval(this.fundingClocks.get(id))
        this.fundingClocks.delete(id)
        return this.broadcast(record)
      } finally {
        this.starting.delete(id)
      }
    })
  }
  async cancelFunding(id: string, auth: SignedCommand) {
    await this.verify(id, 'cancel', {}, auth)
    return this.exclusive(id, async () => {
      const record = await this.require(id)
      if (
        (record.host ?? record.recipients[0]!).toLowerCase() !==
        auth.address.toLowerCase()
      )
        throw new Error('Only the host can end this lobby')
      if (record.stage === 'settled' && record.cancelRequested)
        return this.viewRecord(record)
      if (record.stage !== 'funding')
        throw new Error('A started game cannot be canceled by its host')
      const adapter = this.adapter(record)
      if (adapter && !adapter.cancelFunding)
        throw new Error('Lobby cancellation is unavailable')
      record.cancelRequested = true
      await this.store.put(id, record)
      const hash = await adapter?.cancelFunding?.(record.pool!)
      if (hash) record.transactions.push(hash)
      record.stage = 'settled'
      record.result = { outcome: 'canceled' }
      record.autoplay = {}
      clearInterval(this.fundingClocks.get(id))
      this.fundingClocks.delete(id)
      await this.store.put(id, record)
      await this.refreshAccounting(record)
      return this.broadcast(record)
    })
  }
  async action(
    id: string,
    body: {
      actionId: string
      sequence: number
      type?: 'hit' | 'stand'
      payload?: JsonValue
    },
    auth: SignedCommand,
  ) {
    await this.verify(id, 'action', body, auth)
    const record = await this.require(id)
    const seat = await this.playerSeat(record, auth.address)
    return this.playerAction(id, seat, body)
  }
  private async playerAction(
    id: string,
    seat: number,
    body: {
      actionId: string
      sequence: number
      type?: 'hit' | 'stand'
      payload?: JsonValue
    },
    check = () => {},
  ) {
    return this.exclusive(id, async () => {
      const record = await this.require(id)
      check()
      if (this.closing)
        throw new Error('Payment worker is restarting; try again shortly')
      return this.applyPlayerAction(record, seat, body)
    })
  }
  private async applyPlayerAction(
    record: TableRecord,
    seat: number,
    body: {
      actionId: string
      sequence: number
      type?: 'hit' | 'stand'
      payload?: JsonValue
    },
  ) {
    const id = record.id
    if (seat < 0 || seat > 1)
      throw new Error('Spectators cannot submit player actions')
    if (record.runtimeError) throw new Error(record.runtimeError)
    const encoded = JSON.stringify([
      record.recipients[seat]!.toLowerCase(),
      body,
    ])
    if (record.actions[body.actionId]) {
      if (record.actions[body.actionId] !== encoded)
        throw new Error('Action ID conflict')
      return this.viewRecord(record)
    }
    if (
      record.stage !== 'playing' ||
      record.runtimeError ||
      Date.now() / 1000 >= record.settlementDeadline
    )
      throw new Error('Match is not running or has expired')
    const runtime = await this.runtime(record)
    const submission = {
      actionId: `act_${body.actionId}`,
      matchId: id,
      seatId: seat === 0 ? 'sea_player_1' : 'sea_player_2',
      basedOnStateSequence: body.sequence,
      payload: body.payload ?? { type: body.type },
      clientSequence: body.sequence + 1,
      controlLease: 'wallet-signature',
    } as ActionSubmission
    const result = await runtime.submitAction(submission, 1)
    if (result.disposition !== 'accepted')
      throw new Error(JSON.stringify(result))
    record.actions[body.actionId] = encoded
    record.replay = runtime.exportReplay()
    if (runtime.getStatus() === 'completed') {
      this.stopClock(id)
      record.stage = 'settlement-pending'
      record.result = (await runtime.snapshot()).result
    }
    try {
      await this.store.put(id, record)
    } catch (error) {
      this.stopClock(id)
      record.runtimeError =
        'Game progress could not be saved. Claim timeout refunds after the deadline.'
      throw error
    }
    this.broadcast(record)
    // Result is durable before broadcasting a settlement transaction. Failure remains retryable.
    if (record.stage === 'settlement-pending') await this.settleRecord(record)
    return this.broadcast(record)
  }
  async settle(id: string) {
    return this.exclusive(id, async () => {
      const record = await this.require(id)
      await this.settleRecord(record)
      return this.broadcast(record)
    })
  }
  private async settleRecord(record: TableRecord) {
    if (record.stage === 'settled') {
      await this.refreshAccounting(record)
      return
    }
    if (record.stage !== 'settlement-pending' || !record.replay)
      throw new Error('No authoritative completed result')
    const runtime = await this.runtime(record),
      snapshot = await runtime.snapshot()
    const result = snapshot.result as { outcome: string; winnerSeatId?: string }
    if (!result) throw new Error('Missing runtime result')
    if (
      result.winnerSeatId &&
      !['sea_player_1', 'sea_player_2'].includes(result.winnerSeatId)
    )
      throw new Error('Runtime returned an unknown winning seat')
    // Also re-flush on retries: an earlier disk failure must never authorize an undurable payout.
    await this.store.put(record.id, record)
    const adapter = this.adapter(record)
    if (adapter) {
      const hash = await adapter.settle(
        record.pool!,
        result.winnerSeatId,
        hashArcadeId(JSON.stringify(record.replay)),
      )
      if (hash) record.transactions.push(hash)
    }
    record.result = snapshot.result
    record.stage = 'settled'
    await this.store.put(record.id, record)
    await this.refreshAccounting(record)
    this.stopClock(record.id)
    this.runtimes.delete(record.id)
    this.liveRecords.delete(record.id)
  }
  private async refreshAccounting(record: TableRecord) {
    if (record.stage !== 'settled' || record.accounting) return
    try {
      const accounting = await this.adapter(record)?.accounting?.(record.pool!)
      if (accounting) {
        record.accounting = accounting
        await this.store.put(record.id, record)
      }
    } catch {
      // A temporarily unavailable RPC must not turn a confirmed settlement into a failed game.
      // A subsequent view or settlement retry can recover the accounting report.
    }
  }
  async require(id: string) {
    const record =
      this.liveRecords.get(id) ?? (await this.store.get<TableRecord>(id))
    if (!record) throw new Error('Match not found')
    return record
  }
  async observation(id: string, auth: SignedCommand) {
    await this.verify(id, 'observation', {}, auth)
    const record = await this.require(id),
      seat = await this.playerSeat(record, auth.address)
    if (seat < 0 || record.stage === 'prepared' || record.stage === 'funding')
      throw new Error('A seated player and locked funding are required')
    return (await this.runtime(record)).observation(
      seat === 0 ? 'sea_player_1' : 'sea_player_2',
    )
  }
  private async refreshSeats(record: TableRecord) {
    if (record.economy.mode !== 'escrow' || record.stage !== 'funding') return
    const adapter = this.adapter(record)
    if (!record.openSeats && !adapter?.seats) return
    if (!adapter?.seats || !record.pool)
      throw new Error('Seat reader unavailable')
    const seats = await adapter.seats(record.pool, record.fundingBlock)
    if (seats.recipients.length !== 2 || seats.funded.length !== 2)
      throw new Error('Invalid onchain roster')
    if (!record.openSeats) {
      if (
        seats.recipients.some(
          (recipient, index) =>
            recipient.toLowerCase() !== record.recipients[index]?.toLowerCase(),
        )
      )
        throw new Error('Onchain seats differ from the reserved players')
      if (BigInt(record.economy.stakeUnits) === 0n) seats.funded = [true, true]
    }
    if (
      JSON.stringify([record.recipients, record.funded, record.payments]) !==
      JSON.stringify([seats.recipients, seats.funded, seats.payments])
    ) {
      record.recipients = seats.recipients
      record.funded = seats.funded
      record.payments = seats.payments
      await this.store.put(record.id, record)
      this.broadcast(record)
    }
  }
  private async playerSeat(record: TableRecord, address: Address) {
    const owner = record.recipients.findIndex(
      (a) => a.toLowerCase() === address.toLowerCase(),
    )
    if (owner >= 0) return owner
    const adapter = this.adapter(record)
    if (!adapter?.controller || !record.pool) return -1
    for (let seat = 0; seat < record.recipients.length; seat++) {
      if (!record.funded?.[seat]) continue
      const controller = await adapter.controller(
        record.pool,
        hashArcadeId(`sea_player_${seat + 1}`),
      )
      if (controller.toLowerCase() === address.toLowerCase()) return seat
    }
    return -1
  }

  /** The wallet signs once server-side, within its existing game grant. No payment authority is created. */
  async autoplay(
    id: string,
    body: { expiresAt: number; enabled: boolean },
    auth: SignedCommand,
  ) {
    await this.verify(id, 'autoplay', body, auth)
    return this.exclusive(id, async () => {
      const record = await this.require(id)
      await this.refreshSeats(record)
      const seat = await this.playerSeat(record, auth.address)
      if (seat < 0 || !['funding', 'playing'].includes(record.stage))
        throw new Error('A funded player seat is required')
      if (
        record.economy.mode === 'escrow' &&
        (record.openSeats || BigInt(record.economy.stakeUnits) > 0n)
      ) {
        const funded = await this.adapter(record)?.seats?.(
          record.pool!,
          record.fundingBlock,
        )
        if (!funded?.funded[seat])
          throw new Error('A funded player seat is required')
      }
      if (
        body.expiresAt <= Date.now() ||
        body.expiresAt > record.settlementDeadline * 1000
      )
        throw new Error('Autoplay must expire within this game')
      record.autoplay ??= {}
      if (body.enabled)
        record.autoplay[String(seat)] = {
          address: auth.address,
          expiresAt: body.expiresAt,
          step: 0,
        }
      else delete record.autoplay[String(seat)]
      await this.store.put(id, record)
      if (record.stage === 'playing') this.startClock(record)
      return this.broadcast(record)
    })
  }

  /**
   * One request takes a seat. A paid seat answers with an x402 challenge; the retry carries the
   * payer's signed USDC transfer, which the resolver relays into escrow, so the player needs no
   * gas or allowance. A sponsored seat takes a signed `entry` command instead. The payer owns the
   * seat, refunds and winnings; the controller can only play.
   */
  async entry(
    id: string,
    body: EntryBody,
    payment?: EntryPayment,
    auth?: SignedCommand,
  ): Promise<EntryResult> {
    const record = await this.require(id)
    if (record.economy.mode !== 'escrow' || !record.pool)
      throw new Error('This session has no paid entry')
    const adapter = this.adapter(record)!
    if (!adapter.deployment.authorizedEntry || !adapter.authorizedEntry)
      throw new Error(
        'Gasless entry is unavailable for this session. Take the seat from your wallet.',
      )
    if (record.stage !== 'funding' || record.cancelRequested)
      throw new Error('This session is no longer taking players')
    if (Date.now() / 1000 >= record.fundingDeadline - 30)
      throw new Error('Entry has closed for this session')
    const stake = BigInt(record.economy.stakeUnits)
    if (!payment && !auth) {
      // Say so before asking anyone to sign or pay for a seat they cannot get.
      const lobby = await this.exclusive(id, async () => {
        const current = await this.require(id)
        await this.refreshSeats(current)
        return current
      })
      const open = [0, 1].filter((seat) => !lobby.funded?.[seat])
      if (!open.length) throw new Error('This session is full')
      if (body.seat && !open.includes(body.seat - 1))
        throw new Error('That seat is taken')
    }
    let player: Address
    if (stake === 0n) {
      if (!record.openSeats || !adapter.sponsoredEntry)
        throw new Error('This seat is reserved for another player')
      if (!auth)
        throw new Error('Sign an entry request to take this sponsored seat')
      await this.verify(id, 'entry', body, auth)
      player = getAddress(auth.address)
    } else {
      const requirements = entryRequirements(
        adapter.deployment,
        record.economy.stakeUnits,
      )
      if (!payment)
        throw new EntryPaymentRequired(
          requirements,
          'Pay the seat stake to enter',
        )
      player = await this.checkEntryPayment(requirements, payment)
      if (adapter.tokenBalance && (await adapter.tokenBalance(player)) < stake)
        throw new EntryPaymentRequired(requirements, 'insufficient_funds')
    }
    const controller = body.controller ? getAddress(body.controller) : player
    return this.entryLock(id, async () => {
      const latest = await this.exclusive(id, async () => {
        const current = await this.require(id)
        await this.refreshSeats(current)
        return current
      })
      const held = latest.recipients.findIndex(
        (recipient) => recipient.toLowerCase() === player.toLowerCase(),
      )
      let seat: number
      let transaction: Hex | undefined
      if (held >= 0 && latest.funded?.[held]) {
        // A retry after a lost response: the seat is already paid, so do not relay again.
        if (body.seat && body.seat - 1 !== held)
          throw new Error('This wallet already holds another seat')
        seat = held
        transaction = latest.payments?.find(
          (p) => p.kind === 0 && p.payer.toLowerCase() === player.toLowerCase(),
        )?.hash
      } else {
        const available = (index: number) =>
          !latest.funded?.[index] &&
          (latest.openSeats
            ? latest.recipients[index]?.toLowerCase() === zeroAddress
            : latest.recipients[index]?.toLowerCase() === player.toLowerCase())
        seat = body.seat ? body.seat - 1 : ([0, 1].find(available) ?? -1)
        if (seat < 0 || !available(seat))
          throw new Error(
            latest.openSeats
              ? 'That seat is taken'
              : 'This seat is reserved for another player',
          )
        const seatId = hashArcadeId(`sea_player_${seat + 1}`)
        if (stake === 0n)
          transaction = await adapter.sponsoredEntry!({
            id: latest.pool!,
            seat: seatId,
            player,
            controller,
          })
        else
          ({ transaction } = await adapter.authorizedEntry!({
            id: latest.pool!,
            seat: seatId,
            controller,
            authorization: escrowAuthorization(payment!),
            fromBlock: latest.fundingBlock,
          }))
      }
      return this.exclusive(id, async () => {
        const current = await this.require(id)
        await this.refreshSeats(current)
        this.lobbyReadAt.set(id, Date.now())
        this.lobbyCache = undefined
        if (
          !current.funded?.[seat] ||
          current.recipients[seat]?.toLowerCase() !== player.toLowerCase()
        )
          throw new Error(
            'Your entry is still confirming. Retry the same request to check your seat.',
          )
        if (body.autoplay) {
          current.autoplay ??= {}
          current.autoplay[String(seat)] = {
            address: controller,
            expiresAt: current.settlementDeadline * 1000,
            step: 0,
          }
          await this.store.put(id, current)
        }
        this.watchFunding(current)
        return {
          seat: seat + 1,
          player,
          controller,
          transaction,
          network: `eip155:${adapter.deployment.chainId}`,
          table: this.broadcast(current),
        }
      })
    })
  }
  private async checkEntryPayment(
    requirements: EntryRequirements,
    payment: EntryPayment,
  ) {
    const reject = (reason: string) =>
      new EntryPaymentRequired(requirements, reason)
    const { accepted } = payment,
      { authorization, signature } = payment.payload
    if (
      accepted.network !== requirements.network ||
      accepted.asset.toLowerCase() !== requirements.asset.toLowerCase() ||
      accepted.payTo.toLowerCase() !== requirements.payTo.toLowerCase() ||
      accepted.amount !== requirements.amount ||
      authorization.to.toLowerCase() !== requirements.payTo.toLowerCase() ||
      authorization.value !== requirements.amount
    )
      throw reject('Payment does not match this seat')
    const now = BigInt(Math.floor(Date.now() / 1000))
    if (BigInt(authorization.validAfter) > now)
      throw reject('Payment is not valid yet')
    // Leave room for one confirmed relay before the authorization lapses.
    if (BigInt(authorization.validBefore) < now + 20n)
      throw reject('Payment authorization expired. Sign a new one.')
    if (BigInt(authorization.validBefore) > now + 600n)
      throw reject('Payment authorization lasts too long')
    const valid = await verifyTypedData({
      address: authorization.from as Address,
      ...transferAuthorizationTypedData(requirements, {
        ...authorization,
        from: authorization.from as Address,
        to: authorization.to as Address,
        nonce: authorization.nonce as Hex,
      }),
      signature: signature as Hex,
    }).catch(() => false)
    if (!valid) throw reject('invalid_signature')
    return getAddress(authorization.from)
  }
  private async entryLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.entryLocks.get(id) ?? Promise.resolve()
    const operation = previous.catch(() => undefined).then(fn)
    this.entryLocks.set(id, operation)
    try {
      return await operation
    } finally {
      if (this.entryLocks.get(id) === operation) this.entryLocks.delete(id)
    }
  }
  private entryDescriptor(record: TableRecord) {
    if (record.economy.mode !== 'escrow' || record.stage !== 'funding')
      return undefined
    const deployment = this.adapter(record)?.deployment
    const free = BigInt(record.economy.stakeUnits) === 0n
    if (!deployment?.authorizedEntry || (free && !record.openSeats))
      return undefined
    return {
      path: `/v1/economy/matches/${record.id}/entry`,
      method: free ? ('signed-command' as const) : ('x402' as const),
      network: `eip155:${deployment.chainId}`,
      asset: deployment.token,
      payTo: deployment.contract,
      amount: record.economy.stakeUnits,
    }
  }
  /** Paid lobbies with an open seat, soonest deadline first, for agents looking for a game. */
  async lobbies() {
    if (this.lobbyCache && Date.now() - this.lobbyCache.at < 5000)
      return this.lobbyCache.lobbies
    const now = Date.now() / 1000,
      lobbies = []
    for (const id of await this.store.ids()) {
      const record =
        this.liveRecords.get(id) ?? (await this.store.get<TableRecord>(id))
      if (
        !record ||
        record.stage !== 'funding' ||
        record.economy.mode !== 'escrow' ||
        record.cancelRequested ||
        record.fundingDeadline <= now + 30
      )
        continue
      const open = [0, 1].filter((seat) => !record.funded?.[seat]).length
      if (!open) continue
      let entry: ReturnType<MatchHost['entryDescriptor']>
      try {
        entry = this.entryDescriptor(record)
      } catch {
        continue
      }
      lobbies.push({
        id,
        game: record.release?.document.title ?? 'Blackjack duel',
        releaseId: record.release?.id ?? blackjackGame.releaseId,
        mode: record.release?.manifest.spec.mode ?? 'turn-based',
        network: record.economy.network,
        stakeUnits: record.economy.stakeUnits,
        openSeats: open,
        fundingDeadline: record.fundingDeadline,
        entry,
      })
    }
    lobbies.sort((a, b) => a.fundingDeadline - b.fundingDeadline)
    this.lobbyCache = { at: Date.now(), lobbies: lobbies.slice(0, 50) }
    return this.lobbyCache.lobbies
  }

  private async playAgents(
    record: TableRecord,
    runtime: AuthoritativeMatch<unknown, unknown>,
  ) {
    for (const [index, agent] of Object.entries(record.autoplay ?? {})) {
      if (agent.expiresAt <= Date.now() || runtime.getStatus() !== 'running')
        continue
      const cadence =
        1000 /
        Math.max(
          1,
          Math.min(
            20,
            record.release?.manifest.spec.policy.maxDecisionsPerSecond ?? 2,
          ),
        )
      if (Date.now() - (agent.lastDecisionAt ?? 0) < cadence) continue
      agent.lastDecisionAt = Date.now()
      const seat = Number(index)
      const observation = runtime.observation(`sea_player_${seat + 1}`)
      if (!observation.legalActions.length) continue
      const legal = livePolicyObservation(observation)
      const decision = this.policy.choose(
        legal.observation,
        {
          seatId: observation.seatId,
          strategy: 'Play to win legally using visible objectives and threats.',
        },
        agent.step++,
      )
      const payload = legal.payloads.get(decision.actionId)
      if (payload === undefined) continue
      await runtime.submitAction(
        {
          actionId: `act_${randomUUID()}`,
          matchId: record.id,
          seatId: observation.seatId,
          basedOnStateSequence: observation.stateSequence,
          clientSequence: agent.step,
          controlLease: 'wallet-authorized-policy',
          payload,
        } as ActionSubmission,
        1,
      )
    }
  }

  async publicObservation(id: string) {
    const record = await this.require(id)
    if (record.stage === 'prepared' || record.stage === 'funding') return null
    return (await this.runtime(record)).spectatorState()
  }
  async view(id: string) {
    const record = await this.require(id)
    if (record.economy.mode === 'escrow' && record.stage === 'funding')
      return this.exclusive(id, async () => {
        const latest = await this.require(id)
        if (Date.now() - (this.lobbyReadAt.get(id) ?? 0) >= 2000) {
          await this.refreshSeats(latest)
          this.lobbyReadAt.set(id, Date.now())
        }
        return this.viewRecord(latest)
      })
    if (
      record.stage !== 'settled' ||
      record.accounting ||
      !this.adapter(record)?.accounting
    )
      return this.viewRecord(record)
    // Only report recovery writes to disk. Ordinary reads remain available while a
    // submitted transaction waits for confirmation, including settlement-pending.
    return this.exclusive(id, async () => {
      const latest = await this.require(id)
      await this.refreshAccounting(latest)
      return this.viewRecord(latest)
    })
  }
  private viewRecord(record: TableRecord) {
    const checkpoint = record.replay?.checkpoints.at(-1)
    return {
      id: record.id,
      game: record.release?.document.title ?? 'Blackjack duel',
      mode: record.release?.manifest.spec.mode ?? 'turn-based',
      runtimeError: record.runtimeError,
      startWhenReady: record.startWhenReady,
      readyAt: record.readyAt,
      autoplay: Object.keys(record.autoplay ?? {}).filter(
        (seat) => record.autoplay![seat]!.expiresAt > Date.now(),
      ),
      published: !!record.release,
      releaseId: record.release?.id ?? blackjackGame.releaseId,
      releaseDigest: record.releaseDigest,
      revenue: record.revenue,
      result: record.result,
      accounting: record.accounting,
      events:
        record.replay?.events.filter(
          (event) => event.visibility === 'public',
        ) ?? [],
      economy: record.economy,
      host: record.host ?? record.recipients[0],
      openSeats: record.openSeats ?? false,
      funded: record.funded,
      payments: record.payments,
      recipients: record.recipients,
      commitment: record.commitment,
      rulesHash: record.rulesHash,
      ...(record.release ? {} : { rules: BLACKJACK_RULES }),
      pool: record.pool,
      deployment: this.adapter(record)?.deployment,
      entry: this.entryDescriptor(record),
      stage: record.stage,
      fundingDeadline: record.fundingDeadline,
      settlementDeadline: record.settlementDeadline,
      sequence: checkpoint?.stateSequence ?? 0,
      state:
        checkpoint && !record.release
          ? publicBlackjackState(checkpoint.state as unknown as BlackjackState)
          : null,
      transactions: record.transactions,
      ...(record.stage === 'settled' || record.stage === 'settlement-pending'
        ? { seed: record.seed, replay: record.replay }
        : {}),
      trust:
        'Testnet trusted dealer and result resolver; onchain accounting and payouts',
    }
  }
  /** One wallet approval grants a short-lived, match/seat-bound gameplay connection only. */
  async realtimeSession(id: string, auth: SignedCommand) {
    await this.verify(id, 'realtime-session', {}, auth)
    const record = await this.require(id)
    const seat = await this.playerSeat(record, auth.address)
    if (seat < 0 || record.stage !== 'playing' || record.runtimeError)
      throw new Error('A seated player in a running match is required')
    for (const [token, ticket] of this.tickets)
      if (
        ticket.expiresAt <= Date.now() ||
        (ticket.id === id && ticket.seat === seat)
      )
        this.tickets.delete(token)
    const token = randomBytes(32).toString('hex')
    const expiresAt = Math.min(
      Date.now() + 30_000,
      record.settlementDeadline * 1000,
    )
    this.tickets.set(token, { id, seat, expiresAt })
    return { token, expiresAt }
  }
  async connectRealtime(id: string, token: string) {
    const ticket = this.tickets.get(token)
    if (!ticket || ticket.id !== id || ticket.expiresAt <= Date.now())
      throw new Error('Invalid or expired gameplay ticket')
    this.tickets.delete(token)
    return this.exclusive(id, async () => {
      const record = await this.require(id)
      if (this.closing || record.stage !== 'playing' || record.runtimeError)
        throw new Error('Match is not running')
      const runtime = await this.runtime(record)
      // A new controller never inherits a disconnected controller's held keys.
      await this.releaseInputs(record, ticket.seat)
      const expiresAt = Math.min(
        Date.now() + 30 * 60_000,
        record.settlementDeadline * 1000,
      )
      let closed = false
      const controllerKey = `${id}:${ticket.seat}`,
        epoch = Symbol()
      this.controllers.set(controllerKey, epoch)
      const check = () => {
        if (
          this.closing ||
          closed ||
          this.controllers.get(controllerKey) !== epoch ||
          Date.now() >= expiresAt
        )
          throw new Error('Gameplay session expired; reconnect your wallet')
      }
      return {
        observation: () => {
          check()
          return runtime.observation(`sea_player_${ticket.seat + 1}`)
        },
        action: (body: {
          actionId: string
          sequence: number
          payload: JsonValue
        }) => {
          check()
          return this.playerAction(id, ticket.seat, body, check)
        },
        close: async () => {
          closed = true
          await this.exclusive(id, async () => {
            if (this.controllers.get(controllerKey) !== epoch) return
            this.controllers.delete(controllerKey)
            if (!this.closing)
              await this.releaseInputs(await this.require(id), ticket.seat)
          })
        },
      }
    })
  }
  /** Neutralize advertised held inputs on disconnect, takeover, and worker recovery. */
  private async releaseInputs(record: TableRecord, seat: number) {
    if (
      record.stage !== 'playing' ||
      record.runtimeError ||
      Date.now() >= record.settlementDeadline * 1000
    )
      return
    const runtime = await this.runtime(record)
    const legal = runtime.observation(`sea_player_${seat + 1}`).legalActions
    const releases = new Set(
      legal.flatMap((action) => {
        if (!action || typeof action !== 'object' || Array.isArray(action))
          return []
        const control = action.control as
          { releaseActionId?: string } | undefined
        return control?.releaseActionId ? [control.releaseActionId] : []
      }),
    )
    for (const action of legal) {
      if (record.stage !== 'playing') break
      if (
        action &&
        typeof action === 'object' &&
        !Array.isArray(action) &&
        releases.has(String(action.id))
      ) {
        await this.applyPlayerAction(record, seat, {
          actionId: randomUUID(),
          sequence: runtime.observation(`sea_player_${seat + 1}`).stateSequence,
          payload: action,
        })
      }
    }
  }
  /** Recover durable paid matches once at process startup; reads never drive time. */
  async recoverRealtime() {
    for (const id of await this.store.ids()) {
      await this.exclusive(id, async () => {
        const record = await this.require(id)
        if (record.stage === 'funding') this.watchFunding(record)
        if (
          (record.release?.manifest.spec.mode !== 'realtime' &&
            !Object.keys(record.autoplay ?? {}).length) ||
          record.runtimeError
        )
          return
        if (record.stage === 'playing') {
          await this.runtime(record)
          await this.releaseInputs(record, 0)
          await this.releaseInputs(record, 1)
          this.startClock(record)
        } else if (record.stage === 'settlement-pending') {
          await this.settleRecord(record)
        }
      }).catch((error) =>
        console.error(
          'Paid match recovery failed',
          id,
          error instanceof Error ? error.message : 'Unknown failure',
        ),
      )
    }
  }
  /** Only funding reconciliation polls the chain; gameplay retains its worker clock. */
  private watchFunding(record: TableRecord) {
    if (
      this.closing ||
      !record.startWhenReady ||
      record.stage !== 'funding' ||
      this.fundingClocks.has(record.id)
    )
      return
    let pending = false
    const timer = setInterval(() => {
      if (pending) return
      pending = true
      void this.exclusive(record.id, async () => {
        const latest = await this.require(record.id)
        if (
          this.closing ||
          latest.stage !== 'funding' ||
          latest.cancelRequested ||
          Date.now() >= latest.fundingDeadline * 1000
        ) {
          clearInterval(timer)
          this.fundingClocks.delete(record.id)
          return undefined
        }
        await this.refreshSeats(latest)
        if (!latest.funded?.every(Boolean)) return undefined
        if (!latest.readyAt) {
          latest.readyAt = Date.now() + 10000
          await this.store.put(latest.id, latest)
          this.broadcast(latest)
        }
        return Date.now() >= latest.readyAt ? latest.host : undefined
      })
        .then(async (host) => {
          if (host) await this.startForHost(record.id, host)
        })
        .catch(() => {
          // Funding/RPC/capacity failures remain retryable until the funding deadline.
        })
        .finally(() => {
          pending = false
        })
    }, 2000)
    timer.unref()
    this.fundingClocks.set(record.id, timer)
  }
  private startClock(record: TableRecord) {
    if (record.release?.manifest.spec.mode !== 'realtime') {
      this.startAgentClock(record)
      return
    }
    if (
      this.closing ||
      record.release?.manifest.spec.mode !== 'realtime' ||
      this.clocks.has(record.id)
    )
      return
    const runtime = this.runtimes.get(record.id)
    if (!runtime || runtime.getStatus() !== 'running' || record.runtimeError)
      return
    const deltaMs = Math.max(
      1,
      Math.round(
        1000 / (record.release.manifest.spec.clock.simulationHz ?? 30),
      ),
    )
    const networkMs = Math.max(
      deltaMs,
      1000 / (record.release.manifest.spec.clock.networkHz ?? 20),
    )
    let last = Date.now(),
      persisted = last,
      broadcast = last,
      pending = false
    const timer = setInterval(() => {
      if (pending) return
      pending = true
      void this.exclusive(record.id, async () => {
        if (this.closing || record.stage !== 'playing' || record.runtimeError)
          return
        const now = Date.now()
        if (
          now >= record.settlementDeadline * 1000 ||
          (await runtime.snapshot()).elapsedMs >=
            (record.release!.manifest.spec.clock.maxDurationSeconds ?? 600) *
              1000
        ) {
          this.stopClock(record.id)
          record.runtimeError = 'Match deadline reached. Claim timeout refunds.'
          await this.store.put(record.id, record)
          this.broadcast(record)
          return
        }
        const due = Math.min(8, Math.floor((now - last) / deltaMs))
        if (due < 1) return
        await this.playAgents(record, runtime)
        last = Math.max(last, now - 1000)
        for (let step = 0; step < due; step++) {
          if (!(await runtime.advanceTick(deltaMs))) break
          last += deltaMs
          if (runtime.getStatus() === 'completed') break
        }
        const finished = runtime.getStatus() === 'completed'
        if (finished || now - persisted >= 1000) {
          record.replay = runtime.exportReplay()
          if (finished) {
            this.stopClock(record.id)
            record.stage = 'settlement-pending'
            record.result = (await runtime.snapshot()).result
          }
          await this.store.put(record.id, record)
          persisted = now
        }
        if (finished || now - broadcast >= networkMs) {
          this.broadcast(record)
          broadcast = now
        }
        if (finished) {
          // A confirmed, durable replay is required before any payout.
          try {
            await this.settleRecord(record)
          } catch (error) {
            console.error(
              'Paid realtime settlement remains retryable',
              record.id,
              error instanceof Error ? error.message : 'Unknown failure',
            )
          }
          this.broadcast(record)
        }
      })
        .catch(async (error) => {
          this.stopClock(record.id)
          record.runtimeError =
            'The game runtime stopped. Claim timeout refunds after the deadline.'
          console.error(
            'Paid realtime clock failed',
            record.id,
            error instanceof Error ? error.message : 'Unknown failure',
          )
          await this.store.put(record.id, record).catch(() => undefined)
          this.broadcast(record)
        })
        .finally(() => {
          pending = false
        })
    }, deltaMs)
    timer.unref()
    this.clocks.set(record.id, timer)
  }
  private stopClock(id: string) {
    clearInterval(this.clocks.get(id))
    this.clocks.delete(id)
    clearInterval(this.agentClocks.get(id))
    this.agentClocks.delete(id)
  }
  private startAgentClock(record: TableRecord) {
    if (
      this.closing ||
      this.agentClocks.has(record.id) ||
      !Object.keys(record.autoplay ?? {}).length
    )
      return
    let pending = false
    this.agentClocks.set(
      record.id,
      setInterval(() => {
        if (pending) return
        pending = true
        void this.exclusive(record.id, async () => {
          if (this.closing || record.stage !== 'playing' || record.runtimeError)
            return this.stopClock(record.id)
          if (Date.now() >= record.settlementDeadline * 1000)
            return this.stopClock(record.id)
          const runtime = await this.runtime(record)
          await this.playAgents(record, runtime)
          record.replay = runtime.exportReplay()
          if (runtime.getStatus() === 'completed') {
            this.stopClock(record.id)
            record.stage = 'settlement-pending'
            record.result = (await runtime.snapshot()).result
          }
          await this.store.put(record.id, record)
          this.broadcast(record)
          if (record.stage === 'settlement-pending')
            await this.settleRecord(record)
        })
          .catch(() => {
            this.stopClock(record.id)
          })
          .finally(() => {
            pending = false
          })
      }, 500),
    )
  }
  async close() {
    this.closing = true
    for (const timer of this.fundingClocks.values()) clearInterval(timer)
    this.fundingClocks.clear()
    for (const id of this.clocks.keys()) this.stopClock(id)
    for (const id of this.agentClocks.keys()) this.stopClock(id)
    await Promise.all(
      [...this.operations.values()].map((p) => p.catch(() => undefined)),
    )
    for (const record of this.liveRecords.values()) {
      const runtime = this.runtimes.get(record.id)
      if (runtime) record.replay = runtime.exportReplay()
      await this.store.put(record.id, record)
    }
    this.tickets.clear()
    this.controllers.clear()
    this.runtimes.clear()
    this.liveRecords.clear()
  }
  subscribe(id: string, listener: (value: unknown) => void) {
    let set = this.listeners.get(id)
    if (!set) {
      set = new Set()
      this.listeners.set(id, set)
    }
    set.add(listener)
    return () => {
      set!.delete(listener)
      if (!set!.size) this.listeners.delete(id)
    }
  }
  private broadcast(record: TableRecord) {
    const view = this.viewRecord(record)
    for (const listener of this.listeners.get(record.id) ?? []) {
      try {
        listener(view)
      } catch {
        /* A disconnected subscriber never owns the clock. */
      }
    }
    return view
  }
}
