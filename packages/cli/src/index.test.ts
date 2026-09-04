import { describe, expect, it } from 'vitest'
import { runCli } from './index.js'

const descriptor = {
  id: 'mat_climatch001',
  releaseId: 'rel_tictactoe1',
  releaseDigest: `sha256:${'a'.repeat(64)}`,
  mode: 'turn-based',
  status: 'lobby',
  ownershipEpoch: 1,
  stateSequence: 0,
  eventSequence: 0,
  createdAt: '2026-09-04T10:00:00.000Z',
  updatedAt: '2026-09-04T10:00:00.000Z',
  seats: [
    { id: 'sea_cliseat0001', role: 'player', status: 'open' },
    { id: 'sea_cliseat0002', role: 'player', status: 'open' },
  ],
}

describe('arcade CLI', () => {
  it('prints a useful command map', async () => {
    const output: string[] = []
    expect(
      await runCli({ args: ['help'], write: (line) => output.push(line) }),
    ).toBe(0)
    expect(output.join('\n')).toContain('games search')
    expect(output.join('\n')).toContain('matches create')
  })

  it('creates a match with local actor authentication', async () => {
    const output: string[] = []
    let request: Request | undefined
    const result = await runCli({
      args: [
        'matches',
        'create',
        '--release',
        'rel_tictactoe1',
        '--idempotency-key',
        'cli-test-key',
      ],
      env: {
        ARCADE_API_URL: 'https://arcade.example',
        ARCADE_ACTOR_ID: 'cli_agent',
      },
      fetch: async (input, init) => {
        request = new Request(input, init)
        return Response.json(descriptor, { status: 201 })
      },
      write: (line) => output.push(line),
    })

    expect(result).toBe(0)
    expect(request?.headers.get('authorization')).toBe('Bearer local:cli_agent')
    expect(output.join('\n')).toContain('mat_climatch001')
  })
})
