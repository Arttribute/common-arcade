import { verifyManifestDigest } from '@common-arcade/manifest'
import { verifyReplay, type GameDefinition } from '@common-arcade/match-runtime'
import {
  gameManifestSchema,
  replaySchema,
  type GameManifest,
  type Replay,
} from '@common-arcade/protocol'

export type ConformanceProfile =
  | 'base-v1'
  | 'turn-based-v1'
  | 'replay-v1'
  | 'generic-controls-v1'
  | 'policy-v1'

export interface ConformanceCheck {
  readonly id: string
  readonly profile: ConformanceProfile
  readonly passed: boolean
  readonly detail: string
}

export interface ConformanceReport {
  readonly passed: boolean
  readonly profiles: readonly ConformanceProfile[]
  readonly checks: readonly ConformanceCheck[]
}

function check(
  id: string,
  profile: ConformanceProfile,
  passed: boolean,
  detail: string,
): ConformanceCheck {
  return { id, profile, passed, detail }
}

export async function conformManifest(
  candidate: unknown,
): Promise<ConformanceReport> {
  const parsed = gameManifestSchema.safeParse(candidate)
  if (!parsed.success) {
    return {
      passed: false,
      profiles: [],
      checks: [
        check(
          'manifest.schema',
          'base-v1',
          false,
          parsed.error.issues.map((issue) => issue.message).join('; '),
        ),
      ],
    }
  }
  const manifest = parsed.data
  const declared = new Set(manifest.spec.profiles)
  const profiles = [
    'base-v1',
    'turn-based-v1',
    'replay-v1',
    'generic-controls-v1',
    'policy-v1',
  ].filter((profile): profile is ConformanceProfile =>
    declared.has(profile as never),
  )
  const checks: ConformanceCheck[] = [
    check('manifest.schema', 'base-v1', true, 'Manifest matches v0alpha1.'),
    check(
      'manifest.digest',
      'base-v1',
      await verifyManifestDigest(manifest),
      'Manifest digest matches canonical content.',
    ),
  ]
  if (declared.has('turn-based-v1')) {
    checks.push(
      check(
        'turn.clock',
        'turn-based-v1',
        manifest.spec.mode === 'turn-based' &&
          manifest.spec.clock.turnTimeoutMs !== undefined,
        'Turn-based releases declare mode and a turn timeout.',
      ),
    )
  }
  if (declared.has('replay-v1')) {
    checks.push(
      check(
        'replay.runtime-digest',
        'replay-v1',
        'digest' in manifest.spec.runtime ||
          'artifact' in manifest.spec.runtime,
        'Replayable runtime is content-addressed.',
      ),
    )
  }
  if (declared.has('generic-controls-v1')) {
    checks.push(
      check(
        'presentation.generic',
        'generic-controls-v1',
        manifest.spec.presentation.generic &&
          manifest.spec.presentation.bridge === 'semantic-v1',
        'Generic presentation and semantic bridge are enabled.',
      ),
    )
  }
  if (declared.has('policy-v1')) {
    checks.push(
      check(
        'policy.budgets',
        'policy-v1',
        manifest.spec.policy.maxDecisionsPerSecond > 0 &&
          manifest.spec.policy.memoryKiB > 0,
        'Policy decision and memory budgets are explicit.',
      ),
    )
  }
  return { passed: checks.every((item) => item.passed), profiles, checks }
}

export async function conformReplay<State, Action>(
  game: GameDefinition<State, Action>,
  candidate: unknown,
): Promise<ConformanceReport> {
  const parsed = replaySchema.safeParse(candidate)
  if (!parsed.success) {
    return {
      passed: false,
      profiles: ['replay-v1'],
      checks: [
        check(
          'replay.schema',
          'replay-v1',
          false,
          parsed.error.issues.map((issue) => issue.message).join('; '),
        ),
      ],
    }
  }
  const verification = await verifyReplay(game, parsed.data)
  const checks = [
    check('replay.schema', 'replay-v1', true, 'Replay matches v0alpha1.'),
    check(
      'replay.determinism',
      'replay-v1',
      verification.valid,
      verification.valid
        ? `${verification.checkedCheckpoints} checkpoints reproduced.`
        : verification.mismatches.join('; '),
    ),
  ]
  return {
    passed: checks.every((item) => item.passed),
    profiles: ['replay-v1'],
    checks,
  }
}

export function summarizeConformance(report: ConformanceReport): string {
  return report.checks
    .map(
      (item) =>
        `${item.passed ? 'PASS' : 'FAIL'} ${item.profile}/${item.id}: ${item.detail}`,
    )
    .join('\n')
}

export const conformanceStatus = {
  stability: 'v0alpha1',
  profiles: [
    'base-v1',
    'turn-based-v1',
    'replay-v1',
    'generic-controls-v1',
    'policy-v1',
  ] satisfies ConformanceProfile[],
  protocolVectors: 7,
} as const

export type { GameManifest, Replay }
