import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { requestId } from 'hono/request-id'

const startedAt = new Date().toISOString()

function corsOrigins() {
  return new Set(
    (
      process.env.ARCADE_CORS_ORIGINS ??
      'http://localhost:3000,https://arcade.agentcommons.io'
    )
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  )
}

export function createApp() {
  const app = new Hono()

  app.use('*', requestId())
  app.use('*', logger())
  app.use(
    '/v1/*',
    cors({
      origin: (origin) => (corsOrigins().has(origin) ? origin : null),
      allowHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'],
      exposeHeaders: ['X-Request-Id'],
      credentials: true,
    }),
  )

  app.get('/healthz', (context) =>
    context.json({
      status: 'ok',
      service: 'common-arcade-control-api',
      startedAt,
    }),
  )

  app.get('/v1/status', (context) =>
    context.json({
      name: 'Common Arcade',
      phase: 'bootstrap',
      protocol: {
        namespace: 'io.agentcommons.arcade/v0alpha1',
        normative: false,
      },
      capabilities: [],
      message:
        'Control-plane shell only. No game or match capabilities are advertised yet.',
    }),
  )

  app.get('/openapi.json', (context) =>
    context.json({
      openapi: '3.1.0',
      info: {
        title: 'Common Arcade Control API',
        version: '0.0.0',
        description:
          'Bootstrap health and status contract. Gameplay endpoints are intentionally absent.',
      },
      paths: {
        '/healthz': {
          get: { responses: { '200': { description: 'Service is healthy' } } },
        },
        '/v1/status': {
          get: {
            responses: {
              '200': { description: 'Bootstrap capability status' },
            },
          },
        },
      },
    }),
  )

  app.notFound((context) =>
    context.json(
      {
        error: {
          code: 'route_not_found',
          message: 'No Common Arcade control-plane route matches this request.',
          requestId: context.get('requestId'),
        },
      },
      404,
    ),
  )

  app.onError((error, context) => {
    console.error(error)
    return context.json(
      {
        error: {
          code: 'internal_error',
          message: 'The control plane could not complete the request.',
          requestId: context.get('requestId'),
        },
      },
      500,
    )
  })

  return app
}

export type ControlApi = ReturnType<typeof createApp>
