import { randomBytes, randomUUID } from 'node:crypto'
import { compileGame } from '@common-arcade/studio/runtime'
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
  type EconomyConfig,
} from '@common-arcade/economy'
import type { Replay, ActionSubmission } from '@common-arcade/protocol'
import { verifyMessage, type Address, type Hex } from 'viem'
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
    recipients: z.tuple([address, address]),
    economy: economyConfigSchema.default({ mode: 'free' }),
  })
  .strict()
export interface TableRecord {
  id: string
  requestHash: Hex
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
}
export interface SignedCommand {
  address: Address
  expiresAt: number
  signature: Hex
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
    return Object.keys(this.adapters)
  }
  private operations = new Map<string, Promise<unknown>>()
  private listeners = new Map<string, Set<(value: unknown) => void>>()
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
  ) {
    const now = Date.now()
    if (
      !Number.isSafeInteger(auth.expiresAt) ||
      auth.expiresAt < now ||
      auth.expiresAt > now + 300_000
    )
      throw new Error('Signature expired or validity too long')
    if (
      !(await verifyMessage({
        address: auth.address,
        message: commandMessage(
          id,
          operation,
          body,
          auth.expiresAt,
          this.domain,
        ),
        signature: auth.signature,
      }))
    )
      throw new Error('Invalid wallet signature')
  }
  private adapter(record: TableRecord) {
    if (record.economy.mode === 'free') return undefined
    const adapter = this.adapters[record.economy.network]
    if (!adapter) throw new Error('Testnet escrow deployment is not configured')
    return adapter
  }
  async create(input: unknown, auth: SignedCommand) {
    const body = createTableSchema.parse(input),
      id = `mat_${body.id}`
    if (body.economy.mode === 'escrow' && body.economy.feeBps !== 250)
      throw new Error('The platform fee is 250 basis points')
    await this.verify(id, 'create', body, auth)
    if (body.recipients[0].toLowerCase() !== auth.address.toLowerCase())
      throw new Error('Creator must own first seat')
    if (body.recipients[0].toLowerCase() === body.recipients[1].toLowerCase())
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
      let record = await this.store.get<TableRecord>(id)
      const requestHash = hashArcadeId(JSON.stringify(body))
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
          recipients: body.recipients,
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
        if (adapter)
          record.pool = poolId(
            adapter.deployment.chainId,
            adapter.deployment.contract,
            id,
            release?.digest ?? blackjackGame.releaseDigest,
          )
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
      return this.viewRecord(record)
    })
  }
  private async runtime(record: TableRecord) {
    const game = record.release
      ? await compileGame(
          record.release.document,
          record.release.id,
          record.release.digest,
        )
      : blackjackGame
    if (record.releaseDigest !== game.releaseDigest)
      throw new Error(
        'Match release is unavailable in this worker; restore its version or claim timeout refunds',
      )
    return record.replay
      ? AuthoritativeMatch.recover(
          game,
          record.replay,
          record.stage === 'playing' ? 'running' : 'completed',
          1,
        )
      : AuthoritativeMatch.create({
          matchId: record.id,
          game,
          seed: record.seed,
          configuration: {},
          roster: [
            { seatId: 'sea_player_1', role: 'player' },
            { seatId: 'sea_player_2', role: 'player' },
          ],
        })
  }
  async start(id: string, auth: SignedCommand) {
    await this.verify(id, 'start', {}, auth)
    return this.exclusive(id, async () => {
      const record = await this.require(id)
      if (record.recipients[0]!.toLowerCase() !== auth.address.toLowerCase())
        throw new Error('Only the table creator can start')
      if (record.stage !== 'funding') return this.viewRecord(record)
      if (Date.now() / 1000 >= record.fundingDeadline)
        throw new Error('Funding expired; claim refunds')
      const runtime = await this.runtime(record)
      const adapter = this.adapter(record)
      if (adapter) {
        const hash = await adapter.lock(record.pool!)
        if (hash) record.transactions.push(hash)
      }
      runtime.start()
      record.replay = runtime.exportReplay()
      record.stage = 'playing'
      await this.store.put(id, record)
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
    return this.exclusive(id, async () => {
      const record = await this.require(id),
        seat = record.recipients.findIndex(
          (a) => a.toLowerCase() === auth.address.toLowerCase(),
        )
      if (seat < 0) throw new Error('Spectators cannot submit player actions')
      const encoded = JSON.stringify([auth.address.toLowerCase(), body])
      if (record.actions[body.actionId]) {
        if (record.actions[body.actionId] !== encoded)
          throw new Error('Action ID conflict')
        return this.viewRecord(record)
      }
      if (
        record.stage !== 'playing' ||
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
        record.stage = 'settlement-pending'
        record.result = (await runtime.snapshot()).result
      }
      await this.store.put(id, record)
      this.broadcast(record)
      // Result is durable before broadcasting a settlement transaction. Failure remains retryable.
      if (record.stage === 'settlement-pending') await this.settleRecord(record)
      return this.broadcast(record)
    })
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
    const record = await this.store.get<TableRecord>(id)
    if (!record) throw new Error('Match not found')
    return record
  }
  async observation(id: string, auth: SignedCommand) {
    await this.verify(id, 'observation', {}, auth)
    const record = await this.require(id),
      seat = record.recipients.findIndex(
        (a) => a.toLowerCase() === auth.address.toLowerCase(),
      )
    if (seat < 0 || record.stage === 'prepared' || record.stage === 'funding')
      throw new Error('A seated player and locked funding are required')
    return (await this.runtime(record)).observation(
      seat === 0 ? 'sea_player_1' : 'sea_player_2',
    )
  }
  async view(id: string) {
    const record = await this.require(id)
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
      recipients: record.recipients,
      commitment: record.commitment,
      rulesHash: record.rulesHash,
      ...(record.release ? {} : { rules: BLACKJACK_RULES }),
      pool: record.pool,
      deployment: this.adapter(record)?.deployment,
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
    for (const listener of this.listeners.get(record.id) ?? []) listener(view)
    return view
  }
}
