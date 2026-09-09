import { describe, it, expect } from 'vitest'
import { privateKeyToAccount } from 'viem/accounts'
import { randomUUID } from 'node:crypto'
import { MatchHost, commandMessage, type TableRecord } from './matches.js'
import { MemoryMatchStore } from './store.js'
import {
  blackjackGame,
  handValue,
  shuffledShoe,
} from '@common-arcade/example-blackjack'
import { verifyReplay } from '@common-arcade/match-runtime'
import { replaySchema } from '@common-arcade/protocol'
import type { MatchSettlementAdapter } from './escrow.js'
const alice = privateKeyToAccount(`0x${'01'.repeat(32)}`),
  bob = privateKeyToAccount(`0x${'02'.repeat(32)}`),
  fan = privateKeyToAccount(`0x${'03'.repeat(32)}`),
  domain = 'https://payments.test'
async function auth(
  account: typeof alice,
  id: string,
  op: string,
  body: unknown,
) {
  const expiresAt = Date.now() + 60000
  return {
    address: account.address,
    expiresAt,
    signature: await account.signMessage({
      message: commandMessage(id, op, body, expiresAt, domain),
    }),
  }
}
describe('blackjack match lifecycle', () => {
  it('pins a funded table to its original executable release across worker upgrades', async () => {
    const store = new MemoryMatchStore(),
      host = new MatchHost(store, {}, domain)
    const body = {
      id: randomUUID(),
      recipients: [alice.address, bob.address],
      economy: { mode: 'free' },
    }
    const id = `mat_${body.id}`
    await host.create(body, await auth(alice, id, 'create', body))
    const record = (await store.get<TableRecord>(id))!
    expect(record.releaseDigest).toBe(blackjackGame.releaseDigest)
    record.releaseDigest = `sha256:${'0'.repeat(64)}`
    await store.put(id, record)
    const restarted = new MatchHost(store, {}, domain)
    expect((await restarted.view(id)).releaseDigest).toBe(record.releaseDigest)
    await expect(
      restarted.start(id, await auth(alice, id, 'start', {})),
    ).rejects.toThrow('Match release is unavailable')
    expect((await restarted.view(id)).stage).toBe('funding')
    await expect(
      restarted.create(body, await auth(alice, id, 'create', body)),
    ).rejects.toThrow('Match release is unavailable')
  })

  it('uses a complete unique deterministic shoe and ace adjustment', () => {
    expect(new Set(shuffledShoe('seed')).size).toBe(52)
    expect(shuffledShoe('seed')).toEqual(shuffledShoe('seed'))
    expect(handValue([0, 13, 8])).toBe(21)
  })
  it('plays, recovers, streams and produces a verifiable replay without leaking the shoe', async () => {
    const store = new MemoryMatchStore(),
      host = new MatchHost(store, {}, domain),
      body = {
        id: randomUUID(),
        recipients: [alice.address, bob.address],
        economy: { mode: 'free' },
      }
    const id = `mat_${body.id}`,
      created = await host.create(body, await auth(alice, id, 'create', body))
    expect(created.state).toBeNull()
    expect(created).not.toHaveProperty('seed')
    let broadcasts = 0
    const stop = host.subscribe(id, () => broadcasts++)
    await host.start(id, await auth(alice, id, 'start', {}))
    const before = await host.view(id)
    expect(before.state).not.toHaveProperty('shoe')
    expect(before).not.toHaveProperty('replay')
    const first = {
      actionId: randomUUID(),
      sequence: 0,
      type: 'stand' as const,
    }
    await expect(
      host.action(id, first, await auth(fan, id, 'action', first)),
    ).rejects.toThrow('Spectators')
    await host.action(id, first, await auth(alice, id, 'action', first))
    await host.action(id, first, await auth(alice, id, 'action', first)) // idempotent replay
    stop()
    expect(broadcasts).toBeGreaterThan(1)
    const restarted = new MatchHost(store, {}, domain),
      second = { actionId: randomUUID(), sequence: 1, type: 'stand' as const }
    await restarted.action(id, second, await auth(bob, id, 'action', second))
    const record = await restarted.require(id)
    expect(record.stage).toBe('settled')
    expect((await verifyReplay(blackjackGame, record.replay!)).valid).toBe(true)
    expect(() => replaySchema.parse(record.replay)).not.toThrow()
    expect((await restarted.view(id)).seed).toBe(record.seed)
  })
  it('never deals when escrow funding lock fails', async () => {
    const adapter = {
      deployment: {
        chainId: 84532,
        contract: alice.address,
        token: bob.address,
      },
      inspect: async () => ({ status: 0 }),
      create: async () => `0x${'ab'.repeat(32)}`,
      lock: async () => {
        throw new Error('Missing stake')
      },
    } as unknown as MatchSettlementAdapter
    const host = new MatchHost(
      new MemoryMatchStore(),
      { 'base-sepolia': adapter },
      domain,
    )
    const body = {
      id: randomUUID(),
      recipients: [alice.address, bob.address],
      economy: {
        mode: 'escrow',
        network: 'base-sepolia',
        stakeUnits: '100',
        bounties: false,
        spectatorBets: false,
        feeBps: 250,
        fundingSeconds: 600,
        settlementSeconds: 3600,
      },
    }
    const id = `mat_${body.id}`
    await host.create(body, await auth(alice, id, 'create', body))
    await expect(
      host.start(id, await auth(alice, id, 'start', {})),
    ).rejects.toThrow('Missing stake')
    expect((await host.view(id)).state).toBeNull()
  })
})
