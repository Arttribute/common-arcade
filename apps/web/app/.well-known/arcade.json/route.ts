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
      identity: {
        issuer: 'https://auth.agentcommons.io/api/auth',
        jwks: 'https://auth.agentcommons.io/api/auth/.well-known/jwks.json',
      },
      auth: ['oauth2', 'bearer', 'ticket'],
      transports: ['websocket'],
      documentation: `${origin}/docs/creator-quickstart`,
      stability: 'creator-alpha',
      normative: false,
    },
    { headers: { 'Cache-Control': 'public, max-age=300' } },
  )
}
