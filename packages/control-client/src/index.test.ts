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
        idempotencyKey: 'client-test-key',
      }),
    ).toMatchObject({ id: descriptor.id, status: 'lobby' })
    expect(request?.headers.get('authorization')).toBe('Bearer local:agent_one')
    expect(request?.headers.get('idempotency-key')).toBe('client-test-key')
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
