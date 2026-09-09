import { Hono } from 'hono'
import { z } from 'zod'
import { MatchHost } from './matches.js'
const authSchema = z.object({
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  expiresAt: z.number().int(),
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
})
const actionSchema = z
  .object({
    actionId: z.string().uuid(),
    sequence: z.number().int().nonnegative(),
    type: z.enum(['hit', 'stand']).optional(),
    payload: z.json().optional(),
  })
  .strict()
  .refine(
    (body) => (body.type !== undefined) !== (body.payload !== undefined),
    'Provide exactly one action payload',
  )
export function createTableApi(host: MatchHost) {
  const app = new Hono()
  app.get('/v1/economy/config', (c) =>
    c.json({
      networks: host.configuredNetworks(),
      defaultMode: 'free',
      testnetOnly: true,
    }),
  )
  app.onError((error, c) => c.json({ error: error.message }, 400))
  app.post('/v1/economy/matches', async (c) => {
    const { body, auth } = await c.req.json()
    return c.json(
      await host.create(
        body,
        authSchema.parse(auth) as Parameters<typeof host.create>[1],
      ),
      201,
    )
  })
  app.get('/v1/economy/matches/:id', async (c) =>
    c.json(await host.view(c.req.param('id'))),
  )
  app.post('/v1/economy/matches/:id/observation', async (c) =>
    c.json(
      await host.observation(
        c.req.param('id'),
        authSchema.parse(await c.req.json()) as Parameters<
          typeof host.observation
        >[1],
      ),
    ),
  )
  app.post('/v1/economy/matches/:id/start', async (c) =>
    c.json(
      await host.start(
        c.req.param('id'),
        authSchema.parse(await c.req.json()) as Parameters<
          typeof host.start
        >[1],
      ),
    ),
  )
  app.post('/v1/economy/matches/:id/actions', async (c) => {
    const { body, auth } = await c.req.json()
    return c.json(
      await host.action(
        c.req.param('id'),
        actionSchema.parse(body),
        authSchema.parse(auth) as Parameters<typeof host.action>[2],
      ),
    )
  })
  app.post('/v1/economy/matches/:id/settle', async (c) =>
    c.json(await host.settle(c.req.param('id'))),
  )
  return app
}
