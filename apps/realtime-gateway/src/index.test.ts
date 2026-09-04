import { afterEach, describe, expect, it } from 'vitest'
import {
  ARCADE_WIRE_VERSION,
  realtimeEnvelopeSchema,
  type RealtimeEnvelope,
  type RealtimeMessageType,
} from '@common-arcade/protocol'
import { WebSocket } from 'ws'
import { startArcadeServer, type RunningArcadeServer } from './index.js'

class Probe {
  private readonly messages: RealtimeEnvelope[] = []
  private readonly listeners = new Set<() => void>()

  constructor(readonly socket: WebSocket) {
    socket.on('message', (data) => {
      this.messages.push(
        realtimeEnvelopeSchema.parse(JSON.parse(data.toString())),
      )
      for (const listener of this.listeners) listener()
    })
  }

  async open(): Promise<void> {
    if (this.socket.readyState === WebSocket.OPEN) return
    await new Promise<void>((resolve, reject) => {
      this.socket.once('open', resolve)
      this.socket.once('error', reject)
    })
  }

  send(type: RealtimeMessageType, match: string, payload: unknown): void {
    this.socket.send(
      JSON.stringify({
        v: ARCADE_WIRE_VERSION,
        type,
        match,
        seq: 0,
        sentAt: new Date().toISOString(),
        payload,
      }),
    )
  }

  async next(type: RealtimeMessageType): Promise<RealtimeEnvelope> {
    const existing = this.messages.find((message) => message.type === type)
    if (existing !== undefined) {
      this.messages.splice(this.messages.indexOf(existing), 1)
      return existing
    }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.listeners.delete(check)
        reject(new Error(`Timed out waiting for ${type}`))
      }, 3_000)
      const check = () => {
        const message = this.messages.find(
          (candidate) => candidate.type === type,
        )
        if (message === undefined) return
        clearTimeout(timeout)
        this.listeners.delete(check)
        this.messages.splice(this.messages.indexOf(message), 1)
        resolve(message)
      }
      this.listeners.add(check)
    })
  }

  async close(): Promise<void> {
    if (this.socket.readyState === WebSocket.CLOSED) return
    const closed = new Promise<void>((resolve) =>
      this.socket.once('close', resolve),
    )
    this.socket.close()
    await closed
  }
}

let server: RunningArcadeServer | undefined

afterEach(async () => {
  await server?.close()
  server = undefined
})

async function post(
  baseUrl: string,
  path: string,
  actor: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer local:${actor}`,
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  })
  expect(response.status).toBeLessThan(300)
  return response.json() as Promise<Record<string, unknown>>
}

async function runningMatch(baseUrl: string) {
  const gamesResponse = await fetch(`${baseUrl}/v1/games`)
  const games = (await gamesResponse.json()) as {
    games: Array<{ spec: { release: { id: string } } }>
  }
  const match = await post(
    baseUrl,
    '/v1/matches',
    'player_one',
    { releaseId: 'rel_tictactoe1' },
    { 'idempotency-key': 'realtime-test-match' },
  )
  const seats = match.seats as Array<{ id: string }>
  await post(
    baseUrl,
    `/v1/matches/${String(match.id)}/seats/${String(seats[0]?.id)}/claim`,
    'player_one',
    { controllerId: 'controller-one' },
  )
  await post(
    baseUrl,
    `/v1/matches/${String(match.id)}/seats/${String(seats[1]?.id)}/claim`,
    'player_two',
    { controllerId: 'controller-two' },
  )
  return { match, seats }
}

describe('local REST and realtime stack', () => {
  it('plays an action, fans it out, and resumes without duplicating control', async () => {
    server = await startArcadeServer({ port: 0 })
    const { match, seats } = await runningMatch(server.baseUrl)
    const matchId = String(match.id)
    const session = await post(
      server.baseUrl,
      `/v1/matches/${matchId}/sessions`,
      'player_one',
      {
        mode: 'control',
        seatId: seats[0]?.id,
        controllerId: 'controller-one',
      },
    )
    const spectator = await post(
      server.baseUrl,
      `/v1/matches/${matchId}/sessions`,
      'viewer_one',
      { mode: 'spectate' },
    )

    const player = new Probe(
      new WebSocket(`${server.realtimeUrl}?match=${matchId}`),
    )
    const viewer = new Probe(
      new WebSocket(`${server.realtimeUrl}?match=${matchId}`),
    )
    await Promise.all([player.open(), viewer.open()])
    player.send('hello', matchId, { ticket: session.ticket })
    viewer.send('hello', matchId, { ticket: spectator.ticket })

    const welcome = await player.next('welcome')
    const granted = await player.next('control.granted')
    const observation = await player.next('observation.full')
    await viewer.next('welcome')
    await viewer.next('snapshot')
    const lease = (granted.payload as { controlLease: string }).controlLease
    const stateSequence = (observation.payload as { stateSequence: number })
      .stateSequence

    player.send('action.submit', matchId, {
      actionId: 'act_realtimeaction1',
      matchId,
      seatId: seats[0]?.id,
      controlLease: lease,
      clientSequence: 1,
      basedOnStateSequence: stateSequence,
      targetTurn: 1,
      payload: { type: 'place', cell: 4 },
    })

    expect(await player.next('action.result')).toMatchObject({
      payload: { disposition: 'accepted', stateSequence: 1 },
    })
    expect(await viewer.next('snapshot')).toMatchObject({
      payload: { match: { stateSequence: 1 } },
    })

    const resumeToken = (welcome.payload as { resumeToken: string }).resumeToken
    const lastSequence = welcome.seq
    await player.close()

    const resumed = new Probe(
      new WebSocket(`${server.realtimeUrl}?match=${matchId}`),
    )
    await resumed.open()
    resumed.send('resume', matchId, {
      sessionId: session.sessionId,
      resumeToken,
      lastSequence,
    })
    expect(await resumed.next('welcome')).toMatchObject({
      payload: { resumed: true },
    })
    await resumed.next('resync.required')
    expect(await resumed.next('observation.full')).toMatchObject({
      payload: { stateSequence: 1 },
    })

    await Promise.all([resumed.close(), viewer.close()])
  })
})
