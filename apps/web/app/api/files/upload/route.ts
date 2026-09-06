import { NextRequest, NextResponse } from 'next/server'
import { readSession } from '../../../../lib/session'
export const maxDuration = 60
export async function POST(request: NextRequest) {
  if (request.headers.get('origin') !== request.nextUrl.origin)
    return NextResponse.json(
      { detail: 'Invalid request origin.' },
      { status: 403 },
    )
  const session = await readSession()
  if (!session)
    return NextResponse.json(
      { detail: 'Sign in to attach files.' },
      { status: 401 },
    )
  const form = await request.formData()
  const files = form.getAll('files')
  if (
    files.length < 1 ||
    files.length > 20 ||
    files.some((f) => !(f instanceof File) || f.size > 4 * 1024 * 1024)
  )
    return NextResponse.json(
      { detail: 'Attach files up to 4 MB each.' },
      { status: 413 },
    )
  const response = await fetch(
    `${process.env.AGENT_COMMONS_API_URL ?? 'https://api.agentcommons.io'}/v1/files/upload`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'x-initiator': session.id,
        'x-owner-id': session.id,
      },
      body: form,
      signal: AbortSignal.timeout(55000),
    },
  )
  return new NextResponse(response.body, {
    status: response.status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  })
}
