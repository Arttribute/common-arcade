import { afterEach, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { privateKeyToAccount } from 'viem/accounts'
import { documentDigest, releaseManifest } from '@common-arcade/studio'
import {
  exampleDocument,
  gameDocumentSchema,
  type StudioRelease,
} from '@common-arcade/protocol'
import { MatchHost, commandMessage, type TableRecord } from './matches.js'
import { MemoryMatchStore } from './store.js'
import { releaseLoader } from './releases.js'

const a = privateKeyToAccount(`0x${'04'.repeat(32)}`)
const b = privateKeyToAccount(`0x${'05'.repeat(32)}`)
const outsider = privateKeyToAccount(`0x${'06'.repeat(32)}`)
const domain = 'https://payments.test'
const hosts: MatchHost[] = []
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()))
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
async function fixture(
  options: { finish?: number; lockFails?: boolean; settleFails?: boolean } = {},
) {
  vi.useFakeTimers()
  const document = gameDocumentSchema.parse({
    ...exampleDocument,
    play: { mode: 'realtime', seats: { min: 2, max: 2, default: 2 } },
    runtime: { kind: 'sandboxed-script', entryFile: 'rules.js', tickRate: 20 },
    monetization: {
      mode: 'revenue-share',
      allowedModes: ['staked', 'sponsored'],
      feeBps: 250,
      creatorShareBps: 7000,
      payouts: { 'base-sepolia': a.address },
      spectatorBets: false,
    },
    files: [
      exampleDocument.files[0],
      {
        path: 'rules.js',
        content: `globalThis.arcadeGame = {
      initialize: c => ({ elapsed: 0, inputs: Object.fromEntries(c.roster.map(s => [s.seatId, false])), secret: 'private-state' }),
      validateAction: (s,a) => ['go','stop'].includes(a.id) ? null : 'Unknown action',
      applyAction: (s,a,c) => ({ state: {...s, inputs: {...s.inputs, [c.seatId]: a.id === 'go'}}, events: [] }),
      tick: (s,c) => ({ state: {...s, elapsed: s.elapsed + c.deltaMs}, events: [] }),
      observe: (s,id) => ({ visibleState: { elapsed: s.elapsed, held: s.inputs[id], privateSeat: id }, legalActions: [{id:'go', control:{mode:'hold',releaseActionId:'stop'}},{id:'stop'}] }),
      result: s => s.elapsed >= ${options.finish ?? 3000} ? {outcome:'win',winnerSeatId:'sea_player_1'} : null
    }`,
      },
    ],
  })
  const project = {
    id: 'prj_realtime_payment',
    ownerId: 'owner',
    revision: 1,
    document,
    digest: await documentDigest(document),
    annotations: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  const release: StudioRelease = {
    id: 'rel_realtime_payment',
    projectId: project.id,
    revision: 1,
    document,
    digest: project.digest,
    manifest: await releaseManifest(project, 'rel_realtime_payment'),
    ownerId: project.ownerId,
    publishedAt: project.updatedAt,
  }
  const store = new MemoryMatchStore()
  const settle = vi.fn(async () => {
    expect((await store.get<TableRecord>(id))?.stage).toBe('settlement-pending')
    expect(
      (await store.get<TableRecord>(id))?.replay?.checkpoints.at(-1)?.state,
    ).toMatchObject({ elapsed: options.finish ?? 3000 })
    if (options.settleFails) throw new Error('RPC temporarily unavailable')
    return `0x${'22'.repeat(32)}` as const
  })
  const lock = vi.fn(async () => {
    if (options.lockFails) throw new Error('Pool not funded')
    return undefined
  })
  const adapter = {
    deployment: { chainId: 84532, contract: a.address, token: b.address },
    inspect: async () => ({ status: 0 }),
    create: async () => `0x${'11'.repeat(32)}` as const,
    lock,
    settle,
  }
  const newHost = () => {
    const host = new MatchHost(
      store,
      { 'base-sepolia': adapter },
      domain,
      undefined,
      undefined,
      async () => release,
    )
    hosts.push(host)
    return host
  }
  const host = newHost()
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
  }
  const id = `mat_${body.id}`
  const auth = async (
    account = a,
    operation = 'realtime-session',
    body: unknown = {},
  ) => {
    const expiresAt = Date.now() + 60_000
    return {
      address: account.address,
      expiresAt,
      signature: await account.signMessage({
        message: commandMessage(id, operation, body, expiresAt, domain),
      }),
    }
  }
  await host.create(body, await auth(a, 'create', body))
  // Keep signing asynchronous and explicit so it exercises production command validation.
  const begin = async () => host.start(id, await auth(a, 'start'))
  const connect = async (target = host, account = a) =>
    target.connectRealtime(
      id,
      (await target.realtimeSession(id, await auth(account))).token,
    )
  return {
    host,
    newHost,
    store,
    settle,
    lock,
    release,
    id,
    auth,
    begin,
    connect,
  }
}
it('ticks without readers or connected players and durably settles exactly once', async () => {
  const f = await fixture()
  await f.begin()
  await vi.advanceTimersByTimeAsync(4000)
  await vi.waitFor(
    async () => expect((await f.host.view(f.id)).stage).toBe('settled'),
    { timeout: 10000 },
  )
  expect(f.settle).toHaveBeenCalledOnce()
  await f.host.settle(f.id)
  expect(f.settle).toHaveBeenCalledOnce()
  expect((await f.host.view(f.id)).state).toBeNull()
})
it('does not run or grant gameplay control until funding locks', async () => {
  const f = await fixture({ lockFails: true })
  await expect(f.begin()).rejects.toThrow('not funded')
  await vi.advanceTimersByTimeAsync(4000)
  expect((await f.host.view(f.id)).stage).toBe('funding')
  expect(f.settle).not.toHaveBeenCalled()
  await expect(f.host.realtimeSession(f.id, await f.auth())).rejects.toThrow(
    'running realtime',
  )
  await f.host.close()
  expect((await f.store.get<TableRecord>(f.id))?.replay).toBeUndefined()
})
it('binds single-use tickets to a match and seat, fences replaced controllers, and releases held inputs', async () => {
  const f = await fixture({ finish: 10000 })
  await f.begin()
  await expect(
    f.host.realtimeSession(f.id, await f.auth(outsider)),
  ).rejects.toThrow('seated player')
  const ticket = await f.host.realtimeSession(f.id, await f.auth())
  await expect(
    f.host.connectRealtime('mat_other', ticket.token),
  ).rejects.toThrow('Invalid')
  const first = await f.host.connectRealtime(f.id, ticket.token)
  await expect(f.host.connectRealtime(f.id, ticket.token)).rejects.toThrow(
    'Invalid',
  )
  const move = () => ({
    actionId: randomUUID(),
    sequence: first.observation().stateSequence,
    payload: { id: 'go' },
  })
  await first.action(move())
  expect(first.observation().visibleState).toMatchObject({
    held: true,
    privateSeat: 'sea_player_1',
  })
  const replacement = await f.connect()
  expect(() => first.observation()).toThrow('expired')
  expect(replacement.observation().visibleState).toMatchObject({ held: false })
  await replacement.action({
    actionId: randomUUID(),
    sequence: replacement.observation().stateSequence,
    payload: { id: 'go' },
  })
  await first.close()
  expect(replacement.observation().visibleState).toMatchObject({ held: true })
  await replacement.close()
  const record = await f.store.get<TableRecord>(f.id)
  expect(record?.replay?.checkpoints.at(-1)?.state).toMatchObject({
    inputs: { sea_player_1: false },
  })
  const publicView = JSON.stringify(await f.host.view(f.id))
  expect(publicView).not.toContain('private-state')
  expect(publicView).not.toContain('privateSeat')
  const other = await f.connect(f.host, b)
  expect(other.observation().visibleState).toMatchObject({
    privateSeat: 'sea_player_2',
  })
  const expiring = await f.host.realtimeSession(f.id, await f.auth())
  vi.setSystemTime(Date.now() + 31000)
  await expect(f.host.connectRealtime(f.id, expiring.token)).rejects.toThrow(
    'expired',
  )
})
it('recovers durable progress and neutralizes held controls after a worker restart', async () => {
  const f = await fixture()
  await f.begin()
  const player = await f.connect()
  await player.action({
    actionId: randomUUID(),
    sequence: player.observation().stateSequence,
    payload: { id: 'go' },
  })
  await vi.advanceTimersByTimeAsync(1250)
  await f.host.close()
  const saved = (await f.store.get<TableRecord>(f.id))?.replay?.checkpoints.at(
    -1,
  )?.state as { elapsed: number }
  expect(saved.elapsed).toBeGreaterThan(0)
  const recovered = f.newHost()
  await recovered.recoverRealtime()
  const observation = await recovered.observation(
    f.id,
    await f.auth(a, 'observation'),
  )
  expect(observation.visibleState).toMatchObject({
    elapsed: saved.elapsed,
    held: false,
  })
  await vi.advanceTimersByTimeAsync(2000)
  await vi.waitFor(
    async () => expect((await recovered.view(f.id)).stage).toBe('settled'),
    { timeout: 10000 },
  )
  expect(f.settle).toHaveBeenCalledOnce()
})
it('leaves failed settlement retryable and never invents a winner after an expired match', async () => {
  const options = { settleFails: true }
  const f = await fixture(options)
  await f.begin()
  await vi.advanceTimersByTimeAsync(3100)
  await vi.waitFor(
    async () =>
      expect((await f.host.view(f.id)).stage).toBe('settlement-pending'),
    { timeout: 10000 },
  )
  options.settleFails = false
  await f.host.settle(f.id)
  expect((await f.host.view(f.id)).stage).toBe('settled')
  const expired = await fixture({ finish: 10000000 })
  await expired.begin()
  vi.setSystemTime(Date.now() + 4_300_000)
  await vi.advanceTimersByTimeAsync(100)
  expect((await expired.host.view(expired.id)).runtimeError).toContain(
    'deadline',
  )
  expect(expired.settle).not.toHaveBeenCalled()
})
it('admits a verified published realtime release', async () => {
  const f = await fixture()
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockImplementation(async (url: string) =>
        url.includes('/studio/')
          ? Response.json(f.release)
          : Response.json({ id: f.release.id, status: 'published' }),
      ),
  )
  expect(
    (await releaseLoader('https://registry.test')(f.release.id)).manifest.spec
      .mode,
  ).toBe('realtime')
})

