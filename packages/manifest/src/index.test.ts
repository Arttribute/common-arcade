import { describe, expect, it } from 'vitest'
import { ARCADE_API_VERSION, type GameManifest } from '@common-arcade/protocol'
import {
  canonicalJson,
  computeManifestDigest,
  negotiateExtensions,
  signManifest,
  verifyManifestDigest,
  verifyManifestSignature,
} from './index.js'

const zeroDigest = `sha256:${'0'.repeat(64)}`

function draft(): GameManifest {
  return {
    apiVersion: ARCADE_API_VERSION,
    kind: 'Game',
    metadata: {
      id: 'gam_tictactoe1',
      namespace: 'io.agentcommons.examples',
      slug: 'tic-tac-toe',
      version: '0.1.0',
      digest: zeroDigest,
      title: 'Tic-tac-toe',
      summary: 'A deterministic reference game.',
      publisher: { id: 'pub_agentcommons', name: 'Agent Commons' },
      tags: ['reference'],
    },
    spec: {
      mode: 'turn-based',
      profiles: ['base-v1', 'turn-based-v1'],
      extensions: [
        { id: 'https://example.com/required', required: true },
        { id: 'https://example.com/optional', required: false },
      ],
      seats: {
        min: 2,
        max: 2,
        roles: [{ id: 'player', title: 'Player', count: 2 }],
        spectators: true,
        lateJoin: false,
      },
      clock: { maxDurationSeconds: 600 },
      schemas: {
        config: { uri: './config.json' },
        publicState: { uri: './public-state.json' },
        observation: { uri: './observation.json' },
        action: { uri: './action.json' },
        event: { uri: './event.json' },
        result: { uri: './result.json' },
      },
      runtime: {
        type: 'declarative',
        module: 'tic-tac-toe',
        digest: zeroDigest,
      },
      presentation: { generic: true, bridge: 'semantic-v1' },
      policy: {
        tiers: ['declarative'],
        maxDecisionsPerSecond: 2,
        memoryKiB: 16,
      },
    },
  }
}

async function validManifest(): Promise<GameManifest> {
  const manifest = draft()
  manifest.metadata.digest = await computeManifestDigest(manifest)
  return manifest
}

describe('canonical JSON', () => {
  it('is stable across object insertion order', () => {
    expect(canonicalJson({ zebra: 1, alpha: { y: 2, x: 1 } })).toBe(
      canonicalJson({ alpha: { x: 1, y: 2 }, zebra: 1 }),
    )
  })
})

describe('manifest integrity', () => {
  it('detects semantic tampering', async () => {
    const manifest = await validManifest()
    expect(await verifyManifestDigest(manifest)).toBe(true)
    manifest.metadata.summary = 'Changed after publication.'
    expect(await verifyManifestDigest(manifest)).toBe(false)
  })

  it('signs and verifies a digest-pinned manifest', async () => {
    const manifest = await validManifest()
    const keys = await crypto.subtle.generateKey('Ed25519', true, [
      'sign',
      'verify',
    ])
    const signature = await signManifest(manifest, keys.privateKey, 'key_test')
    expect(
      await verifyManifestSignature(manifest, signature, keys.publicKey),
    ).toBe(true)

    manifest.metadata.title = 'Tampered'
    expect(
      await verifyManifestSignature(manifest, signature, keys.publicKey),
    ).toBe(false)
  })
})

describe('extension negotiation', () => {
  it('fails unknown required extensions and ignores optional ones', async () => {
    const result = negotiateExtensions(await validManifest(), [])
    expect(result).toEqual({
      accepted: [],
      ignored: ['https://example.com/optional'],
      unsupportedRequired: ['https://example.com/required'],
      compatible: false,
    })
  })
})
