import { describe, expect, it } from 'vitest'
import { LocalArcadePlatform } from '@common-arcade/match-worker-service'
import {
  discoveryDocumentSchema,
  emptyBrowserDocument,
  type StudioRelease,
} from '@common-arcade/protocol'
import { createApp } from './app.js'
import { MemoryDocumentStore } from './store.js'

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
    expect(games.games).toEqual([])
    expect(
      await (await app.request('/v1/games/gam_tictactoe1/releases')).json(),
    ).toMatchObject({
      releases: [
        {
          id: 'rel_tictactoe1',
          gameId: 'gam_tictactoe1',
          status: 'published',
        },
      ],
    })

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
      body: JSON.stringify({
        releaseId: 'rel_tictactoe1',
        configuration: {},
        roleCounts: { player: 2 },
        seed: 'seed-one',
        visibility: 'public',
      }),
    })
    expect(createResponse.status).toBe(201)
    const match = (await createResponse.json()) as {
      id: string
      status: string
      seats: { id: string }[]
    }
    expect(match.status).toBe('lobby')
    expect(match).toMatchObject({
      ownerId: 'actor_one',
      configuration: {},
    })
    const live = (await (await app.request('/v1/matches')).json()) as {
      matches: Array<{ id: string; visibility: string }>
    }
    expect(live.matches).toContainEqual(
      expect.objectContaining({ id: match.id, visibility: 'public' }),
    )
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

    const restart = await app.request(`/v1/matches/${match.id}/restart`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer local:actor_one',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        configuration: {},
        roleCounts: { player: 2 },
      }),
    })
    expect(restart.status).toBe(409)
    const bodylessRestart = await app.request(
      `/v1/matches/${match.id}/restart`,
      {
        method: 'POST',
        headers: { Authorization: 'Bearer local:actor_one' },
      },
    )
    expect(bodylessRestart.status).toBe(409)
  })

  it('serves validated release configuration schemas', async () => {
    const store = new MemoryDocumentStore()
    const configurationSchema = {
      type: 'object' as const,
      properties: {
        pace: { type: 'integer' as const, default: 2, minimum: 1, maximum: 4 },
      },
      required: ['pace'],
      additionalProperties: false as const,
    }
    const release = {
      id: 'rel_schema_test',
      projectId: 'prj_schema_test',
      revision: 1,
      document: { ...emptyBrowserDocument, configurationSchema },
      digest: `sha256:${'a'.repeat(64)}`,
      manifest: {} as StudioRelease['manifest'],
      publishedAt: '2026-01-01T00:00:00.000Z',
    } satisfies StudioRelease
    await store.put('releases', release.id, { version: 1, release })
    const app = createApp({ store, allowLocalAuth: true, logRequests: false })

    const custom = await app.request(
      `/v1/releases/${release.id}/schemas/config`,
    )
    expect(custom.status).toBe(200)
    expect(custom.headers.get('content-type')).toContain('application/json')
    expect(await custom.json()).toEqual(configurationSchema)
    expect(
      await (
        await app.request('/v1/releases/rel_tictactoe1/schemas/config')
      ).json(),
    ).toEqual({
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    })
    expect(
      (await app.request('/v1/releases/rel_missing/schemas/config')).status,
    ).toBe(404)
    expect(
      await (await app.request('/v1/releases/rel_tictactoe1/manifest')).json(),
    ).toMatchObject({ metadata: { id: 'gam_tictactoe1' } })
    expect(
      (await app.request('/v1/releases/rel_missing/manifest')).status,
    ).toBe(404)
  })

  it('matches humans and agents into one compatible public lobby', async () => {
    const app = await localApp()
    const join = (actor: string, controllerKind: 'human' | 'agent') =>
      app.request('/v1/matchmaking', {
        method: 'POST',
        headers: {
          Authorization: `Bearer local:${actor}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': `queue-${actor}`,
        },
        body: JSON.stringify({
          releaseId: 'rel_tictactoe1',
          controllerId: `${controllerKind}-${actor}`,
          controllerKind,
          series: { maximumRounds: 3, restartPolicy: 'unanimous' },
        }),
      })
    const first = await join('player_one', 'human')
    expect(first.status).toBe(201)
    const firstMatch = await first.json()
    expect(firstMatch).toMatchObject({
      seatId: expect.stringMatching(/^sea_/),
      match: {
        status: 'lobby',
        visibility: 'public',
        series: { maximumRounds: 3, restartPolicy: 'unanimous' },
      },
    })
    const second = await join('player_two', 'agent')
    expect(second.status).toBe(201)
    expect(await second.json()).toMatchObject({
      match: {
        id: firstMatch.match.id,
        status: 'running',
        seats: [
          { actorId: 'player_one', controllerKind: 'human' },
          { actorId: 'player_two', controllerKind: 'agent' },
        ],
      },
    })
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

  it('keeps private match details and replays owner-scoped', async () => {
    const app = await localApp()
    const created = await app.request('/v1/matches', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer local:private_owner',
        'Content-Type': 'application/json',
        'Idempotency-Key': 'private-control-match',
      },
      body: JSON.stringify({
        releaseId: 'rel_tictactoe1',
        visibility: 'private',
      }),
    })
    const match = (await created.json()) as { id: string }
    expect((await app.request(`/v1/matches/${match.id}`)).status).toBe(403)
    expect(
      (
        await app.request(`/v1/matches/${match.id}`, {
          headers: { Authorization: 'Bearer local:private_owner' },
        })
      ).status,
    ).toBe(200)
    expect(
      (
        await app.request(`/v1/matches/${match.id}/replay`, {
          headers: { Authorization: 'Bearer local:not_the_owner' },
        })
      ).status,
    ).toBe(403)
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

it('lists unlisted and private sessions only for their authenticated host or participant', async () => {
  const platform = await LocalArcadePlatform.create()
  const app = createApp({ platform, allowLocalAuth: true, logRequests: false })
  try {
    const hidden = await platform.createMatch({
      releaseId: 'rel_tictactoe1',
      ownerId: 'host_one',
      idempotencyKey: 'hidden-one',
      visibility: 'unlisted',
    })
    const privateMatch = await platform.createMatch({
      releaseId: 'rel_tictactoe1',
      ownerId: 'host_two',
      idempotencyKey: 'private-two',
      visibility: 'private',
    })
    const listed = await platform.createMatch({
      releaseId: 'rel_tictactoe1',
      ownerId: 'host_one',
      idempotencyKey: 'public-three',
      visibility: 'public',
    })
    await platform.claimSeat({
      matchId: hidden.id,
      seatId: hidden.seats[0]!.id,
      actorId: 'player_one',
      controllerId: 'agent-one',
      controllerKind: 'agent',
    })
    const read = async (path: string, actor?: string) =>
      (
        await app.request(
          path,
          actor ? { headers: { Authorization: `Bearer local:${actor}` } } : {},
        )
      ).json()
    expect((await read('/v1/matches')).matches.map((m: any) => m.id)).toEqual([
      listed.id,
    ])
    expect((await app.request('/v1/matches?scope=mine')).status).toBe(401)
    expect(
      (await read('/v1/matches?scope=mine', 'host_one')).matches
        .map((m: any) => m.id)
        .sort(),
    ).toEqual([hidden.id, listed.id].sort())
    expect(
      (await read('/v1/matches?scope=mine', 'player_one')).matches.map(
        (m: any) => m.id,
      ),
    ).toEqual([hidden.id])
    expect((await read('/v1/matches?scope=mine', 'unrelated')).matches).toEqual(
      [],
    )
    expect(
      (await read('/v1/matches?scope=mine', 'host_two')).matches[0].id,
    ).toBe(privateMatch.id)
    await platform.abandonMatch(hidden.id, 'host_one')
    expect(
      (await read('/v1/matches?scope=mine', 'player_one')).matches,
    ).toEqual([])
  } finally {
    platform.close()
  }
})

it('authenticates controller handoff and rejects stale or foreign release requests', async () => {
  const platform = await LocalArcadePlatform.create()
  const app = createApp({ platform })
  try {
    const match = await platform.createMatch({
      releaseId: 'rel_tictactoe1',
      idempotencyKey: 'handoff-api',
      ownerId: 'owner',
    })
    const seatId = match.seats[0]!.id
    await platform.claimSeat({
      matchId: match.id,
      seatId,
      actorId: 'owner',
      controllerId: 'human',
    })
    const request = (operation: string, body: unknown, actor?: string) =>
      app.request(`/v1/matches/${match.id}/seats/${seatId}/${operation}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(actor ? { Authorization: `Bearer local:${actor}` } : {}),
        },
        body: JSON.stringify(body),
      })
    expect(
      (await request('release', { expectedControllerId: 'human' })).status,
    ).toBe(401)
    expect(
      (await request('release', { expectedControllerId: 'human' }, 'other'))
        .status,
    ).toBe(403)
    const changed = await request(
      'controller',
      {
        expectedControllerId: 'human',
        controllerId: 'external-test',
        controllerKind: 'agent',
      },
      'owner',
    )
    expect(changed.status).toBe(200)
    expect((await changed.json()).seats[0].controllerId).toBe('external-test')
    expect(
      (await request('release', { expectedControllerId: 'human' }, 'owner'))
        .status,
    ).toBe(409)
    expect(
      (
        await request(
          'release',
          { expectedControllerId: 'external-test' },
          'owner',
        )
      ).status,
    ).toBe(200)
  } finally {
    platform.close()
  }
})

it('returns structured validation failures even when they are not native Error objects', async () => {
  const app = createApp({ logRequests: false })
  app.get('/test-nonnative-error', () => {
    throw {
      name: 'ZodError',
      issues: [
        {
          path: ['document', 'runtime'],
          code: 'custom',
          message: 'Headless test exceeded its budget',
        },
      ],
    }
  })
  const response = await app.request('/test-nonnative-error')
  expect(response.status).toBe(422)
  expect(await response.json()).toMatchObject({
    code: 'INVALID_REQUEST',
    violations: [{ message: 'Headless test exceeded its budget' }],
  })
})
