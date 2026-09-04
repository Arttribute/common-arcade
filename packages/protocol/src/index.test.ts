import { describe, expect, it } from 'vitest'
import {
  ARCADE_API_VERSION,
  ARCADE_PROTOCOL,
  actionSubmissionSchema,
  gameManifestSchema,
  gameReleaseDescriptorSchema,
  isArcadeProtocolNamespace,
  realtimeEnvelopeSchema,
} from './index.js'

const digest = `sha256:${'a'.repeat(64)}`

function manifest() {
  return {
    apiVersion: ARCADE_API_VERSION,
    kind: 'Game',
    metadata: {
      id: 'gam_tictactoe1',
      namespace: 'io.agentcommons.examples',
      slug: 'tic-tac-toe',
      version: '0.1.0',
      digest,
      title: 'Tic-tac-toe',
      summary: 'A deterministic reference game.',
      publisher: { id: 'pub_agentcommons', name: 'Agent Commons' },
      tags: ['turn-based'],
    },
    spec: {
      mode: 'turn-based',
      profiles: ['base-v1', 'turn-based-v1', 'replay-v1'],
      extensions: [],
      seats: {
        min: 2,
        max: 2,
        roles: [{ id: 'player', title: 'Player', count: 2 }],
        spectators: true,
        lateJoin: false,
      },
      clock: { maxDurationSeconds: 600 },
      schemas: Object.fromEntries(
        [
          'config',
          'publicState',
          'observation',
          'action',
          'event',
          'result',
        ].map((name) => [name, { uri: `./schemas/${name}.json` }]),
      ),
      runtime: { type: 'declarative', module: 'tic-tac-toe', digest },
      presentation: { generic: true, bridge: 'semantic-v1' },
      policy: {
        tiers: ['declarative'],
        maxDecisionsPerSecond: 2,
        memoryKiB: 16,
      },
    },
  }
}

describe('protocol metadata', () => {
  it('identifies the active incubating protocol', () => {
    expect(ARCADE_PROTOCOL.stability).toBe('v0alpha1')
    expect(isArcadeProtocolNamespace(ARCADE_PROTOCOL.namespace)).toBe(true)
    expect(isArcadeProtocolNamespace('arcade/v1')).toBe(false)
  })
})

describe('game manifest', () => {
  it('accepts a complete turn-based manifest', () => {
    expect(gameManifestSchema.parse(manifest()).metadata.slug).toBe(
      'tic-tac-toe',
    )
  })

  it('rejects realtime games without an authoritative tick', () => {
    const candidate = manifest()
    candidate.spec.mode = 'realtime'
    expect(gameManifestSchema.safeParse(candidate).success).toBe(false)
  })

  it('rejects unknown top-level capability claims', () => {
    expect(
      gameManifestSchema.safeParse({ ...manifest(), admin: true }).success,
    ).toBe(false)
  })
})

describe('game release', () => {
  it('identifies the immutable release separately from its game', () => {
    expect(
      gameReleaseDescriptorSchema.parse({
        id: 'rel_tictactoe1',
        gameId: 'gam_tictactoe1',
        version: '0.1.0',
        digest,
        status: 'published',
        profiles: ['base-v1', 'turn-based-v1'],
      }),
    ).toMatchObject({ gameId: 'gam_tictactoe1', status: 'published' })
  })
})

describe('realtime primitives', () => {
  it('validates an idempotent action submission', () => {
    const action = actionSubmissionSchema.parse({
      actionId: 'act_abcdefgh',
      matchId: 'mat_abcdefgh',
      seatId: 'sea_abcdefgh',
      controlLease: 'lease_0123456789abcdef',
      clientSequence: 1,
      basedOnStateSequence: 0,
      targetTurn: 1,
      payload: { type: 'place', cell: 4 },
    })
    expect(action.payload).toEqual({ type: 'place', cell: 4 })
  })

  it('requires the negotiated wire version', () => {
    expect(
      realtimeEnvelopeSchema.safeParse({
        v: 'v1',
        type: 'ping',
        seq: 0,
        sentAt: new Date().toISOString(),
        payload: {},
      }).success,
    ).toBe(false)
  })
})
