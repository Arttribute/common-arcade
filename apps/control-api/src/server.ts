import { serve } from '@hono/node-server'
import { LocalArcadePlatform } from '@common-arcade/match-worker-service'
import { createApp } from './app.js'

const rawPort = process.env.ARCADE_CONTROL_API_PORT ?? '4100'
const port = Number.parseInt(rawPort, 10)

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error(`Invalid ARCADE_CONTROL_API_PORT: ${rawPort}`)
}

const platform = await LocalArcadePlatform.create()

serve({ fetch: createApp({ platform }).fetch, port }, (info) => {
  console.log(
    `Common Arcade control API listening on http://localhost:${info.port}`,
  )
})
