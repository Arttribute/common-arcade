import { NextRequest, NextResponse } from 'next/server'
import {
  cookieOptions,
  issuer,
  seal,
  sessionCookie,
} from '../../../../lib/session'
export async function GET(request: NextRequest) {
  const requestedNext = request.nextUrl.searchParams.get('next') ?? '/studio'
  const next =
    requestedNext.startsWith('/') &&
    !requestedNext.startsWith('//') &&
    !requestedNext.includes('\\')
      ? requestedNext
      : '/studio'
  if (!process.env.COMMONS_IDENTITY_CLIENT_ID) {
    // Local dev shortcut: without an OAuth client id/secret configured, fall
    // back to a scoped Arcade access key (an "arc_..." token from the
    // Agents page's "Create access key" flow) instead of Commons OAuth.
    // These keys are verified by the Arcade API itself, not Commons identity —
    // see apps/control-api/src/identity.ts's `arc_` branch — so /v1/me is the
    // right check here, not Commons' /oauth2/userinfo. Set
    // ARCADE_DEV_ACCESS_TOKEN locally to use it.
    const devToken = process.env.ARCADE_DEV_ACCESS_TOKEN
    if (!devToken)
      return NextResponse.json(
        { error: 'Commons sign-in is not configured.' },
        { status: 503 },
      )
    try {
      const api = process.env.ARCADE_API_URL ?? 'http://localhost:4100'
      const me = await fetch(`${api}/v1/me`, {
        headers: { Authorization: `Bearer ${devToken}` },
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
      })
      if (!me.ok) throw new Error('Unable to verify Arcade access key')
      const principal = (await me.json()) as { id: string }
      if (!principal.id) throw new Error('Missing account')
      const response = NextResponse.redirect(new URL(next, request.url))
      response.cookies.set(
        sessionCookie,
        await seal({
          accessToken: devToken,
          expiresAt: Date.now() + 7 * 86400_000,
          id: principal.id,
          name: 'Commons creator',
        }),
        { ...cookieOptions, maxAge: 7 * 86400 },
      )
      return response
    } catch {
      return NextResponse.json(
        {
          error:
            'ARCADE_DEV_ACCESS_TOKEN is set but could not be verified. Get a fresh access key and try again.',
        },
        { status: 502 },
      )
    }
  }
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
