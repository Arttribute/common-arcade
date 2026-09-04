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
