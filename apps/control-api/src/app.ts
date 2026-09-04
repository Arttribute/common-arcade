import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { requestId } from 'hono/request-id'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { z, ZodError } from 'zod'
import {
  LocalArcadePlatform,
  LocalPlatformError,
} from '@common-arcade/match-worker-service'
import {
  ARCADE_API_VERSION,
  type ProblemDetails,
} from '@common-arcade/protocol'
import {
  createPreferencePolicy,
  TicTacToeTestRun,
} from '@common-arcade/test-arena'
import type { DiagnosticDomain } from '@common-arcade/diagnostics'

const startedAt = new Date().toISOString()

export interface ControlApiOptions {
  readonly platform?: LocalArcadePlatform
  readonly publicBaseUrl?: string
  readonly realtimeUrl?: string
  readonly logRequests?: boolean
}

class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: ContentfulStatusCode,
    readonly retryable: boolean,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

const createMatchBody = z
  .object({
    releaseId: z.string().min(1),
    configuration: z.json().optional(),
    seed: z.string().min(1).max(200).optional(),
  })
  .strict()

const claimSeatBody = z
  .object({ controllerId: z.string().min(1).max(200) })
  .strict()

const createSessionBody = z
  .object({
    mode: z.enum(['control', 'spectate']),
    seatId: z.string().min(1).optional(),
    controllerId: z.string().min(1).max(200).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.mode === 'control' &&
      (value.seatId === undefined || value.controllerId === undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Control sessions require seatId and controllerId',
      })
    }
  })

const createTestRunBody = z
  .object({
    seed: z.string().min(1).max(200).default('test-arena-seed'),
    firstPreference: z
      .array(z.number().int().min(0).max(8))
      .min(1)
      .default([4, 0, 2, 6, 8, 1, 3, 5, 7]),
    secondPreference: z
      .array(z.number().int().min(0).max(8))
      .min(1)
      .default([0, 2, 6, 8, 4, 1, 3, 5, 7]),
    execution: z.enum(['step', 'complete']).default('complete'),
  })
  .strict()

const diagnosticQuery = z
  .object({
    category: z
      .enum([
        'build',
        'runtime',
        'transport',
        'policy',
        'adaptation',
        'coordination',
        'security',
        'test',
      ])
      .optional(),
    seatId: z.string().optional(),
    level: z.enum(['debug', 'info', 'warn', 'error']).optional(),
    type: z.string().optional(),
    afterSequence: z.coerce.number().int().nonnegative().optional(),
  })
  .strict()

function corsOrigins() {
  return new Set(
    (
      process.env.ARCADE_CORS_ORIGINS ??
      'http://localhost:3000,http://localhost:4100,https://arcade.agentcommons.io'
    )
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  )
}

function localActorId(authorization: string | undefined): string {
  const match = /^Bearer local:([A-Za-z0-9_-]{3,120})$/.exec(
    authorization ?? '',
  )
  if (match?.[1] === undefined) {
    throw new ApiError(
      'AUTHENTICATION_REQUIRED',
      401,
      false,
      'Local development requires Authorization: Bearer local:<actor-id>',
    )
  }
  return match[1]
}

function problem(
  error: unknown,
  requestIdValue: string,
): { body: ProblemDetails; status: ContentfulStatusCode } {
  if (error instanceof ZodError) {
    return {
      status: 422,
      body: {
        type: 'https://arcade.agentcommons.io/problems/invalid-request',
        title: 'Request validation failed',
        status: 422,
        detail: 'One or more request fields are invalid.',
        code: 'INVALID_REQUEST',
        requestId: requestIdValue,
        retryable: false,
        violations: error.issues.map((issue) => ({
          field: issue.path.join('.') || 'body',
          code: issue.code,
          message: issue.message,
        })),
      },
    }
  }
  if (error instanceof LocalPlatformError || error instanceof ApiError) {
    return {
      status: error.status as ContentfulStatusCode,
      body: {
        type: `https://arcade.agentcommons.io/problems/${error.code.toLowerCase().replaceAll('_', '-')}`,
        title: error.code
          .toLowerCase()
          .split('_')
          .map((word) => word[0]?.toUpperCase() + word.slice(1))
          .join(' '),
        status: error.status,
        detail: error.message,
        code: error.code,
        requestId: requestIdValue,
        retryable: error instanceof ApiError ? error.retryable : false,
      },
    }
  }
  console.error(error)
  return {
    status: 500,
    body: {
      type: 'https://arcade.agentcommons.io/problems/internal-error',
      title: 'Internal Error',
      status: 500,
      detail: 'The control plane could not complete the request.',
      code: 'INTERNAL_ERROR',
      requestId: requestIdValue,
      retryable: false,
    },
  }
}

