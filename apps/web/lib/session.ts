import { EncryptJWT, jwtDecrypt } from 'jose'
import { cookies } from 'next/headers'

export const sessionCookie = 'commons-arcade-session'
export const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
}
export const issuer = () =>
  (
    process.env.COMMONS_IDENTITY_ISSUER ??
    'https://auth.agentcommons.io/api/auth'
  ).replace(/\/$/, '')
export type ArcadeSession = {
  accessToken: string
  refreshToken?: string
  expiresAt: number
  id: string
  name: string
}
async function secret() {
  if (
    !process.env.ARCADE_SESSION_SECRET ||
    process.env.ARCADE_SESSION_SECRET.length < 32
  )
    throw new Error('Arcade sign-in is not configured.')
  return new Uint8Array(
    await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(process.env.ARCADE_SESSION_SECRET),
    ),
  )
}
export async function seal(data: Record<string, unknown>, ttl = '7d') {
  return new EncryptJWT(data)
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuedAt()
    .setExpirationTime(ttl)
    .encrypt(await secret())
}
export async function unseal<T>(value: string): Promise<T> {
  return (await jwtDecrypt(value, await secret())).payload as T
}
export async function readSession(): Promise<ArcadeSession | null> {
  const jar = await cookies(),
    value = jar.get(sessionCookie)?.value
  if (!value) return null
  try {
    let session = await unseal<ArcadeSession>(value)
    if (session.expiresAt < Date.now() + 30_000) {
      if (!session.refreshToken) return null
      const token = await exchange(
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: session.refreshToken,
        }),
      )
      session = {
        ...session,
        accessToken: token.access_token,
        refreshToken: token.refresh_token ?? session.refreshToken,
        expiresAt: Date.now() + token.expires_in * 1000,
      }
      jar.set(sessionCookie, await seal(session), {
        ...cookieOptions,
        maxAge: 7 * 86400,
      })
    }
    return session
  } catch {
    return null
  }
}
export async function exchange(body: URLSearchParams): Promise<{
  access_token: string
  refresh_token?: string
  expires_in: number
}> {
  body.set('client_id', process.env.COMMONS_IDENTITY_CLIENT_ID ?? '')
  body.set('client_secret', process.env.COMMONS_IDENTITY_CLIENT_SECRET ?? '')
  // RFC 8707 resource indicator. Commons only mints a signed platform JWT when
  // the token request names the audience; without it the grant returns an
  // opaque token that no downstream service can verify offline. The value must
  // be sent on every grant, including refreshes, or the session silently
  // degrades to an unverifiable credential after fifteen minutes.
  body.set(
    'resource',
    process.env.COMMONS_IDENTITY_AUDIENCE ?? 'commons-platform',
  )
  const response = await fetch(`${issuer()}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error('Commons sign-in failed. Please try again.')
  return response.json()
}
