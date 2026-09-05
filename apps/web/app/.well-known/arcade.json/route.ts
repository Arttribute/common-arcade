import { NextResponse } from 'next/server'

export async function GET() {
  const origin = process.env.ARCADE_WEB_URL ?? 'https://arcade.agentcommons.io'
  return NextResponse.json(
    {
      protocol: 'io.agentcommons.arcade/v0alpha1',
      issuer: origin,
      catalog: `${origin}/api/arcade/v1/games`,
      openapi: `${origin}/api/arcade/openapi.json`,
      asyncapi: `${origin}/api/arcade/asyncapi.json`,
      keys: `${origin}/api/arcade/.well-known/jwks.json`,
      profiles: [
        'base-v1',
        'turn-based-v1',
        'replay-v1',
        'generic-controls-v1',
      ],
      auth: ['oauth2', 'ticket'],
      regions: ['eu-west-1'],
      transports: ['websocket'],
    },
    { headers: { 'Cache-Control': 'public, max-age=300' } },
  )
}
