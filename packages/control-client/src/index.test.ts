import { describe, expect, it } from 'vitest'
import { ControlClient } from './index.js'

const timestamp = '2026-09-04T10:00:00.000Z'
const descriptor = {
  id: 'mat_clientmatch1',
  releaseId: 'rel_tictactoe1',
  releaseDigest: `sha256:${'a'.repeat(64)}`,
  mode: 'turn-based',
  status: 'lobby',
  ownershipEpoch: 1,
  stateSequence: 0,
  eventSequence: 0,
  createdAt: timestamp,
  updatedAt: timestamp,
  configuration: {},
  seats: [
    { id: 'sea_clientseat01', role: 'player', status: 'open' },
    { id: 'sea_clientseat02', role: 'player', status: 'open' },
  ],
}

describe('ControlClient', () => {
  it('binds local auth and idempotency while validating responses', async () => {
    let request: Request | undefined
    const client = new ControlClient({
      baseUrl: 'https://arcade.example',
      actorId: 'agent_one',
      fetch: async (input, init) => {
        request = new Request(input, init)
        return Response.json(descriptor, { status: 201 })
      },
    })

    expect(
      await client.createMatch({
        releaseId: 'rel_tictactoe1',
        configuration: {},
        roleCounts: { player: 2 },
        idempotencyKey: 'client-test-key',
      }),
    ).toMatchObject({ id: descriptor.id, status: 'lobby' })
    expect(request?.headers.get('authorization')).toBe('Bearer local:agent_one')
    expect(request?.headers.get('idempotency-key')).toBe('client-test-key')
    expect(await request?.json()).toEqual({
      releaseId: 'rel_tictactoe1',
      configuration: {},
      roleCounts: { player: 2 },
    })
  })

  it('fetches release configuration schemas and sends next-round overrides', async () => {
    const requests: Request[] = []
    const schema = {
      type: 'object' as const,
      properties: {
        difficulty: { type: 'integer' as const, default: 2, minimum: 1 },
      },
      required: ['difficulty'],
      additionalProperties: false as const,
    }
    const client = new ControlClient({
      baseUrl: 'https://arcade.example',
      fetch: async (input, init) => {
        const request = new Request(input, init)
        requests.push(request)
        return request.url.endsWith('/schemas/config')
          ? Response.json(schema)
          : Response.json({
              ...descriptor,
              configuration: { difficulty: 3 },
            })
      },
    })

    await expect(
      client.getReleaseConfigurationSchema('rel_tictactoe1'),
    ).resolves.toEqual(schema)
    await client.restartRound('mat_clientmatch1', {
      configuration: { difficulty: 3 },
      roleCounts: { player: 2 },
    })
    expect(requests[0]?.url).toBe(
      'https://arcade.example/v1/releases/rel_tictactoe1/schemas/config',
    )
    expect(await requests[1]?.json()).toEqual({
      configuration: { difficulty: 3 },
      roleCounts: { player: 2 },
    })
  })

  it('preserves the legacy restart signal argument', async () => {
    let request: Request | undefined
    let requestSignal: AbortSignal | null | undefined
    const client = new ControlClient({
      baseUrl: 'https://arcade.example',
      fetch: async (input, init) => {
        requestSignal = init?.signal
        request = new Request(input, init)
        return Response.json(descriptor)
      },
    })
    const controller = new AbortController()
    await client.restartRound('mat_clientmatch1', controller.signal)
    expect(requestSignal).toBe(controller.signal)
    expect(await request?.json()).toEqual({})
  })

  it('exposes structured problem details', async () => {
    const client = new ControlClient({
      baseUrl: 'https://arcade.example',
      fetch: async () =>
        Response.json(
          {
            type: 'https://arcade.example/problems/not-found',
            title: 'Not found',
            status: 404,
            detail: 'Unknown match',
            code: 'NOT_FOUND',
            requestId: 'request-one',
            retryable: false,
          },
          { status: 404 },
        ),
    })

    await expect(client.getMatch('mat_missing001')).rejects.toMatchObject({
      name: 'ArcadeApiError',
      problem: { code: 'NOT_FOUND', status: 404 },
    })
  })
})

it('reports upstream HTML failures without exposing markup or JSON parser errors', async () => {
  const client = new ControlClient({
    baseUrl: 'https://arcade.example',
    fetch: async () =>
      new Response('<html><h1>Unavailable</h1></html>', {
        status: 503,
        headers: { 'Content-Type': 'text/html' },
      }),
  })
  await expect(client.getMatch('mat_unavailable')).rejects.toThrow('HTTP 503')
})
