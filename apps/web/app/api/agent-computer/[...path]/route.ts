import { NextRequest, NextResponse } from 'next/server'
import { readSession } from '../../../../lib/session'

export const maxDuration = 120

async function proxy(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const fail = (error: string, status: number) =>
    NextResponse.json({ error }, { status })
  if (
    request.method !== 'GET' &&
    request.headers.get('origin') !== request.nextUrl.origin
  )
    return fail('Invalid request origin', 403)
  const parts = (await context.params).path
  if (parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part)))
    return fail('Invalid computer route', 404)
  const path = parts.join('/')
  const base = /^agents\/[A-Za-z0-9_-]+\/computer(?:\/(.*))?$/.exec(path)
  const operation = base?.[1] ?? ''
  const allowed: Record<string, string[]> = {
    GET: ['', 'config', 'events', 'files/read'],
    PUT: ['config'],
    POST: ['wake', 'sleep', 'restart', 'browser/open', 'commands'],
  }
  if (!base || !allowed[request.method]?.includes(operation))
    return fail('Unknown computer operation', 404)
  const session = await readSession()
  if (!session)
    return fail('Sign in with Agent Commons to use your agent computer', 401)
  const query = new URLSearchParams()
  if (operation === 'files/read') {
    const filePath = request.nextUrl.searchParams.get('path')
    if (!filePath || filePath.length > 4096 || filePath.includes('\0'))
      return fail('A valid file path is required', 400)
    query.set('path', filePath)
  }
  if (operation === 'events') {
    const limit = Number(request.nextUrl.searchParams.get('limit') ?? 80)
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      return fail('Invalid event limit', 400)
    query.set('limit', String(limit))
  }
  const body = request.method === 'GET' ? undefined : await request.text()
  if (body && Buffer.byteLength(body) > 32768)
    return fail('Request too large', 413)
  if (body) {
    try {
      const value = JSON.parse(body)
      if (!value || typeof value !== 'object' || Array.isArray(value))
        return fail('Expected a JSON object', 400)
    } catch {
      return fail('Invalid JSON', 400)
    }
  }
  try {
    // Commons' OwnerGuard authorizes this user's access to the requested agent.
    // Never accept caller-supplied Authorization or forward browser cookies.
    const upstream = await fetch(
      `${(process.env.AGENT_COMMONS_API_URL ?? 'https://api.agentcommons.io').replace(/\/$/, '')}/v1/${path}${query.size ? `?${query}` : ''}`,
      {
        method: request.method,
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: body || undefined,
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(110000),
      },
    )
    const payload = await upstream.text()
    try {
      JSON.parse(payload)
    } catch {
      return fail('Computer service returned an invalid response', 502)
    }
    return new NextResponse(payload, {
      status: upstream.status,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    })
  } catch {
    return fail(
      'Computer service unavailable. Refresh its status before retrying an action.',
      502,
    )
  }
}

export { proxy as GET, proxy as PUT, proxy as POST }
