import { randomBytes, randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { z } from 'zod'
import { usdcUnits } from '@common-arcade/economy'
import { IdentityError, tokenHash, type Principal } from './identity.js'
import type { DocumentStore, StoredDocument } from './store.js'

export const managedNetworks = [
  'base-sepolia',
  'arc-testnet',
  'celo-sepolia',
] as const
export type ManagedNetwork = (typeof managedNetworks)[number]
const units = z.string().regex(/^(0|[1-9]\d{0,3})(\.\d{1,6})?$/)
const setup = z
  .object({
    requestId: z.string().uuid(),
    name: z.string().trim().min(1).max(60),
    network: z.enum(managedNetworks),
    allowance: units,
    perPayment: units,
    hours: z.union([z.literal(1), z.literal(24)]),
  })
  .strict()
export const walletOperation = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('claim') }).strict(),
  z
    .object({
      operation: z.literal('analysis'),
      hand: z.array(z.number().int().min(0).max(51)).min(1).max(12),
      visibleCards: z.array(z.number().int().min(0).max(51)).max(52),
    })
    .strict(),
  z
    .object({
      operation: z.literal('stake'),
      matchId: z.string().regex(/^mat_[A-Za-z0-9_-]{1,100}$/),
      seatId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
    })
    .strict(),
  z
    .object({
      operation: z.enum(['start', 'observation']),
      matchId: z.string().regex(/^mat_[A-Za-z0-9_-]{1,100}$/),
    })
    .strict(),
  z
    .object({
      operation: z.literal('action'),
      matchId: z.string().regex(/^mat_[A-Za-z0-9_-]{1,100}$/),
      sequence: z.number().int().nonnegative(),
      type: z.enum(['hit', 'stand']),
      actionId: z.string().uuid(),
    })
    .strict(),
])
export type WalletOperation = z.infer<typeof walletOperation>
type Attempt = {
  id: string
  operation: string
  amountUnits: string
  actionHash: string
  state: 'pending' | 'complete' | 'unknown'
  createdAt: string
  result?: unknown
}
export type AgentWalletRecord = StoredDocument & {
  id: string
  ownerId: string
  name: string
  network: ManagedNetwork
  allowanceUnits: string
  perPaymentUnits: string
  reservedUnits: string
  expiresAt: number
  hours: 1 | 24
  createdAt: string
  state: 'creating' | 'ready' | 'attention'
  revoked: boolean
  address?: string
  providerWalletId?: string
  pairHash?: string
  pairExpiresAt?: number
  credentialHash?: string
  connectedAt?: string
  inFlight?: string
  attempts: Attempt[]
}
export interface ManagedWalletProvider {
  networks: ManagedNetwork[]
  create(
    id: string,
    name: string,
    network: ManagedNetwork,
  ): Promise<{ id: string; address: string }>
  balance(
    wallet: AgentWalletRecord,
  ): Promise<{ usdc: string; native: string; nativeSymbol: string }>
  prepare(
    wallet: AgentWalletRecord,
    input: WalletOperation,
  ): Promise<{ amountUnits: string; execute(): Promise<unknown> }>
  prepareWithdrawal(
    wallet: AgentWalletRecord,
    to: string,
    amountUnits: string,
  ): Promise<{ execute(): Promise<unknown> }>
}
type Authenticate = (
  authorization?: string,
  scope?: string,
) => Promise<Principal>
const partition = (id: string) => `agent-wallet:${id}`
const secret = () => randomBytes(32).toString('base64url')
const now = () => new Date().toISOString()
function publicWallet(wallet: AgentWalletRecord) {
  return {
    id: wallet.id,
    name: wallet.name,
    network: wallet.network,
    address: wallet.address,
    allowanceUnits: wallet.allowanceUnits,
    perPaymentUnits: wallet.perPaymentUnits,
    reservedUnits: wallet.reservedUnits,
    expiresAt: wallet.expiresAt,
    state: wallet.state,
    revoked: wallet.revoked,
    connectedAt: wallet.connectedAt,
    createdAt: wallet.createdAt,
    attempts: wallet.attempts,
  }
}

