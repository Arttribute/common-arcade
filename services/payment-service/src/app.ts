import { createTableApi } from './table-api.js'
import type { MatchHost } from './matches.js'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { cors } from 'hono/cors'
import { createPaidAnalysisApi, type PaidServiceRail } from './x402.js'
import { trustedOrigin } from './origin-auth.js'
export async function createApp(
  rails: PaidServiceRail[] = [],
  host?: MatchHost,
  originToken = process.env.ARCADE_ORIGIN_TOKEN,
) {
  const app = new Hono()
  app.use('*', async (c, next) => {
    if (
      c.req.path !== '/healthz' &&
      !trustedOrigin(originToken, c.req.header('X-Arcade-Origin'))
    )
      return c.json({ error: 'Use the public payment endpoint' }, 403)
    await next()
  })
  app.use('*', bodyLimit({ maxSize: 32 * 1024 }))
  app.use(
    '*',
    cors({
      origin: (
        process.env.ARCADE_PAYMENT_ORIGINS ?? 'http://localhost:3000'
      ).split(','),
      allowHeaders: ['Content-Type', 'PAYMENT-SIGNATURE'],
      exposeHeaders: ['PAYMENT-REQUIRED', 'PAYMENT-RESPONSE'],
    }),
  )
  app.get('/healthz', (c) => c.json({ ok: true, testnetOnly: true }))
  app.route('/', await createPaidAnalysisApi(rails))
  if (host) app.route('/', createTableApi(host))
  return app
}
