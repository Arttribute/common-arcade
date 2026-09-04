import { z } from 'zod'
import { ARCADE_API_VERSION, ARCADE_WIRE_VERSION } from './constants.js'

export type JsonPrimitive = boolean | number | string | null
export type JsonValue =
  JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
)

const opaqueId = (prefix: string) =>
  z
    .string()
    .regex(
      new RegExp(`^${prefix}_[A-Za-z0-9][A-Za-z0-9_-]{7,127}$`),
      `must be an opaque ${prefix}_ identifier`,
    )

export const gameIdSchema = opaqueId('gam')
export const releaseIdSchema = opaqueId('rel')
export const matchIdSchema = opaqueId('mat')
export const seatIdSchema = opaqueId('sea')
export const sessionIdSchema = opaqueId('ses')
export const actionIdSchema = opaqueId('act')
export const eventIdSchema = opaqueId('evt')
export const replayIdSchema = opaqueId('rpl')
export const policyIdSchema = opaqueId('pol')
export const testRunIdSchema = opaqueId('tst')

export const digestSchema = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/, 'must be a lowercase SHA-256 digest')

export const semverSchema = z
  .string()
  .regex(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/,
    'must be a semantic version',
  )

export const matchModeSchema = z.enum([
  'turn-based',
  'simultaneous',
  'realtime',
  'hybrid',
])

export const matchStatusSchema = z.enum([
  'created',
  'lobby',
  'ready',
  'checking',
  'starting',
  'running',
  'paused',
  'finishing',
  'completed',
  'canceled',
  'expired',
  'failed',
  'invalidated',
])

export const compatibilityProfileSchema = z.enum([
  'base-v1',
  'turn-based-v1',
  'simultaneous-v1',
  'realtime-authoritative-v1',
  'hidden-information-v1',
  'replay-v1',
  'generic-controls-v1',
  'policy-v1',
  'adaptive-policy-v1',
  'team-coordination-v1',
  'diagnostics-v1',
  'semantic-presentation-v1',
  'competitive-v1',
  'external-host-v1',
])

const schemaReference = z.object({
  uri: z.string().min(1),
  digest: digestSchema.optional(),
})

const seatRoleSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,62}$/),
  title: z.string().min(1).max(80),
  count: z.number().int().positive(),
  team: z.string().min(1).max(64).optional(),
})

const extensionSchema = z.object({
  id: z.string().url(),
  required: z.boolean(),
  config: jsonValueSchema.optional(),
})

export const gameManifestSchema = z
  .object({
    apiVersion: z.literal(ARCADE_API_VERSION),
    kind: z.literal('Game'),
    metadata: z.object({
      id: gameIdSchema,
      namespace: z.string().regex(/^[a-z0-9]+(?:\.[a-z0-9-]+)+$/),
      slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      version: semverSchema,
      digest: digestSchema,
      title: z.string().min(1).max(120),
      summary: z.string().min(1).max(500),
      publisher: z.object({
        id: z.string().min(1).max(200),
        name: z.string().min(1).max(120),
      }),
      tags: z.array(z.string().min(1).max(40)).max(20).default([]),
    }),
    spec: z
      .object({
        mode: matchModeSchema,
        profiles: z.array(compatibilityProfileSchema).min(1),
        extensions: z.array(extensionSchema).default([]),
        seats: z
          .object({
            min: z.number().int().positive(),
            max: z.number().int().positive(),
            roles: z.array(seatRoleSchema).min(1),
            spectators: z.boolean().default(true),
            lateJoin: z.boolean().default(false),
          })
          .refine((value) => value.max >= value.min, {
            message:
              'maximum seats must be greater than or equal to minimum seats',
            path: ['max'],
          }),
        clock: z.object({
          simulationHz: z.number().int().min(1).max(240).optional(),
          networkHz: z.number().int().min(1).max(120).optional(),
          turnTimeoutMs: z.number().int().positive().optional(),
          maxDurationSeconds: z.number().int().positive().max(86_400),
        }),
        schemas: z.object({
          config: schemaReference,
          publicState: schemaReference,
          observation: schemaReference,
          action: schemaReference,
          event: schemaReference,
          result: schemaReference,
        }),
        runtime: z.discriminatedUnion('type', [
          z.object({
            type: z.literal('declarative'),
            module: z.string().min(1),
            digest: digestSchema,
          }),
          z.object({
            type: z.literal('wasm-component'),
            artifact: digestSchema,
            memoryMiB: z.number().int().positive().max(1024),
            fuelPerTick: z.number().int().positive(),
          }),
          z.object({
            type: z.literal('trusted-container'),
            image: z.string().min(1),
            digest: digestSchema,
          }),
        ]),
        presentation: z.object({
          generic: z.boolean(),
          bridge: z.literal('semantic-v1'),
          webArtifact: digestSchema.optional(),
        }),
        policy: z.object({
          tiers: z.array(z.enum(['declarative', 'wasm'])).min(1),
          maxDecisionsPerSecond: z.number().int().positive().max(120),
          memoryKiB: z.number().int().nonnegative().max(1_048_576),
        }),
      })
      .superRefine((spec, context) => {
        const roleCount = spec.seats.roles.reduce(
          (total, role) => total + role.count,
          0,
        )
        if (roleCount < spec.seats.min || roleCount > spec.seats.max) {
          context.addIssue({
            code: 'custom',
            message: 'role counts must fit within the declared seat range',
            path: ['seats', 'roles'],
          })
        }
        if (spec.mode === 'realtime' && spec.clock.simulationHz === undefined) {
          context.addIssue({
            code: 'custom',
            message: 'realtime games must declare simulationHz',
            path: ['clock', 'simulationHz'],
          })
        }
      }),
  })
  .strict()

