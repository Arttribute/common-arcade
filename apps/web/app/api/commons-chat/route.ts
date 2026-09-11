import { NextRequest, NextResponse } from 'next/server'
import { readSession } from '../../../lib/session'

export const maxDuration = 120
type ChatSession = {
  sessionId: string
  title?: string
  createdAt?: string
  updatedAt?: string
  initiatorType?: string
  history?: { role: string; content: unknown }[]
}
function publicSession(session: ChatSession, includeHistory = false) {
  return {
    sessionId: session.sessionId,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    ...(includeHistory
      ? {
          history:
            session.history
              ?.filter((m) => m.role === 'user' || m.role === 'assistant')
              .map((m) => ({ role: m.role, content: m.content })) ?? [],
        }
      : {}),
  }
}
const idPattern = /^[A-Za-z0-9_-]{1,200}$/
async function handle(request: NextRequest) {
  if (
    request.method === 'POST' &&
    request.headers.get('origin') !== request.nextUrl.origin
  )
    return NextResponse.json(
      { detail: 'Invalid request origin.' },
      { status: 403 },
    )
  const auth = await readSession()
  if (!auth)
    return NextResponse.json({ detail: 'Sign in to chat.' }, { status: 401 })
  const base = (
    process.env.AGENT_COMMONS_API_URL ?? 'https://api.agentcommons.io'
  ).replace(/\/$/, '')
  async function commons(path: string, body?: unknown) {
    const response = await fetch(`${base}/v1/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${auth!.accessToken}`,
        'Content-Type': 'application/json',
        'x-initiator': auth!.id,
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
      signal: AbortSignal.timeout(110_000),
    })
    const result = await response.json()
    if (!response.ok)
      throw Error(
        result.detail ??
          result.message ??
          'Commons could not complete this request.',
      )
    return result.data ?? result
  }
  try {
    const body = request.method === 'POST' ? await request.json() : undefined
    const agentId = body?.agentId ?? request.nextUrl.searchParams.get('agentId')
    if (typeof agentId !== 'string' || !idPattern.test(agentId))
      return NextResponse.json(
        { detail: 'Choose a valid agent.' },
        { status: 400 },
      )
    // The list is scoped to the authenticated initiator, never an ID from the browser.
    const sessions = await commons(
      `sessions/list/${encodeURIComponent(agentId)}/${encodeURIComponent(auth.id)}/`,
    )
    if (!Array.isArray(sessions))
      throw Error('Commons returned an invalid session list.')
    const requested =
      body?.sessionId ?? request.nextUrl.searchParams.get('sessionId')
    if (
      requested &&
      !sessions.some((s: ChatSession) => s.sessionId === requested)
    )
      return NextResponse.json(
        { detail: 'Chat session not found.' },
        { status: 404 },
      )
    // The scoped listing omits initiatorType; retrieve details only after membership validation.
    const selected: ChatSession | undefined = requested
      ? await commons(`sessions/${encodeURIComponent(requested)}`)
      : undefined
    if (selected && selected.initiatorType !== 'arcade-chat')
      return NextResponse.json(
        { detail: 'Chat session not found.' },
        { status: 404 },
      )
    if (request.method === 'GET') {
      if (selected)
        return NextResponse.json(publicSession(selected, true), {
          headers: { 'Cache-Control': 'no-store' },
        })
      const chatSessions: ReturnType<typeof publicSession>[] = []
      // Bound concurrency while retaining the complete, user-scoped session history.
      for (let offset = 0; offset < sessions.length; offset += 8) {
        const details: ChatSession[] = await Promise.all(
          sessions
            .slice(offset, offset + 8)
            .map((s: ChatSession) =>
              commons(`sessions/${encodeURIComponent(s.sessionId)}`),
            ),
        )
        chatSessions.push(
          ...details
            .filter((s) => s.initiatorType === 'arcade-chat')
            .map((s) => publicSession(s)),
        )
      }
      return NextResponse.json(
        { sessions: chatSessions },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    }
    if (
      typeof body.message !== 'string' ||
      !body.message.trim() ||
      body.message.length > 8000
    )
      return NextResponse.json(
        { detail: 'Write a message up to 8,000 characters.' },
        { status: 400 },
      )
    const session = requested
      ? { sessionId: requested }
      : await commons('sessions', {
          agentId,
          title: body.message.trim().slice(0, 70),
          source: 'arcade-chat',
        })
    await commons('agents/run', {
      agentId,
      sessionId: session.sessionId,
      messages: [{ role: 'user', content: body.message }],
    })
    return NextResponse.json(
      publicSession(
        await commons(`sessions/${encodeURIComponent(session.sessionId)}`),
        true,
      ),
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    return NextResponse.json(
      {
        detail:
          error instanceof Error
            ? error.message
            : 'Chat is unavailable. Please try again.',
      },
      { status: 502 },
    )
  }
}
export const GET = handle
export const POST = handle
