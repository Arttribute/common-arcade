import { NextRequest, NextResponse } from 'next/server'
import { sessionCookie } from '../../../../lib/session'
export async function POST(request: NextRequest) {
  if (request.headers.get('origin') !== request.nextUrl.origin)
    return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
  const response = NextResponse.json({ signedOut: true })
  response.cookies.delete(sessionCookie)
  response.cookies.delete('arcade-oauth-state')
  response.headers.set('Cache-Control', 'no-store')
  return response
}