it('authenticates gameplay on the real WebSocket transport and keeps private observations off spectator sockets', async () => {
  const { createServer } = await import('node:http')
  const { WebSocket, WebSocketServer } = await import('ws')
  const { attachPaymentSocket } = await import('./realtime-socket.js')
  const f = await fixture({ finish: 10000 })
  vi.useRealTimers()
  await f.begin()
  const server = createServer()
  const wss = new WebSocketServer({ server, maxPayload: 32768 })
  wss.on('connection', (socket) => attachPaymentSocket(f.host, socket, f.id))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  const clients: InstanceType<typeof WebSocket>[] = []
  const open = async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${address.port}`)
    clients.push(ws)
    const messages: any[] = []
    ws.on('message', (raw) => messages.push(JSON.parse(String(raw))))
    await new Promise<void>((resolve, reject) => {
      ws.once('open', resolve)
      ws.once('error', reject)
    })
    return { ws, messages }
  }
  try {
    const spectator = await open(),
      player = await open()
    spectator.ws.send(
      JSON.stringify({
        type: 'action',
        body: { actionId: randomUUID(), sequence: 0, payload: { id: 'go' } },
      }),
    )
    await vi.waitFor(() =>
      expect(spectator.messages.some((m) => m.type === 'error')).toBe(true),
    )
    const ticket = await f.host.realtimeSession(f.id, await f.auth())
    player.ws.send(
      JSON.stringify({ type: 'authenticate', token: ticket.token }),
    )
    await vi.waitFor(() =>
      expect(player.messages.some((m) => m.type === 'authenticated')).toBe(
        true,
      ),
    )
    const observation = player.messages.find(
      (m) => m.type === 'observation',
    ).observation
    player.ws.send(
      JSON.stringify({
        type: 'action',
        body: {
          actionId: randomUUID(),
          sequence: observation.stateSequence,
          payload: { id: 'go' },
        },
      }),
    )
    await vi.waitFor(() =>
      expect(player.messages.some((m) => m.type === 'ack')).toBe(true),
    )
    await vi.waitFor(() =>
      expect(
        player.messages.some((m) => m.observation?.visibleState.held),
      ).toBe(true),
    )
    expect(spectator.messages.some((m) => m.type === 'observation')).toBe(false)
    expect(JSON.stringify(spectator.messages)).not.toContain('private-state')
    player.ws.send('{malformed')
    await vi.waitFor(() =>
      expect(player.messages.some((m) => m.type === 'error')).toBe(true),
    )
    player.ws.close()
    await vi.waitFor(async () =>
      expect(
        (await f.host.observation(f.id, await f.auth(a, 'observation')))
          .visibleState,
      ).toMatchObject({ held: false }),
    )
  } finally {
    clients.forEach((client) => client.terminate())
    await new Promise<void>((resolve) => wss.close(() => resolve()))
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
