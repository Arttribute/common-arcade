import { NextResponse } from 'next/server'
import {
  cookieOptions,
  readSession,
  sessionCookie,
} from '../../../../lib/session'
export async function GET() {
  const session = await readSession()
  const response = NextResponse.json(
    session ? { user: { id: session.id, name: session.name } } : { user: null },
    { headers: { 'Cache-Control': 'no-store' } },
  )
  if (!session)
    response.cookies.set(sessionCookie, '', { ...cookieOptions, maxAge: 0 })
  return response
}
