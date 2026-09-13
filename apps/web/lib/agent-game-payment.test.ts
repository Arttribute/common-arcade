import { afterEach, expect, it, vi } from 'vitest'
import { hashArcadeId, NETWORKS } from '@common-arcade/economy'
import {
  payWithAgent,
  type AgentGrant,
  type PaidLobby,
} from './agent-game-payment'
vi.mock('./paid-session', () => ({ paymentService: 'https://payments.test' }))
const address = `0x${'1'.repeat(40)}` as const
const contract = `0x${'2'.repeat(40)}` as const
const pool = `0x${'3'.repeat(64)}` as const
const table: PaidLobby = {
  id: 'mat_game',
  pool,
  deployment: { chainId: 84532, contract, token: address },
  economy: {
    mode: 'escrow',
    network: 'base-sepolia',
    stakeUnits: '1000000',
    bounties: true,
    spectatorBets: true,
    feeBps: 250,
    fundingSeconds: 600,
    settlementSeconds: 3600,
  },
  recipients: [address, contract],
  funded: [false, false],
}
function fixture(
  options: {
    existing?: boolean
    state?: string
    revoked?: boolean
    capable?: boolean
  } = {},
) {
  const grant: AgentGrant = {
    id: 'grant_one',
    wallet_id: 'wallet_one',
    runtime_session_id: 'runtime_one',
    expires_at: new Date(Date.now() + 3600000).toISOString(),
    revoked_at: options.revoked ? new Date().toISOString() : null,
    budget_units: '1000000',
    reserved_units: options.existing ? '1000000' : '0',
    policy: {
      network: NETWORKS['base-sepolia'].x402Network,
      origin: 'https://payments.test',
      payTo: contract,
      maxPaymentUnits: '1000000',
      arcade: {
        matchId: table.id,
        poolId: pool,
        seatId: hashArcadeId('sea_player_1'),
        allowedOperations: ['stake'],
      },
    },
  }
  const calls: { path: string; body?: Record<string, unknown> }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const body = init.body ? JSON.parse(String(init.body)) : undefined
      calls.push({ path: url, body })
      let result: unknown
      if (url.endsWith('/payment-capabilities'))
        result = { autonomousPlay: options.capable ?? true }
      else if (url.endsWith('/agent/agent_one'))
        result = [
          { id: 'wallet_one', address, walletType: 'eoa', isActive: true },
        ]
      else if (url.endsWith('/attempts'))
        result = [
          {
            idempotency_key: 'join_game_1',
            state: options.state ?? 'settled',
            settlement: { transaction: '0xreceipt' },
          },
        ]
      else if (url.endsWith('/payment-sessions'))
        result = body ? grant : options.existing ? [grant] : []
      else if (url.endsWith('/deposit')) result = { transaction: '0xreceipt' }
      else if (url.endsWith('/autoplay')) result = { autoplay: ['0'] }
      else throw new Error(`Unexpected request ${url}`)
      return { ok: true, json: async () => result }
    }),
  )
  return {
    calls,
    run: () =>
      payWithAgent({
        table,
        agentId: 'agent_one',
        agentName: 'Player agent',
        seat: 0,
        operation: 'stake',
        amount: '1',
        budget: '1',
        idempotencyKey: 'join_game_1',
        onProgress: vi.fn(),
      }),
  }
}
afterEach(() => vi.unstubAllGlobals())
it('approves one exact game budget, pays from the agent wallet, and starts its controls', async () => {
  const f = fixture()
  await f.run()
  const writes = f.calls.filter((c) => c.body)
  expect(writes.map((c) => c.path.split('/').at(-1))).toEqual([
    'payment-sessions',
    'deposit',
    'autoplay',
  ])
  expect(writes[0]!.body).toMatchObject({
    walletId: 'wallet_one',
    budgetUnits: '1000000',
    policy: {
      payTo: contract,
      maxPaymentUnits: '1000000',
      arcade: { poolId: pool, allowedOperations: ['stake'] },
    },
  })
})
it('resumes a confirmed entry even when the original budget has been spent', async () => {
  const f = fixture({ existing: true })
  expect((await f.run()).transaction).toBe('0xreceipt')
  expect(
    f.calls.filter((c) => c.body).map((c) => c.path.split('/').at(-1)),
  ).toEqual(['autoplay'])
})
it('never creates a fresh grant or payment to bypass an uncertain transfer on a revoked grant', async () => {
  const f = fixture({ existing: true, state: 'unknown', revoked: true })
  await expect(f.run()).rejects.toThrow('already submitted')
  expect(f.calls.filter((c) => c.body)).toHaveLength(0)
})
it('checks autonomous play support before authorizing or spending any budget', async () => {
  const f = fixture({ capable: false })
  await expect(f.run()).rejects.toThrow('No payment was requested')
  expect(f.calls).toHaveLength(1)
})