export function createApp(options: ControlApiOptions = {}) {
  const app = new Hono()
  const publicBaseUrl = options.publicBaseUrl ?? 'http://localhost:4100'
  const realtimeUrl = options.realtimeUrl ?? 'ws://localhost:4100/realtime'
  const testRuns = new Map<
    string,
    { readonly ownerId: string; readonly run: TicTacToeTestRun }
  >()
  const testRunIdempotency = new Map<string, string>()
  const requirePlatform = () => {
    if (options.platform === undefined) {
      throw new ApiError(
        'SERVICE_UNAVAILABLE',
        503,
        true,
        'This deployment has no configured durable match service.',
      )
    }
    return options.platform
  }

  app.use('*', requestId())
  if (options.logRequests !== false) app.use('*', logger())
  app.use(
    '/v1/*',
    cors({
      origin: (origin) => (corsOrigins().has(origin) ? origin : null),
      allowHeaders: [
        'Authorization',
        'Content-Type',
        'Idempotency-Key',
        'If-Match',
      ],
      exposeHeaders: ['X-Request-Id', 'ETag'],
      credentials: true,
    }),
  )

  app.get('/healthz', (context) =>
    context.json({
      status: 'ok',
      service: 'common-arcade-control-api',
      startedAt,
      matchService: options.platform === undefined ? 'unconfigured' : 'local',
    }),
  )

  app.get('/v1/status', (context) =>
    context.json({
      name: 'Common Arcade',
      phase: 'local-vertical-slice',
      protocol: {
        namespace: ARCADE_API_VERSION,
        normative: false,
      },
      capabilities:
        options.platform === undefined
          ? []
          : [
              'games:read',
              'matches:create',
              'seats:claim',
              'sessions:create',
              'replays:read',
              'test-runs:create',
              'diagnostics:read',
            ],
    }),
  )

  app.get('/.well-known/arcade.json', (context) =>
    context.json({
      protocol: ARCADE_API_VERSION,
      issuer: publicBaseUrl,
      catalog: `${publicBaseUrl}/v1/games`,
      openapi: `${publicBaseUrl}/openapi.json`,
      asyncapi: `${publicBaseUrl}/asyncapi.json`,
      keys: `${publicBaseUrl}/.well-known/jwks.json`,
      profiles: [
        'base-v1',
        'turn-based-v1',
        'replay-v1',
        'generic-controls-v1',
      ],
      transports: ['websocket'],
      auth: ['ticket'],
      regions: ['local'],
      mcp: `${publicBaseUrl}/mcp`,
    }),
  )

  app.get('/.well-known/jwks.json', (context) =>
    context.json({
      keys: [],
      localOnly: true,
      message: 'Local HMAC ticket keys are never published.',
    }),
  )

  app.get('/v1/games', async (context) =>
    context.json({
      games: await requirePlatform().listGames(),
      nextCursor: null,
    }),
  )

  app.get('/v1/games/:gameId', async (context) =>
    context.json(await requirePlatform().getGame(context.req.param('gameId'))),
  )

  app.post('/v1/matches', async (context) => {
    localActorId(context.req.header('Authorization'))
    const idempotencyKey = context.req.header('Idempotency-Key')
    if (idempotencyKey === undefined) {
      throw new ApiError(
        'IDEMPOTENCY_KEY_REQUIRED',
        428,
        false,
        'Idempotency-Key is required for match creation.',
      )
    }
    const body = createMatchBody.parse(await context.req.json())
    const match = await requirePlatform().createMatch({
      ...body,
      idempotencyKey,
    })
    return context.json(match, 201)
  })

  app.get('/v1/matches/:matchId', async (context) =>
    context.json(
      await requirePlatform().getMatch(context.req.param('matchId')),
    ),
  )

  app.get('/v1/matches/:matchId/state', async (context) =>
    context.json(
      await requirePlatform().getMatchView(
        context.req.param('matchId'),
        Number.parseInt(context.req.query('afterEventSequence') ?? '0', 10),
      ),
    ),
  )

  app.post('/v1/matches/:matchId/seats/:seatId/claim', async (context) => {
    const actorId = localActorId(context.req.header('Authorization'))
    const body = claimSeatBody.parse(await context.req.json())
    return context.json(
      await requirePlatform().claimSeat({
        matchId: context.req.param('matchId'),
        seatId: context.req.param('seatId'),
        actorId,
        controllerId: body.controllerId,
      }),
    )
  })

  app.post('/v1/matches/:matchId/sessions', async (context) => {
    const actorId = localActorId(context.req.header('Authorization'))
    const body = createSessionBody.parse(await context.req.json())
    return context.json(
      {
        ...(await requirePlatform().createSession({
          matchId: context.req.param('matchId'),
          actorId,
          ...body,
        })),
        realtimeUrl,
      },
      201,
    )
  })

  app.get('/v1/matches/:matchId/replay', (context) =>
    context.json(requirePlatform().getReplay(context.req.param('matchId'))),
  )

  app.post('/v1/test-runs', async (context) => {
    requirePlatform()
    const ownerId = localActorId(context.req.header('Authorization'))
    const idempotencyKey = context.req.header('Idempotency-Key')
    if (idempotencyKey === undefined) {
      throw new ApiError(
        'IDEMPOTENCY_KEY_REQUIRED',
        428,
        false,
        'Idempotency-Key is required for test-run creation.',
      )
    }
    const existingId = testRunIdempotency.get(idempotencyKey)
    if (existingId !== undefined) {
      const existing = testRuns.get(existingId)
      if (existing !== undefined)
        return context.json(await existing.run.result())
    }
    const body = createTestRunBody.parse(await context.req.json())
    const suffix = crypto.randomUUID().replaceAll('-', '')
    const [firstPolicy, secondPolicy] = await Promise.all([
      createPreferencePolicy({
        id: `pol_${suffix}_1`,
        name: 'test-player-one',
        preferredCells: body.firstPreference,
      }),
      createPreferencePolicy({
        id: `pol_${suffix}_2`,
        name: 'test-player-two',
        preferredCells: body.secondPreference,
      }),
    ])
    const run = await TicTacToeTestRun.create({
      seed: body.seed,
      controllers: [
        { seatId: `sea_${suffix}_1`, policy: firstPolicy },
        { seatId: `sea_${suffix}_2`, policy: secondPolicy },
      ],
    })
    testRuns.set(run.runId, { ownerId, run })
    testRunIdempotency.set(idempotencyKey, run.runId)
    if (body.execution === 'complete') await run.runToCompletion()
    return context.json(await run.result(), 201)
  })

  const ownedTestRun = (runId: string, ownerId: string) => {
    const record = testRuns.get(runId)
    if (record === undefined)
      throw new ApiError('NOT_FOUND', 404, false, `Unknown test run ${runId}`)
    if (record.ownerId !== ownerId)
      throw new ApiError(
        'AUTHORIZATION_DENIED',
        403,
        false,
        'Test-run diagnostics are visible only to the test owner.',
      )
    return record.run
  }

  app.get('/v1/test-runs/:runId', async (context) => {
    const ownerId = localActorId(context.req.header('Authorization'))
    return context.json(
      await ownedTestRun(context.req.param('runId'), ownerId).result(),
    )
  })

  app.post('/v1/test-runs/:runId/step', async (context) => {
    const ownerId = localActorId(context.req.header('Authorization'))
    const run = ownedTestRun(context.req.param('runId'), ownerId)
    const step = await run.step()
    return context.json({ step, run: await run.result() })
  })

  app.get('/v1/test-runs/:runId/diagnostics', (context) => {
    const ownerId = localActorId(context.req.header('Authorization'))
    const run = ownedTestRun(context.req.param('runId'), ownerId)
    const query = diagnosticQuery.parse(context.req.query())
    return context.json({
      records: run.timeline.query({
        ...query,
        category: query.category as DiagnosticDomain | undefined,
      }),
      nextCursor: null,
    })
  })

  app.get('/openapi.json', (context) =>
    context.json(openApiDocument(publicBaseUrl)),
  )
  app.get('/asyncapi.json', (context) =>
    context.json(asyncApiDocument(realtimeUrl)),
  )

  app.notFound((context) => {
    const response = problem(
      new ApiError(
        'ROUTE_NOT_FOUND',
        404,
        false,
        'No Common Arcade control-plane route matches this request.',
      ),
      context.get('requestId'),
    )
    return context.json(response.body, response.status)
  })

  app.onError((error, context) => {
    const response = problem(error, context.get('requestId'))
    return context.json(response.body, response.status)
  })

  return app
}