export const discoveryDocumentSchema = z
  .object({
    protocol: z.literal(ARCADE_API_VERSION),
    issuer: z.string().url(),
    catalog: z.string().url(),
    openapi: z.string().url(),
    asyncapi: z.string().url(),
    keys: z.string().url(),
    profiles: z.array(compatibilityProfileSchema),
    transports: z.array(z.enum(['websocket', 'webtransport'])),
    auth: z.array(z.enum(['oauth2', 'ticket'])),
    regions: z.array(z.string().min(1)),
    mcp: z.string().url().optional(),
    a2a: z.string().url().optional(),
  })
  .strict()

export const matchDescriptorSchema = z
  .object({
    id: matchIdSchema,
    releaseId: releaseIdSchema,
    releaseDigest: digestSchema,
    mode: matchModeSchema,
    status: matchStatusSchema,
    ownershipEpoch: z.number().int().positive(),
    stateSequence: z.number().int().nonnegative(),
    eventSequence: z.number().int().nonnegative(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    seats: z.array(
      z.object({
        id: seatIdSchema,
        role: z.string().min(1),
        team: z.string().min(1).optional(),
        status: z.enum(['open', 'claimed', 'connected', 'disconnected']),
        actorId: z.string().min(1).optional(),
      }),
    ),
    result: jsonValueSchema.optional(),
  })
  .strict()

export const observationSchema = z
  .object({
    matchId: matchIdSchema,
    seatId: seatIdSchema,
    stateSequence: z.number().int().nonnegative(),
    eventSequence: z.number().int().nonnegative(),
    schemaVersion: z.string().min(1),
    tick: z.number().int().nonnegative().optional(),
    turn: z.number().int().nonnegative().optional(),
    visibleState: jsonValueSchema,
    legalActions: z.array(jsonValueSchema),
    deadlineAt: z.string().datetime().optional(),
    feedback: jsonValueSchema.optional(),
    events: z.array(jsonValueSchema).default([]),
    stateHash: digestSchema,
  })
  .strict()

export const actionSubmissionSchema = z
  .object({
    actionId: actionIdSchema,
    matchId: matchIdSchema,
    seatId: seatIdSchema,
    controlLease: z.string().min(16).max(4096),
    clientSequence: z.number().int().positive(),
    basedOnStateSequence: z.number().int().nonnegative(),
    targetTick: z.number().int().nonnegative().optional(),
    targetTurn: z.number().int().nonnegative().optional(),
    payload: jsonValueSchema,
    policyExecutionId: z.string().min(1).max(200).optional(),
    trace: z.string().min(1).max(200).optional(),
  })
  .strict()

export const actionDispositionSchema = z.enum([
  'accepted',
  'rejected',
  'deferred',
  'superseded',
  'duplicate',
])

export const actionErrorCodeSchema = z.enum([
  'NOT_LEGAL',
  'STALE_OBSERVATION',
  'TOO_LATE',
  'RATE_LIMITED',
  'CONTROL_REVOKED',
  'INVALID_SCHEMA',
  'COOLDOWN',
  'MATCH_NOT_RUNNING',
])

export const actionResultSchema = z
  .object({
    actionId: actionIdSchema,
    disposition: actionDispositionSchema,
    code: actionErrorCodeSchema.optional(),
    acceptedForTick: z.number().int().nonnegative().optional(),
    acceptedForTurn: z.number().int().nonnegative().optional(),
    stateSequence: z.number().int().nonnegative(),
    eventSequence: z.number().int().nonnegative(),
    detail: z.string().max(500).optional(),
  })
  .strict()

export const matchEventSchema = z
  .object({
    id: eventIdSchema,
    matchId: matchIdSchema,
    sequence: z.number().int().positive(),
    tick: z.number().int().nonnegative().optional(),
    turn: z.number().int().nonnegative().optional(),
    type: z.string().regex(/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/),
    visibility: z.enum(['public', 'team', 'seat', 'referee']),
    audienceId: z.string().min(1).optional(),
    at: z.string().datetime(),
    payload: jsonValueSchema,
  })
  .strict()

export const replayCheckpointSchema = z
  .object({
    stateSequence: z.number().int().nonnegative(),
    eventSequence: z.number().int().nonnegative(),
    state: jsonValueSchema,
    stateHash: digestSchema,
  })
  .strict()

export const replaySchema = z
  .object({
    id: replayIdSchema,
    matchId: matchIdSchema,
    releaseId: releaseIdSchema,
    releaseDigest: digestSchema,
    runtimeVersion: z.string().min(1),
    seed: z.string().min(1),
    profile: z.literal('replay-v1'),
    commands: z.array(
      z.object({
        sequence: z.number().int().positive(),
        action: actionSubmissionSchema.omit({ controlLease: true }),
        result: actionResultSchema,
      }),
    ),
    events: z.array(matchEventSchema),
    checkpoints: z.array(replayCheckpointSchema).min(1),
    finalStateHash: digestSchema,
    createdAt: z.string().datetime(),
  })
  .strict()

export const problemDetailsSchema = z
  .object({
    type: z.string().url(),
    title: z.string().min(1),
    status: z.number().int().min(400).max(599),
    detail: z.string().min(1),
    code: z.string().regex(/^[A-Z][A-Z0-9_]+$/),
    requestId: z.string().min(1),
    traceId: z.string().min(1).optional(),
    retryable: z.boolean(),
    retryAfterSeconds: z.number().int().positive().optional(),
    violations: z
      .array(
        z.object({
          field: z.string().min(1),
          code: z.string().min(1),
          message: z.string().min(1),
        }),
      )
      .optional(),
    resourceVersion: z.string().min(1).optional(),
  })
  .strict()

export const realtimeMessageTypeSchema = z.enum([
  'hello',
  'resume',
  'action.submit',
  'ack',
  'ping',
  'pong',
  'flow.preference',
  'session.close',
  'welcome',
  'snapshot',
  'observation.full',
  'observation.delta',
  'action.result',
  'event.batch',
  'clock.sync',
  'control.granted',
  'control.revoked',
  'match.transition',
  'flow.notice',
  'resync.required',
  'error',
  'goodbye',
])

export const realtimeEnvelopeSchema = z
  .object({
    v: z.literal(ARCADE_WIRE_VERSION),
    type: realtimeMessageTypeSchema,
    session: sessionIdSchema.optional(),
    match: matchIdSchema.optional(),
    seq: z.number().int().nonnegative(),
    tick: z.number().int().nonnegative().optional(),
    sentAt: z.string().datetime(),
    trace: z.string().min(1).max(200).optional(),
    payload: jsonValueSchema,
  })
  .strict()

export type GameManifest = z.infer<typeof gameManifestSchema>
export type DiscoveryDocument = z.infer<typeof discoveryDocumentSchema>
export type MatchDescriptor = z.infer<typeof matchDescriptorSchema>
export type MatchMode = z.infer<typeof matchModeSchema>
export type MatchStatus = z.infer<typeof matchStatusSchema>
export type Observation = z.infer<typeof observationSchema>
export type ActionSubmission = z.infer<typeof actionSubmissionSchema>
export type ActionResult = z.infer<typeof actionResultSchema>
export type ActionDisposition = z.infer<typeof actionDispositionSchema>
export type ActionErrorCode = z.infer<typeof actionErrorCodeSchema>
export type MatchEvent = z.infer<typeof matchEventSchema>
export type Replay = z.infer<typeof replaySchema>
export type ReplayCheckpoint = z.infer<typeof replayCheckpointSchema>
export type ProblemDetails = z.infer<typeof problemDetailsSchema>
export type RealtimeMessageType = z.infer<typeof realtimeMessageTypeSchema>
export type RealtimeEnvelope = z.infer<typeof realtimeEnvelopeSchema>
