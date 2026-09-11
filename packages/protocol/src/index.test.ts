import { describe, expect, it } from 'vitest'
import {
  ARCADE_API_VERSION,
  ARCADE_PROTOCOL,
  actionSubmissionSchema,
  emptyBrowserDocument,
  gameConfigurationSchema,
  gameDocumentSchema,
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

  it('accepts flexible role ranges while preserving manifests without them', () => {
    const base = manifest()
    const flexible = {
      ...base,
      spec: {
        ...base.spec,
        seats: {
          ...base.spec.seats,
          min: 1,
          max: 4,
          roles: [
            {
              id: 'player',
              title: 'Player',
              count: 2,
              minCount: 1,
              maxCount: 4,
            },
          ],
        },
      },
    }
    expect(gameManifestSchema.safeParse(flexible).success).toBe(true)

    const legacy = manifest()
    legacy.spec.seats.min = 1
    legacy.spec.seats.max = 4
    expect(gameManifestSchema.safeParse(legacy).success).toBe(true)
  })

  it('rejects role ranges that cannot satisfy the manifest seat range', () => {
    const base = manifest()
    const candidate = {
      ...base,
      spec: {
        ...base.spec,
        seats: {
          ...base.spec.seats,
          min: 1,
          max: 4,
          roles: [
            {
              id: 'player',
              title: 'Player',
              count: 2,
              minCount: 2,
              maxCount: 3,
            },
          ],
        },
      },
    }
    expect(gameManifestSchema.safeParse(candidate).success).toBe(false)
  })
})

describe('game configuration schemas', () => {
  const configurationSchema = {
    title: 'Match options',
    type: 'object',
    properties: {
      map: {
        type: 'string',
        default: 'small',
        enum: ['small', 'large'],
        minLength: 3,
        maxLength: 8,
      },
      speed: {
        type: 'number',
        default: 1.5,
        enum: [1, 1.5, 2],
        minimum: 1,
        maximum: 2,
        multipleOf: 0.5,
      },
      rounds: {
        type: 'integer',
        default: 3,
        minimum: 1,
        maximum: 9,
      },
      teams: { type: 'boolean', default: true },
    },
    required: ['map', 'speed', 'rounds', 'teams'],
    additionalProperties: false,
  }

  it('accepts the restricted primitive JSON Schema contract', () => {
    expect(
      gameConfigurationSchema.parse(configurationSchema).properties,
    ).toHaveProperty('speed.default', 1.5)
    expect(
      gameDocumentSchema.parse({
        ...emptyBrowserDocument,
        configurationSchema,
      }),
    ).toHaveProperty('configurationSchema.required', [
      'map',
      'speed',
      'rounds',
      'teams',
    ])
  })

  it('rejects inconsistent and unsupported schema definitions', () => {
    const invalidProperties = [
      { type: 'integer', default: 1.5 },
      { type: 'number', default: 3, minimum: 4 },
      { type: 'string', default: 'other', enum: ['small', 'large'] },
      { type: 'string', default: 'x'.repeat(501) },
      { type: 'string', default: '', maxLength: 501 },
      {
        type: 'string',
        default: '0',
        enum: Array.from({ length: 33 }, (_, index) => String(index)),
      },
      { type: 'boolean', default: true, enum: [true] },
      { type: 'object', default: {} },
    ]
    for (const property of invalidProperties)
      expect(
        gameConfigurationSchema.safeParse({
          type: 'object',
          properties: { option: property },
          required: [],
          additionalProperties: false,
        }).success,
      ).toBe(false)

    for (const required of [['map', 'map'], ['missing']])
      expect(
        gameConfigurationSchema.safeParse({
          ...configurationSchema,
          required,
        }).success,
      ).toBe(false)
  })
})

describe('browser play roles', () => {
  it('accepts role ranges that cover every supported seat count', () => {
    expect(
      gameDocumentSchema.safeParse({
        ...emptyBrowserDocument,
        play: {
          ...emptyBrowserDocument.play,
          seats: { min: 2, max: 6, default: 3 },
          roles: [
            {
              id: 'host',
              title: 'Host',
              count: 1,
              minCount: 1,
              maxCount: 1,
            },
            {
              id: 'player',
              title: 'Player',
              count: 2,
              minCount: 1,
              maxCount: 5,
            },
          ],
        },
      }).success,
    ).toBe(true)
  })

  it('treats roles without ranges as fixed', () => {
    expect(
      gameDocumentSchema.safeParse({
        ...emptyBrowserDocument,
        play: {
          ...emptyBrowserDocument.play,
          seats: { min: 2, max: 3, default: 2 },
          roles: [{ id: 'player', title: 'Player', count: 2 }],
        },
      }).success,
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
