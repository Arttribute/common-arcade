import { NextRequest, NextResponse } from 'next/server'
import {
  cookieOptions,
  exchange,
  issuer,
  seal,
  sessionCookie,
  unseal,
} from '../../../../lib/session'
export async function GET(request: NextRequest) {
  try {
    const state = await unseal<{
      state: string
      verifier: string
      redirect: string
      next: string
    }>(request.cookies.get('arcade-oauth-state')?.value ?? '')
    if (
      state.state !== request.nextUrl.searchParams.get('state') ||
      !request.nextUrl.searchParams.get('code')
    )
      throw new Error('Invalid sign-in state')
    const token = await exchange(
      new URLSearchParams({
        grant_type: 'authorization_code',
        code: request.nextUrl.searchParams.get('code')!,
        code_verifier: state.verifier,
        redirect_uri: state.redirect,
      }),
    )
    const info = await fetch(`${issuer()}/oauth2/userinfo`, {
      headers: { Authorization: `Bearer ${token.access_token}` },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    })
    if (!info.ok) throw new Error('Unable to verify Commons account')
    const user = (await info.json()) as {
      sub: string
      name?: string
      email?: string
    }
    if (!user.sub) throw new Error('Missing account')
    const response = NextResponse.redirect(
      new URL(state.next, new URL(state.redirect).origin),
    )
    response.cookies.set(
      sessionCookie,
      await seal({
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt: Date.now() + token.expires_in * 1000,
        id: user.sub,
        name: user.name ?? 'Commons creator',
      }),
      { ...cookieOptions, maxAge: 7 * 86400 },
    )
    // Provision the account's shared Commons copilot; a transient failure is retried in Studio.
    if (process.env.ARCADE_API_URL)
      await fetch(`${process.env.ARCADE_API_URL}/v1/commons/copilot`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token.access_token}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
        signal: AbortSignal.timeout(10000),
      }).catch(() => undefined)
    response.cookies.delete('arcade-oauth-state')
    return response
  } catch {
    const response = NextResponse.redirect(
      new URL('/studio?authError=1', process.env.ARCADE_WEB_URL ?? request.url),
    )
    response.cookies.delete('arcade-oauth-state')
    return response
  }
}
