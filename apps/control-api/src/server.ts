import { serve } from '@hono/node-server'
import { createApp } from './app.js'

const rawPort = process.env.ARCADE_CONTROL_API_PORT ?? '4100'
const port = Number.parseInt(rawPort, 10)

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error(`Invalid ARCADE_CONTROL_API_PORT: ${rawPort}`)
}

serve({ fetch: createApp().fetch, port }, (info) => {
  console.log(
    `Common Arcade control API listening on http://localhost:${info.port}`,
  )
})
