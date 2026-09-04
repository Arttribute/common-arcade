import { describe, expect, it } from 'vitest'
import { LocalArcadePlatform } from '@common-arcade/match-worker-service'
import { discoveryDocumentSchema } from '@common-arcade/protocol'
import { createApp } from './app.js'

async function localApp() {
  const platform = await LocalArcadePlatform.create({
    ticketSecret: new Uint8Array(32).fill(3),
    now: () => new Date('2026-01-01T00:00:00.000Z'),
  })
  return createApp({ platform, logRequests: false })
}

describe('control API foundation', () => {
  it('reports whether its match service is configured', async () => {
    const withoutRuntime = await createApp({ logRequests: false }).request(
      '/healthz',
    )
    expect(await withoutRuntime.json()).toMatchObject({
      status: 'ok',
      matchService: 'unconfigured',
    })

    const response = await (await localApp()).request('/healthz')
    expect(await response.json()).toMatchObject({
      status: 'ok',
      service: 'common-arcade-control-api',
      matchService: 'local',
    })
  })

  it('publishes a valid discovery document', async () => {
    const response = await (
      await localApp()
    ).request('/.well-known/arcade.json')
    expect(
      discoveryDocumentSchema.safeParse(await response.json()).success,
    ).toBe(true)
  })

  it('runs the release-to-ticket control flow', async () => {
    const app = await localApp()
    const gamesResponse = await app.request('/v1/games')
    const games = (await gamesResponse.json()) as {
      games: { metadata: { id: string }; spec: unknown }[]
    }
    expect(games.games[0]?.metadata.id).toBe('gam_tictactoe1')

    const unauthenticated = await app.request('/v1/matches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ releaseId: 'rel_tictactoe1' }),
    })
    expect(unauthenticated.status).toBe(401)

    const createResponse = await app.request('/v1/matches', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer local:actor_one',
        'Content-Type': 'application/json',
        'Idempotency-Key': 'control-api-match-one',
      },
      body: JSON.stringify({ releaseId: 'rel_tictactoe1', seed: 'seed-one' }),
    })
    expect(createResponse.status).toBe(201)
    const match = (await createResponse.json()) as {
      id: string
      status: string
      seats: { id: string }[]
    }
    expect(match.status).toBe('lobby')
    const first = match.seats[0]
    const second = match.seats[1]
    if (first === undefined || second === undefined)
      throw new Error('Missing seats')

    for (const [seat, actor, controller] of [
      [first, 'actor_one', 'controller_one'],
      [second, 'actor_two', 'controller_two'],
    ] as const) {
      const claim = await app.request(
        `/v1/matches/${match.id}/seats/${seat.id}/claim`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer local:${actor}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ controllerId: controller }),
        },
      )
      expect(claim.status).toBe(200)
    }

    const session = await app.request(`/v1/matches/${match.id}/sessions`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer local:actor_one',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        mode: 'control',
        seatId: first.id,
        controllerId: 'controller_one',
      }),
    })
    expect(session.status).toBe(201)
    expect(await session.json()).toMatchObject({
      sessionId: expect.stringMatching(/^ses_/),
      ticket: expect.any(String),
      realtimeUrl: 'ws://localhost:4100/realtime',
    })

    expect(
      await (await app.request(`/v1/matches/${match.id}`)).json(),
    ).toMatchObject({ status: 'running' })
  })

  it('uses problem details and does not reflect an untrusted origin', async () => {
    const app = await localApp()
    const missing = await app.request('/v1/games/gam_doesnotexist')
    expect(missing.status).toBe(404)
    expect(await missing.json()).toMatchObject({
      code: 'NOT_FOUND',
      retryable: false,
      requestId: expect.any(String),
    })

    const response = await app.request('/v1/status', {
      headers: { origin: 'https://attacker.invalid' },
    })
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('runs autonomous agents and exposes owner-scoped diagnostics', async () => {
    const app = await localApp()
    const created = await app.request('/v1/test-runs', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer local:creator_one',
        'Content-Type': 'application/json',
        'Idempotency-Key': 'control-api-test-run-one',
      },
      body: JSON.stringify({ execution: 'complete', seed: 'visible-seed' }),
    })
    expect(created.status).toBe(201)
    const run = (await created.json()) as {
      runId: string
      status: string
      steps: number
      diagnostics: unknown[]
    }
    expect(run).toMatchObject({ status: 'completed' })
    expect(run.steps).toBeGreaterThanOrEqual(5)
    expect(run.diagnostics.length).toBe(run.steps * 3)

    const diagnostics = await app.request(
      `/v1/test-runs/${run.runId}/diagnostics?category=policy`,
      { headers: { Authorization: 'Bearer local:creator_one' } },
    )
    expect(diagnostics.status).toBe(200)
    const diagnosticBody = (await diagnostics.json()) as {
      records: Array<{ category: string; type: string }>
    }
    expect(
      diagnosticBody.records.some(
        (record) =>
          record.category === 'policy' &&
          record.type === 'agent.observation.delivered',
      ),
    ).toBe(true)

    const forbidden = await app.request(`/v1/test-runs/${run.runId}`, {
      headers: { Authorization: 'Bearer local:different_creator' },
    })
    expect(forbidden.status).toBe(403)
  })
})
