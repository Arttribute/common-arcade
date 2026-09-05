import { handle } from 'hono/aws-lambda'
import { createApp } from './app.js'

export const handler = handle(
  createApp({
    publicBaseUrl: process.env.ARCADE_PUBLIC_BASE_URL,
    realtimeUrl:
      process.env.ARCADE_REALTIME_CONTROL_URL?.replace('https:', 'wss:') +
      '/realtime',
  }),
)
