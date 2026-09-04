import {
  createGridPlacementGame,
  type GridPlacementAction,
  type GridPlacementRuleSet,
  type GridPlacementState,
} from '@common-arcade/match-runtime'
import { computeManifestDigest } from '@common-arcade/manifest'
import { ARCADE_API_VERSION, type GameManifest } from '@common-arcade/protocol'
import rulesDocument from '../arcade.rules.json' with { type: 'json' }

export type TicTacToeState = GridPlacementState
export type PlaceAction = GridPlacementAction

const runtimeDigest = `sha256:${'b'.repeat(64)}`
const releaseDigest =
  'sha256:463e74645ac4e1d92bd7a7b9e5c6e8d5016e04bcecd0e476624d3e158c5914d9'

export const ticTacToeRules = rulesDocument as GridPlacementRuleSet

export const ticTacToeGame = createGridPlacementGame(ticTacToeRules)

const manifestDraft: GameManifest = {
  apiVersion: ARCADE_API_VERSION,
  kind: 'Game',
  metadata: {
    id: 'gam_tictactoe1',
    namespace: 'io.agentcommons.examples',
    slug: 'tic-tac-toe',
    version: '0.1.0',
    digest: `sha256:${'0'.repeat(64)}`,
    title: 'Tic-tac-toe',
    summary:
      'A deterministic two-seat reference game with generated controls and complete replay.',
    publisher: { id: 'pub_agentcommons', name: 'Agent Commons' },
    tags: ['reference', 'turn-based', 'agents'],
  },
  spec: {
    mode: 'turn-based',
    profiles: [
      'base-v1',
      'turn-based-v1',
      'replay-v1',
      'generic-controls-v1',
      'policy-v1',
      'semantic-presentation-v1',
    ],
    extensions: [],
    seats: {
      min: 2,
      max: 2,
      roles: [{ id: 'player', title: 'Player', count: 2 }],
      spectators: true,
      lateJoin: false,
    },
    clock: { turnTimeoutMs: 30_000, maxDurationSeconds: 600 },
    schemas: {
      config: { uri: './schemas/config.schema.json' },
      publicState: { uri: './schemas/public-state.schema.json' },
      observation: { uri: './schemas/observation.schema.json' },
      action: { uri: './schemas/action.schema.json' },
      event: { uri: './schemas/event.schema.json' },
      result: { uri: './schemas/result.schema.json' },
    },
    runtime: {
      type: 'declarative',
      module: 'grid-placement',
      digest: runtimeDigest,
    },
    presentation: { generic: true, bridge: 'semantic-v1' },
    policy: {
      tiers: ['declarative'],
      maxDecisionsPerSecond: 2,
      memoryKiB: 16,
    },
  },
}

let resolvedManifest: Promise<GameManifest> | undefined

export function getTicTacToeManifest(): Promise<GameManifest> {
  resolvedManifest ??= (async () => {
    const manifest = structuredClone(manifestDraft)
    manifest.metadata.digest = await computeManifestDigest(manifest)
    return manifest
  })()
  return resolvedManifest
}
