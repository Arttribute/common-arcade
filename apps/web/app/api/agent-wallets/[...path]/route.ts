import { NextRequest, NextResponse } from 'next/server'
import { readSession } from '../../../../lib/session'
export const maxDuration = 120
async function proxy(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  if (
    request.method !== 'GET' &&
    request.headers.get('origin') !== request.nextUrl.origin
  )
    return NextResponse.json(
      { error: 'Invalid request origin' },
      { status: 403 },
    )
  const session = await readSession()
  if (!session)
    return NextResponse.json(
      { error: 'Sign in with Agent Commons to manage spending grants' },
      { status: 401 },
    )
  const parts = (await context.params).path
  if (parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p)))
    return NextResponse.json({ error: 'Invalid route' }, { status: 404 })
  const path = parts.join('/')
  const routes = [
    {
      method: 'GET',
      pattern: /^wallets\/agent\/[A-Za-z0-9_-]+\/runtime-sessions$/,
    },
    { method: 'GET', pattern: /^agents$/ },
    { method: 'GET', pattern: /^wallets\/agent\/[A-Za-z0-9_-]+$/ },
    { method: 'GET', pattern: /^wallets\/[A-Za-z0-9_-]+\/balance$/ },
    {
      method: 'GET',
      pattern:
        /^wallets\/agent\/[A-Za-z0-9_-]+\/payment-sessions(?:\/[A-Za-z0-9_-]+\/attempts)?$/,
    },
    {
      method: 'POST',
      pattern: /^wallets\/agent\/[A-Za-z0-9_-]+\/payment-sessions$/,
    },
    {
      method: 'POST',
      pattern:
        /^wallets\/agent\/[A-Za-z0-9_-]+\/(?:x402-fetch|arcade\/(?:deposit|action|observation))$/,
    },
    {
      method: 'DELETE',
      pattern:
        /^wallets\/agent\/[A-Za-z0-9_-]+\/payment-sessions\/[A-Za-z0-9_-]+$/,
    },
  ]
  if (!routes.some((r) => r.method === request.method && r.pattern.test(path)))
    return NextResponse.json(
      { error: 'Unknown wallet operation' },
      { status: 404 },
    )
  const body = request.method === 'GET' ? undefined : await request.text()
  if (body && Buffer.byteLength(body) > 32768)
    return NextResponse.json({ error: 'Request too large' }, { status: 413 })
  const chainId = request.nextUrl.searchParams.get('chainId')
  const query =
    path.endsWith('/balance') && chainId && /^\d+$/.test(chainId)
      ? `?chainId=${chainId}`
      : ''
  try {
    const response = await fetch(
      `${(process.env.AGENT_COMMONS_API_URL ?? 'https://api.agentcommons.io').replace(/\/$/, '')}/v1/${path}${query}`,
      {
        method: request.method,
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          'Content-Type': 'application/json',
        },
        body,
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(110000),
      },
    )
    const text = await response.text()
    try {
      JSON.parse(text)
    } catch {
      return NextResponse.json(
        { error: 'Wallet service returned an invalid response' },
        { status: 502 },
      )
    }
    return new NextResponse(text, {
      status: response.status,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    })
  } catch {
    return NextResponse.json(
      {
        error:
          'Wallet service unavailable; inspect existing attempts before retrying a payment',
      },
      { status: 502 },
    )
  }
}
export { proxy as GET, proxy as POST, proxy as DELETE }
