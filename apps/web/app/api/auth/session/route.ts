import { NextResponse } from 'next/server'
import {
  cookieOptions,
  readSession,
  sessionCookie,
} from '../../../../lib/session'
import { devAccessTokenUser } from '../../../../lib/dev-access-token'
export async function GET() {
  const session = await readSession()
  // Without a Commons session, local development may sign in with a dev key.
  const user = session
    ? { id: session.id, name: session.name }
    : await devAccessTokenUser()
  const response = NextResponse.json(
    { user },
    { headers: { 'Cache-Control': 'no-store' } },
  )
  if (!session)
    response.cookies.set(sessionCookie, '', { ...cookieOptions, maxAge: 0 })
  return response
}
