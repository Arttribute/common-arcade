import { it, expect, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { privateKeyToAccount } from 'viem/accounts'
import {
  starterDocument,
  documentDigest,
  releaseManifest,
} from '@common-arcade/studio'
import type { StudioProject, StudioRelease } from '@common-arcade/protocol'
import { MatchHost, commandMessage } from './matches.js'
import { MemoryMatchStore } from './store.js'
import type { PoolTerms, MatchSettlementAdapter } from './escrow.js'
const a = privateKeyToAccount(`0x${'04'.repeat(32)}`),
  b = privateKeyToAccount(`0x${'05'.repeat(32)}`),
  creator = privateKeyToAccount(`0x${'06'.repeat(32)}`).address,
  domain = 'https://payments.test'
it('uses an immutable Studio release, the same action protocol, and creator terms through a complete different game', async () => {
  const document = {
    ...starterDocument,
    monetization: {
      mode: 'revenue-share' as const,
      allowedModes: ['staked' as const],
      feeBps: 250 as const,
      creatorShareBps: 7000,
      payouts: { 'base-sepolia': creator },
      spectatorBets: false,
    },
  }
  const project: StudioProject = {
    id: 'prj_creator_economy',
    ownerId: 'owner',
    revision: 1,
    document,
    digest: await documentDigest(document),
    annotations: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  const release: StudioRelease = {
    id: 'rel_creator_economy',
    projectId: project.id,
    revision: 1,
    document,
    digest: project.digest,
    manifest: await releaseManifest(project, 'rel_creator_economy'),
    ownerId: 'owner',
    publishedAt: project.updatedAt,
  }
  const create = vi.fn(
      async (_terms: PoolTerms) => `0x${'11'.repeat(32)}` as const,
    ),
    settle = vi.fn(async () => `0x${'22'.repeat(32)}` as const)
  const adapter = {
    deployment: { chainId: 84532, contract: a.address, token: b.address },
    inspect: async () => ({ status: 0 }),
    create,
    lock: async () => undefined,
    settle,
  } satisfies MatchSettlementAdapter
  const host = new MatchHost(
    new MemoryMatchStore(),
    { 'base-sepolia': adapter },
    domain,
    undefined,
    undefined,
    async () => release,
  )
  const body = {
      id: randomUUID(),
      releaseId: release.id,
      recipients: [a.address, b.address],
      economy: {
        mode: 'escrow',
        network: 'base-sepolia',
        stakeUnits: '1000000',
        bounties: false,
        spectatorBets: false,
        feeBps: 250,
        fundingSeconds: 600,
        settlementSeconds: 3600,
      },
    },
    id = `mat_${body.id}`
  async function auth(account: typeof a, operation: string, body: unknown) {
    const expiresAt = Date.now() + 60000
    return {
      address: account.address,
      expiresAt,
      signature: await account.signMessage({
        message: commandMessage(id, operation, body, expiresAt, domain),
      }),
    }
  }
  const created = await host.create(body, await auth(a, 'create', body))
  expect(created.revenue?.creator).toBe(creator)
  expect(create.mock.calls[0]?.[0]).toMatchObject({
    creator,
    creatorShareBps: 7000,
  })
  await host.start(id, await auth(a, 'start', {}))
  for (const [index, cell] of [0, 3, 1, 4, 2].entries()) {
    const account = index % 2 === 0 ? a : b,
      observation = await host.observation(
        id,
        await auth(account, 'observation', {}),
      ),
      payload = { type: 'place', cell }
    expect(observation.legalActions).toContainEqual(payload)
    const command = {
      actionId: randomUUID(),
      sequence: observation.stateSequence,
      payload,
    }
    await host.action(id, command, await auth(account, 'action', command))
  }
  const completed = await host.view(id)
  expect(completed.stage).toBe('settled')
  expect(completed.releaseDigest).toBe(project.digest)
  expect(completed.state).toBeNull()
  expect(settle).toHaveBeenCalledWith(
    created.pool,
    'sea_player_1',
    expect.stringMatching(/^0x/),
  )
})