/** Wallet credentials authorize this API only. They never authorize generic Privy RPC. */
export function createAgentWalletApi(
  store: DocumentStore,
  authenticate: Authenticate,
  provider?: ManagedWalletProvider,
) {
  const app = new Hono()
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store')
    await next()
  })
  async function owner(authorization?: string) {
    const p = await authenticate(authorization, 'keys:manage')
    if (p.provider === 'api-key')
      throw new IdentityError(403, 'Sign in to manage agent wallets.')
    return p
  }
  async function owned(id: string, authorization?: string) {
    const p = await owner(authorization)
    const wallet = await store.get<AgentWalletRecord>(partition(id), 'wallet')
    if (!wallet || wallet.ownerId !== p.id)
      throw new IdentityError(403, 'Wallet is unavailable to this account.')
    return wallet
  }
  async function agent(authorization?: string) {
    const token = /^Bearer (arw_[a-f0-9-]{36}\.[A-Za-z0-9_-]{43})$/.exec(
      authorization ?? '',
    )?.[1]
    if (!token) throw new IdentityError(401, 'Connect your agent wallet first.')
    const id = token.slice(4).split('.')[0]!
    const wallet = await store.get<AgentWalletRecord>(partition(id), 'wallet')
    if (
      !wallet ||
      wallet.credentialHash !== (await tokenHash(token)) ||
      wallet.revoked ||
      wallet.expiresAt <= Date.now() ||
      wallet.state !== 'ready'
    )
      throw new IdentityError(
        401,
        'Wallet access is expired, revoked or unavailable.',
      )
    return wallet
  }
  async function save(wallet: AgentWalletRecord) {
    await store.put(
      partition(wallet.id),
      'wallet',
      { ...wallet, version: wallet.version + 1 },
      wallet.version,
    )
  }
  app.get('/v1/agent-wallets/config', (c) =>
    c.json({
      enabled: !!provider,
      networks: provider?.networks ?? [],
      provider: 'privy',
      testnetOnly: true,
    }),
  )
  app.get('/v1/agent-wallets', async (c) => {
    const p = await owner(c.req.header('Authorization'))
    const index = await store.list<StoredDocument & { walletId: string }>(
      `agent-wallets:${p.id}`,
    )
    const wallets = await Promise.all(
      index.map((row) =>
        store.get<AgentWalletRecord>(partition(row.walletId), 'wallet'),
      ),
    )
    return c.json({
      wallets: wallets
        .filter((w): w is AgentWalletRecord => !!w && w.ownerId === p.id)
        .map(publicWallet),
    })
  })
  app.post('/v1/agent-wallets', async (c) => {
    const p = await owner(c.req.header('Authorization'))
    if (!provider)
      return c.json({ detail: 'Managed wallets are not enabled yet.' }, 503)
    const input = setup.parse(await c.req.json())
    if (!provider.networks.includes(input.network))
      return c.json(
        { detail: 'This network is not enabled for managed wallets.' },
        422,
      )
    const allowance = usdcUnits(input.allowance),
      perPayment = usdcUnits(input.perPayment)
    if (
      allowance > 1000_000000n ||
      perPayment > allowance ||
      (allowance > 0n && perPayment === 0n)
    )
      return c.json(
        {
          detail:
            'Choose an allowance up to 1,000 USDC and a per-payment limit within it.',
        },
        422,
      )
    // Claim the client request before any external provisioning. A lost response
    // cannot create a second wallet; ambiguous creation is surfaced for recovery.
    const requestKey = await tokenHash(`${p.id}:${input.requestId}`)
    const previous = await store.get<StoredDocument & { walletId: string }>(
      'agent-wallet-requests',
      requestKey,
    )
    if (previous) {
      const wallet = await owned(
        previous.walletId,
        c.req.header('Authorization'),
      )
      return c.json({ wallet: publicWallet(wallet), reused: true }, 200)
    }
    const id = randomUUID()
    await store.put('agent-wallet-requests', requestKey, {
      version: 1,
      walletId: id,
    })
    const wallet: AgentWalletRecord = {
      version: 1,
      id,
      ownerId: p.id,
      name: input.name,
      network: input.network,
      allowanceUnits: allowance.toString(),
      perPaymentUnits: perPayment.toString(),
      reservedUnits: '0',
      hours: input.hours,
      expiresAt: Date.now() + input.hours * 3600000,
      createdAt: now(),
      state: 'creating',
      revoked: false,
      attempts: [],
    }
    await store.put(partition(id), 'wallet', wallet)
    await store.put(`agent-wallets:${p.id}`, id, { version: 1, walletId: id })
    let remote: { id: string; address: string }
    try {
      remote = await provider.create(id, input.name, input.network)
    } catch {
      await save({ ...wallet, state: 'attention' })
      return c.json(
        {
          detail:
            'Wallet creation needs review. Check this wallet before creating another.',
          wallet: publicWallet({ ...wallet, state: 'attention' }),
        },
        502,
      )
    }
    const pairCode = `arp_${id}.${secret()}`
    const ready: AgentWalletRecord = {
      ...wallet,
      state: 'ready',
      providerWalletId: remote.id,
      address: remote.address,
      pairHash: await tokenHash(pairCode),
      pairExpiresAt: Date.now() + 600000,
    }
    await save(ready)
    return c.json(
      {
        wallet: publicWallet(ready),
        pairCode,
        pairExpiresAt: ready.pairExpiresAt,
      },
      201,
    )
  })
  app.post('/v1/agent-wallets/:id/connection', async (c) => {
    const wallet = await owned(c.req.param('id'), c.req.header('Authorization'))
    if (wallet.state !== 'ready' || wallet.inFlight)
      return c.json(
        { detail: 'This wallet has an operation that needs review.' },
        409,
      )
    const pairCode = `arp_${wallet.id}.${secret()}`
    const update = {
      ...wallet,
      pairHash: await tokenHash(pairCode),
      pairExpiresAt: Date.now() + 600000,
      credentialHash: undefined,
      connectedAt: undefined,
      revoked: false,
      expiresAt: Date.now() + wallet.hours * 3600000,
    }
    await save(update)
    return c.json({
      pairCode,
      pairExpiresAt: update.pairExpiresAt,
      wallet: publicWallet(update),
    })
  })
  app.post('/v1/agent-wallets/connect', async (c) => {
    const { pairCode, credentialHash } = z
      .object({
        pairCode: z.string().regex(/^arp_[a-f0-9-]{36}\.[A-Za-z0-9_-]{43}$/),
        credentialHash: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict()
      .parse(await c.req.json())
    const id = pairCode.slice(4).split('.')[0]!
    const wallet = await store.get<AgentWalletRecord>(partition(id), 'wallet')
    if (
      !wallet ||
      wallet.revoked ||
      wallet.state !== 'ready' ||
      wallet.expiresAt <= Date.now() ||
      wallet.pairHash !== (await tokenHash(pairCode))
    )
      throw new IdentityError(
        401,
        'Connection code is invalid or no longer available.',
      )
    if (wallet.connectedAt) {
      if (wallet.credentialHash !== credentialHash)
        throw new IdentityError(401, 'Connection code was already used.')
      return c.json({ wallet: publicWallet(wallet) })
    }
    if ((wallet.pairExpiresAt ?? 0) <= Date.now())
      throw new IdentityError(401, 'Connection code has expired.')
    const update = { ...wallet, credentialHash, connectedAt: now() }
    await save(update)
    return c.json({ wallet: publicWallet(update) })
  })
  app.delete('/v1/agent-wallets/:id/connection', async (c) => {
    const wallet = await owned(c.req.param('id'), c.req.header('Authorization'))
    await save({
      ...wallet,
      revoked: true,
      pairHash: undefined,
      credentialHash: undefined,
    })
    return c.json({ revoked: true })
  })
  app.get('/v1/agent-wallets/:id/balance', async (c) => {
    const wallet = await owned(c.req.param('id'), c.req.header('Authorization'))
    if (!provider || !wallet.address)
      return c.json({ detail: 'Wallet balance is unavailable.' }, 503)
    return c.json(await provider.balance(wallet))
  })
  app.post('/v1/agent-wallets/:id/recover', async (c) => {
    const wallet = await owned(c.req.param('id'), c.req.header('Authorization'))
    if (!provider || wallet.state !== 'ready')
      return c.json({ detail: 'Wallet is not ready.' }, 503)
    const input = z
      .object({
        requestId: z.string().uuid(),
        to: z
          .string()
          .regex(/^0x[a-fA-F0-9]{40}$/)
          .optional(),
        amount: units.optional(),
      })
      .strict()
      .parse(await c.req.json())
    const actionHash = await tokenHash(JSON.stringify(input))
    const previous = wallet.attempts.find((a) => a.id === input.requestId)
    if (previous)
      return c.json(
        { attempt: previous },
        previous.actionHash === actionHash && previous.state === 'complete'
          ? 200
          : 409,
      )
    if (wallet.inFlight)
      return c.json(
        { detail: 'A pending operation needs receipt review before recovery.' },
        409,
      )
    if (!!input.to !== (input.amount !== undefined))
      return c.json(
        { detail: 'Supply both the destination and USDC amount.' },
        422,
      )
    const amount = input.amount === undefined ? 0n : usdcUnits(input.amount)
    if (
      input.to &&
      (amount <= 0n || amount > 1000_000000n || /^0x0{40}$/i.test(input.to))
    )
      return c.json(
        {
          detail:
            'Use a valid destination and an amount between 0 and 1,000 USDC.',
        },
        422,
      )
    const prepared = input.to
      ? await provider.prepareWithdrawal(wallet, input.to, amount.toString())
      : await provider.prepare(wallet, { operation: 'claim' })
    const attempt: Attempt = {
      id: input.requestId,
      actionHash,
      operation: input.to ? 'Owner withdrawal' : 'Claim winnings',
      amountUnits: amount.toString(),
      state: 'pending',
      createdAt: now(),
    }
    await save({
      ...wallet,
      inFlight: input.requestId,
      attempts: [...wallet.attempts, attempt],
    })
    let result: unknown
    try {
      result = await prepared.execute()
    } catch {
      const latest = await store.get<AgentWalletRecord>(
        partition(wallet.id),
        'wallet',
      )
      if (latest)
        await save({
          ...latest,
          attempts: latest.attempts.map((a) =>
            a.id === input.requestId ? { ...a, state: 'unknown' } : a,
          ),
        })
      return c.json(
        {
          detail:
            'Recovery outcome needs receipt review. Do not submit another withdrawal.',
        },
        502,
      )
    }
    const latest = await store.get<AgentWalletRecord>(
      partition(wallet.id),
      'wallet',
    )
    if (!latest) throw new Error('Wallet is unavailable')
    const complete: Attempt = { ...attempt, state: 'complete', result }
    await save({
      ...latest,
      inFlight: undefined,
      attempts: latest.attempts.map((a) =>
        a.id === input.requestId ? complete : a,
      ),
    })
    return c.json({ attempt: complete })
  })
  app.get('/v1/agent-wallet/me', async (c) => {
    const wallet = await agent(c.req.header('Authorization'))
    return c.json({
      wallet: publicWallet(wallet),
      balance: provider ? await provider.balance(wallet) : null,
    })
  })
  app.post('/v1/agent-wallet/logout', async (c) => {
    const wallet = await agent(c.req.header('Authorization'))
    await save({
      ...wallet,
      revoked: true,
      pairHash: undefined,
      credentialHash: undefined,
    })
    return c.json({ revoked: true })
  })
  app.post('/v1/agent-wallet/execute', async (c) => {
    const wallet = await agent(c.req.header('Authorization'))
    if (!provider)
      return c.json({ detail: 'Managed wallets are unavailable.' }, 503)
    const input = z
      .object({ requestId: z.string().uuid(), action: walletOperation })
      .strict()
      .parse(await c.req.json())
    const previous = wallet.attempts.find((a) => a.id === input.requestId)
    const actionHash = await tokenHash(JSON.stringify(input.action))
    if (previous && previous.actionHash !== actionHash)
      return c.json(
        { detail: 'This request ID was already used for another action.' },
        409,
      )
    if (previous)
      return c.json(
        { attempt: previous },
        previous.state === 'complete' ? 200 : 409,
      )
    if (wallet.inFlight)
      return c.json(
        {
          detail:
            'A previous payment is still pending. Check its receipt before retrying.',
        },
        409,
      )
    if (wallet.attempts.length >= 100)
      return c.json(
        { detail: 'This connection has reached its operation limit.' },
        429,
      )
    const prepared = await provider.prepare(wallet, input.action)
    if (wallet.expiresAt <= Date.now())
      throw new IdentityError(401, 'Wallet access expired before execution.')
    const amount = BigInt(prepared.amountUnits)
    if (
      amount < 0n ||
      amount > BigInt(wallet.perPaymentUnits) ||
      BigInt(wallet.reservedUnits) + amount > BigInt(wallet.allowanceUnits)
    )
      return c.json(
        { detail: 'This action exceeds the approved USDC allowance.' },
        403,
      )
    // Conditional write serializes the wallet across Lambda replicas and makes
    // revocation that races preparation win before any signature or broadcast.
    const attempt: Attempt = {
      id: input.requestId,
      operation: input.action.operation,
      amountUnits: amount.toString(),
      actionHash,
      state: 'pending',
      createdAt: now(),
    }
    const reserved: AgentWalletRecord = {
      ...wallet,
      inFlight: input.requestId,
      reservedUnits: (BigInt(wallet.reservedUnits) + amount).toString(),
      attempts: [...wallet.attempts, attempt],
    }
    await save(reserved)
    let result: unknown
    try {
      result = await prepared.execute()
    } catch {
      const latest = await store.get<AgentWalletRecord>(
        partition(wallet.id),
        'wallet',
      )
      if (latest)
        await save({
          ...latest,
          attempts: latest.attempts.map((a) =>
            a.id === input.requestId ? { ...a, state: 'unknown' } : a,
          ),
        })
      return c.json(
        {
          detail:
            'The operation outcome needs review. Do not submit a new payment.',
          requestId: input.requestId,
        },
        502,
      )
    }
    const latest = await store.get<AgentWalletRecord>(
      partition(wallet.id),
      'wallet',
    )
    if (!latest) throw new Error('Wallet record unavailable')
    const complete: Attempt = { ...attempt, state: 'complete', result }
    await save({
      ...latest,
      inFlight: undefined,
      attempts: latest.attempts.map((a) =>
        a.id === input.requestId ? complete : a,
      ),
    })
    return c.json({ attempt: complete })
  })
  return app
}
