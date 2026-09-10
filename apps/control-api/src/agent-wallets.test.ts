import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { serve } from '@hono/node-server'
import { describe, it, expect, vi } from 'vitest'
import { ZodError } from 'zod'
import {
  createAgentWalletApi,
  type ManagedWalletProvider,
  type AgentWalletRecord,
} from './agent-wallets.js'
import { createAuthenticator, tokenHash, IdentityError } from './identity.js'
import { MemoryDocumentStore, StoreConflict } from './store.js'
import { privyWalletProviderFromEnvironment } from './privy-wallets.js'

function fixture(cost = '480') {
  const store = new MemoryDocumentStore()
  const execute = vi.fn(async () => ({ transaction: '0xreceipt' }))
  const provider: ManagedWalletProvider = {
    networks: ['base-sepolia'],
    create: vi.fn(async () => ({
      id: 'privy-private-wallet-id',
      address: '0x1111111111111111111111111111111111111111',
    })),
    balance: vi.fn(async () => ({
      usdc: '5',
      native: '0.01',
      nativeSymbol: 'ETH',
    })),
    prepare: vi.fn(async () => ({ amountUnits: cost, execute })),
    prepareWithdrawal: vi.fn(async () => ({ execute })),
  }
  const app = createAgentWalletApi(
    store,
    createAuthenticator(store, { allowLocal: true }),
    provider,
  )
  app.onError((e, c) =>
    c.json(
      { detail: e.message },
      e instanceof IdentityError
        ? e.status
        : e instanceof StoreConflict
          ? 409
          : e instanceof ZodError
            ? 422
            : 500,
    ),
  )
  const request = (
    path: string,
    body?: unknown,
    token = 'local:owner',
    method = body === undefined ? 'GET' : 'POST',
  ) =>
    app.request(`/v1/${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  const create = async (overrides = {}) => {
    const input = {
      requestId: randomUUID(),
      name: 'Codex',
      network: 'base-sepolia',
      allowance: '1',
      perPayment: '1',
      hours: 1,
      ...overrides,
    }
    const response = await request('agent-wallets', input)
    expect(response.status).toBe(201)
    const result = await response.json()
    return { ...result, input } as {
      wallet: AgentWalletRecord
      pairCode: string
      input: typeof input
    }
  }
  const connect = async (created: Awaited<ReturnType<typeof create>>) => {
    const token = `arw_${created.wallet.id}.${randomBytes(32).toString('base64url')}`
    const response = await request(
      'agent-wallets/connect',
      { pairCode: created.pairCode, credentialHash: await tokenHash(token) },
      '',
    )
    expect(response.status).toBe(200)
    return token
  }
  const payment = (token: string, requestId = randomUUID()) =>
    request(
      'agent-wallet/execute',
      {
        requestId,
        action: {
          operation: 'analysis',
          hand: [0, 8],
          visibleCards: [0, 8, 12, 13],
        },
      },
      token,
    )
  return { app, store, provider, execute, request, create, connect, payment }
}
describe('Managed external agent wallets', () => {
  it('requires owner authorization before provisioning and hides provider IDs and credential hashes', async () => {
    const f = fixture()
    expect((await f.request('agent-wallets', {}, '')).status).toBe(401)
    expect(f.provider.create).not.toHaveBeenCalled()
    const created = await f.create()
    const listed = await (await f.request('agent-wallets')).json()
    expect(listed.wallets).toHaveLength(1)
    expect(JSON.stringify(listed)).not.toMatch(
      /pairHash|credentialHash|providerWalletId|privy-private-wallet-id/,
    )
    expect(
      (
        await f.request(
          `agent-wallets/${created.wallet.id}/connection`,
          {},
          'local:another-owner',
        )
      ).status,
    ).toBe(403)
  })
  it('does not create another provider wallet after a repeated setup request', async () => {
    const f = fixture(),
      created = await f.create()
    const retry = await f.request('agent-wallets', created.input)
    expect(retry.status).toBe(200)
    expect((await retry.json()).wallet.id).toBe(created.wallet.id)
    expect(f.provider.create).toHaveBeenCalledTimes(1)
  })
  it('allows an identical pairing retry but rejects a second credential and revoked access', async () => {
    const f = fixture(),
      created = await f.create(),
      token = await f.connect(created)
    const body = {
      pairCode: created.pairCode,
      credentialHash: await tokenHash(token),
    }
    expect((await f.request('agent-wallets/connect', body, '')).status).toBe(
      200,
    )
    expect(
      (
        await f.request(
          'agent-wallets/connect',
          { ...body, credentialHash: 'f'.repeat(64) },
          '',
        )
      ).status,
    ).toBe(401)
    expect((await f.request('agent-wallet/me', undefined, token)).status).toBe(
      200,
    )
    expect((await f.request('agent-wallets', {}, token)).status).toBe(401)
    expect(
      (
        await f.request(
          `agent-wallets/${created.wallet.id}/connection`,
          undefined,
          'local:owner',
          'DELETE',
        )
      ).status,
    ).toBe(200)
    expect((await f.payment(token)).status).toBe(401)
    expect(f.execute).not.toHaveBeenCalled()
  })
  it('expires unclaimed pairing codes and can issue a fresh owner-approved connection', async () => {
    const f = fixture(),
      created = await f.create()
    const wallet = (await f.store.get<AgentWalletRecord>(
      `agent-wallet:${created.wallet.id}`,
      'wallet',
    ))!
    await f.store.put(
      `agent-wallet:${wallet.id}`,
      'wallet',
      { ...wallet, version: wallet.version + 1, pairExpiresAt: Date.now() - 1 },
      wallet.version,
    )
    expect(
      (
        await f.request(
          'agent-wallets/connect',
          { pairCode: created.pairCode, credentialHash: 'a'.repeat(64) },
          '',
        )
      ).status,
    ).toBe(401)
    const fresh = await (
      await f.request(`agent-wallets/${wallet.id}/connection`, {})
    ).json()
    expect(fresh.pairCode).not.toBe(created.pairCode)
    expect(
      (
        await f.request(
          'agent-wallets/connect',
          { pairCode: created.pairCode, credentialHash: 'a'.repeat(64) },
          '',
        )
      ).status,
    ).toBe(401)
    await f.connect({ ...created, pairCode: fresh.pairCode })
  })
  it('serializes concurrent spend reservations and enforces the total allowance', async () => {
    const f = fixture('700000'),
      token = await f.connect(await f.create())
    const results = await Promise.all([f.payment(token), f.payment(token)])
    expect(results.map((r) => r.status).sort()).toEqual([200, 409])
    expect(f.execute).toHaveBeenCalledTimes(1)
    expect((await f.payment(token)).status).toBe(403)
    const status = await (
      await f.request('agent-wallet/me', undefined, token)
    ).json()
    expect(status.wallet.reservedUnits).toBe('700000')
  })
  it('returns the existing receipt for an idempotency replay without executing twice', async () => {
    const f = fixture(),
      token = await f.connect(await f.create()),
      id = randomUUID()
    const first = await (await f.payment(token, id)).json()
    const second = await (await f.payment(token, id)).json()
    expect(second).toEqual(first)
    expect(f.execute).toHaveBeenCalledTimes(1)
  })
  it('preserves uncertain payment reservations and prevents blind retries', async () => {
    const f = fixture('700000'),
      token = await f.connect(await f.create()),
      id = randomUUID()
    f.execute.mockRejectedValueOnce(new Error('Response lost after submission'))
    expect((await f.payment(token, id)).status).toBe(502)
    expect((await f.payment(token, id)).status).toBe(409)
    expect((await f.payment(token)).status).toBe(409)
    const status = await (
      await f.request('agent-wallet/me', undefined, token)
    ).json()
    expect(status.wallet.reservedUnits).toBe('700000')
    expect(status.wallet.attempts[0].state).toBe('unknown')
    expect(f.execute).toHaveBeenCalledTimes(1)
  })
  it('lets revocation win when it races preparation before signing', async () => {
    const f = fixture(),
      created = await f.create(),
      token = await f.connect(created)
    let release!: () => void, started!: () => void
    const entered = new Promise<void>((r) => {
        started = r
      }),
      gate = new Promise<void>((r) => {
        release = r
      })
    f.provider.prepare = vi.fn(async () => {
      started()
      await gate
      return { amountUnits: '480', execute: f.execute }
    })
    const payment = f.payment(token)
    await entered
    await f.request(
      `agent-wallets/${created.wallet.id}/connection`,
      undefined,
      'local:owner',
      'DELETE',
    )
    release()
    expect((await payment).status).toBe(409)
    expect(f.execute).not.toHaveBeenCalled()
  })
  it('rejects generic RPC and unapproved networks and never provisions a mainnet wallet', async () => {
    const f = fixture(),
      token = await f.connect(await f.create())
    expect(
      (
        await f.request(
          'agent-wallet/execute',
          {
            requestId: randomUUID(),
            action: { operation: 'eth_sendTransaction', to: 'attacker' },
          },
          token,
        )
      ).status,
    ).toBe(422)
    expect(
      (
        await f.request('agent-wallets', {
          requestId: randomUUID(),
          name: 'Bad',
          network: 'base',
          allowance: '5',
          perPayment: '1',
          hours: 1,
        })
      ).status,
    ).toBe(422)
    expect(f.provider.create).toHaveBeenCalledTimes(1)
  })
  it('fails closed when Privy is not configured', () => {
    vi.stubEnv('ARCADE_MANAGED_WALLETS_ENABLED', 'true')
    vi.stubEnv('PRIVY_APP_SECRET', '')
    expect(privyWalletProviderFromEnvironment()).toBeUndefined()
    vi.unstubAllEnvs()
  })
  it('runs the portable CLI through encrypted pairing, payment, rotation and logout', async () => {
    const f = fixture(),
      created = await f.create(),
      dir = await mkdtemp(join(tmpdir(), 'arcade-wallet-cli-'))
    const server = serve({ fetch: f.app.fetch, port: 0, hostname: '127.0.0.1' })
    await new Promise<void>((resolve) => server.once('listening', resolve))
    const port = (server.address() as { port: number }).port
    const api = `http://127.0.0.1:${port}`
    const cli = new URL('../../web/public/agent-wallet.mjs', import.meta.url)
    async function run(args: string[], input = '') {
      return new Promise<string>((resolve, reject) => {
        const child = spawn(process.execPath, [cli.pathname, ...args], {
          env: {
            ...process.env,
            ARCADE_WALLET_CONFIG_DIR: dir,
            ARCADE_WALLET_PASSPHRASE:
              'isolated-test-passphrase-not-a-real-credential',
          },
          stdio: ['pipe', 'pipe', 'pipe'],
        })
        let out = '',
          error = ''
        child.stdout.on('data', (data) => {
          out += data
        })
        child.stderr.on('data', (data) => {
          error += data
        })
        child.on('error', reject)
        child.on('close', (code) =>
          code === 0 ? resolve(out) : reject(new Error(error)),
        )
        child.stdin.end(input)
      })
    }
    try {
      const result = await run(['connect', '--api', api], created.pairCode)
      expect(JSON.parse(result).connected).toBe(true)
      expect(result).not.toMatch(/arw_|authorizationKey|appSecret/)
      const config = await readFile(join(dir, 'agent-wallet.json'), 'utf8')
      expect(config).toContain('encrypted')
      expect(config).not.toContain('arw_')
      await run(['connect', '--api', api], created.pairCode)
      expect(JSON.parse(await run(['status'])).wallet.id).toBe(
        created.wallet.id,
      )
      const before = await f.store.get<AgentWalletRecord>(
        `agent-wallet:${created.wallet.id}`,
        'wallet',
      )
      const rotated = await (
        await f.request(`agent-wallets/${created.wallet.id}/connection`, {})
      ).json()
      await run(['connect', '--api', api], rotated.pairCode)
      const after = await f.store.get<AgentWalletRecord>(
        `agent-wallet:${created.wallet.id}`,
        'wallet',
      )
      expect(after?.credentialHash).not.toBe(before?.credentialHash)
      const action = join(dir, 'action.json'),
        id = randomUUID()
      await writeFile(
        action,
        JSON.stringify({
          operation: 'analysis',
          hand: [0, 8],
          visibleCards: [0, 8, 12, 13],
        }),
      )
      expect(
        JSON.parse(await run(['execute', '--file', action, '--request-id', id]))
          .attempt.state,
      ).toBe('complete')
      await run(['execute', '--file', action, '--request-id', id])
      expect(f.execute).toHaveBeenCalledTimes(1)
      await run(['logout'])
      expect(
        (
          await f.store.get<AgentWalletRecord>(
            `agent-wallet:${created.wallet.id}`,
            'wallet',
          )
        )?.revoked,
      ).toBe(true)
    } finally {
      server.close()
      await rm(dir, { recursive: true, force: true })
    }
  }, 20000)
  it('retains owner recovery after revocation without exposing it to the agent', async () => {
    const f = fixture(),
      created = await f.create(),
      token = await f.connect(created)
    await f.request(
      `agent-wallets/${created.wallet.id}/connection`,
      undefined,
      'local:owner',
      'DELETE',
    )
    const input = {
      requestId: randomUUID(),
      to: '0x2222222222222222222222222222222222222222',
      amount: '0.5',
    }
    expect(
      (
        await f.request(
          `agent-wallets/${created.wallet.id}/recover`,
          input,
          token,
        )
      ).status,
    ).toBe(401)
    expect(
      (
        await f.request(
          `agent-wallets/${created.wallet.id}/recover`,
          input,
          'local:another',
        )
      ).status,
    ).toBe(403)
    expect(
      (await f.request(`agent-wallets/${created.wallet.id}/recover`, input))
        .status,
    ).toBe(200)
    expect(
      (await f.request(`agent-wallets/${created.wallet.id}/recover`, input))
        .status,
    ).toBe(200)
    expect(f.execute).toHaveBeenCalledTimes(1)
    const wallet = await f.store.get<AgentWalletRecord>(
      `agent-wallet:${created.wallet.id}`,
      'wallet',
    )
    expect(wallet?.revoked).toBe(true)
    expect(wallet?.reservedUnits).toBe('0')
  })
})
