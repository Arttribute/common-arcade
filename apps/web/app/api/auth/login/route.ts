import { NextRequest, NextResponse } from 'next/server'
import { cookieOptions, issuer, seal } from '../../../../lib/session'
export async function GET(request: NextRequest) {
  if (!process.env.COMMONS_IDENTITY_CLIENT_ID)
    return NextResponse.json(
      { error: 'Commons sign-in is not configured.' },
      { status: 503 },
    )
  const state = crypto.randomUUID(),
    verifier = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
      'base64url',
    )
  const challenge = Buffer.from(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)),
  ).toString('base64url')
  const origin = new URL(process.env.ARCADE_WEB_URL ?? request.url).origin
  // Begin the flow on its callback hostname so the PKCE cookie survives aliases.
  if (request.nextUrl.origin !== origin)
    return NextResponse.redirect(
      new URL(request.nextUrl.pathname + request.nextUrl.search, origin),
    )
  const requested = request.nextUrl.searchParams.get('next') ?? '/studio'
  const next =
    requested.startsWith('/') &&
    !requested.startsWith('//') &&
    !requested.includes('\\')
      ? requested
      : '/studio'
  const redirect = `${origin}/api/auth/callback`
  const url = new URL(`${issuer()}/oauth2/authorize`)
  url.search = new URLSearchParams({
    client_id: process.env.COMMONS_IDENTITY_CLIENT_ID,
    redirect_uri: redirect,
    response_type: 'code',
    scope:
      'openid profile email offline_access agents:create agents:read agents:write agents:run',
    resource: 'commons-platform',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString()
  const response = NextResponse.redirect(url)
  response.cookies.set(
    'arcade-oauth-state',
    await seal({ state, verifier, redirect, next }, '10m'),
    { ...cookieOptions, maxAge: 600 },
  )
  return response
}