function openApiDocument(serverUrl: string) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Common Arcade Control API',
      version: '0.1.0-v0alpha1',
    },
    servers: [{ url: serverUrl }],
    paths: {
      '/v1/games': { get: { summary: 'Discover games' } },
      '/v1/games/{gameId}': { get: { summary: 'Inspect a game manifest' } },
      '/v1/matches': { post: { summary: 'Create an idempotent match' } },
      '/v1/matches/{matchId}': { get: { summary: 'Inspect a match' } },
      '/v1/matches/{matchId}/seats/{seatId}/claim': {
        post: { summary: 'Claim a seat for the authenticated actor' },
      },
      '/v1/matches/{matchId}/sessions': {
        post: { summary: 'Mint a one-time realtime session ticket' },
      },
      '/v1/matches/{matchId}/replay': {
        get: { summary: 'Retrieve the authoritative replay' },
      },
      '/v1/test-runs': {
        post: { summary: 'Run autonomous policies in a private Test Arena' },
      },
      '/v1/test-runs/{runId}': {
        get: { summary: 'Inspect a Test Arena run and replay' },
      },
      '/v1/test-runs/{runId}/diagnostics': {
        get: { summary: 'Query structured test diagnostics' },
      },
    },
  }
}

function asyncApiDocument(realtimeUrl: string) {
  return {
    asyncapi: '3.0.0',
    info: {
      title: 'Common Arcade Realtime Session API',
      version: '0.1.0-v0alpha1',
    },
    servers: {
      local: { host: realtimeUrl, protocol: 'ws' },
    },
    channels: {
      matchSession: {
        address: '/realtime?match={matchId}',
        messages: {
          envelope: {
            $ref: './schemas/v0alpha1/realtime-envelope.schema.json',
          },
        },
      },
    },
  }
}

export type ControlApi = ReturnType<typeof createApp>
