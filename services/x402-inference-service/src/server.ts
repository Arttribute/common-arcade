import { serve } from '@hono/node-server'
import { createApp } from './app.js'

const rawPort = process.env.X402_INFERENCE_SERVICE_PORT ?? '4300'
const port = Number.parseInt(rawPort, 10)

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error(`Invalid X402_INFERENCE_SERVICE_PORT: ${rawPort}`)
}

serve({ fetch: createApp().fetch, port }, (info) => {
  console.log(
    `x402 coaching service listening on http://localhost:${info.port} (pay via /v1/coach)`,
  )
})
