import { NextRequest, NextResponse } from 'next/server'
import { readSession } from '../../../../lib/session'
export const maxDuration = 120
async function proxy(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  if (
    !request.headers.get('authorization') &&
    !['GET', 'HEAD'].includes(request.method) &&
    request.headers.get('origin') !== request.nextUrl.origin
  )
    return NextResponse.json(
      { detail: 'Invalid request origin.' },
      { status: 403 },
    )
  const session = await readSession()
  const path = (await context.params).path.map(encodeURIComponent).join('/')
  const publicDocument = [
    'openapi.json',
    'asyncapi.json',
    '.well-known/arcade.json',
    '.well-known/jwks.json',
  ].includes(path)
  if (!path.startsWith('v1/') && !(publicDocument && request.method === 'GET'))
    return NextResponse.json({ detail: 'Unknown API route.' }, { status: 404 })
  const headers = new Headers({
    Accept: 'application/json',
    'Content-Type': 'application/json',
  })
  if (request.headers.get('authorization'))
    headers.set('Authorization', request.headers.get('authorization')!)
  else if (session)
    headers.set('Authorization', `Bearer ${session.accessToken}`)
  for (const name of ['If-Match', 'Idempotency-Key']) {
    const value = request.headers.get(name)
    if (value) headers.set(name, value)
  }
  const body = ['GET', 'HEAD'].includes(request.method)
    ? undefined
    : await request.text()
  if (body && Buffer.byteLength(body) > 262144)
    return NextResponse.json(
      { detail: 'Request is too large.' },
      { status: 413 },
    )
  try {
    const response = await fetch(
      `${(process.env.ARCADE_API_URL ?? 'http://localhost:4100').replace(/\/$/, '')}/${path}${request.nextUrl.search}`,
      {
        method: request.method,
        headers,
        body,
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(110_000),
      },
    )
    return new NextResponse(response.body, {
      status: response.status,
      headers: {
        'Content-Type':
          response.headers.get('Content-Type') ?? 'application/json',
        'Cache-Control': 'no-store',
      },
    })
  } catch {
    return NextResponse.json(
      { detail: 'Arcade is temporarily unavailable. Please retry.' },
      { status: 502 },
    )
  }
}
export {
  proxy as GET,
  proxy as POST,
  proxy as PUT,
  proxy as PATCH,
  proxy as DELETE,
}
