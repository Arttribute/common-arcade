'use client'
import { useEffect, useRef, useState } from 'react'
import { ChatComposer } from '@agent-commons/ui'
import { MessageSquare, Plus } from 'lucide-react'
import type { useArcadeIdentity } from './studio-composer'

type Session = {
  sessionId: string
  title?: string
  createdAt?: string
  history?: { role: string; content: unknown }[]
}
function messageText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content))
    return content
      .map((part) => (part?.type === 'text' ? part.text : ''))
      .filter(Boolean)
      .join('\n')
  return ''
}
export function GeneralChat({
  identity,
}: {
  identity: ReturnType<typeof useArcadeIdentity>
}) {
  const [sessions, setSessions] = useState<Session[]>([]),
    [current, setCurrent] = useState<Session>()
  const [prompt, setPrompt] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const end = useRef<HTMLDivElement>(null),
    requestId = useRef(0)
  async function request(query = '', body?: unknown) {
    const response = await fetch(
      `/api/commons-chat?agentId=${encodeURIComponent(identity.copilotId)}${query}`,
      {
        method: body ? 'POST' : 'GET',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      },
    )
    const result = await response.json()
    if (!response.ok) throw Error(result.detail ?? 'Could not load chat.')
    return result
  }
  useEffect(() => {
    const id = ++requestId.current
    setCurrent(undefined)
    setSessions([])
    setError('')
    if (!identity.user || !identity.copilotId) return
    setLoading(true)
    void request()
      .then((result) => {
        if (id === requestId.current) setSessions(result.sessions)
      })
      .catch((e) => {
        if (id === requestId.current) setError(e.message)
      })
      .finally(() => {
        if (id === requestId.current) setLoading(false)
      })
    return () => {
      requestId.current++
    }
  }, [identity.copilotId, identity.user?.id])
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' })
  }, [current, busy])
  async function choose(sessionId: string) {
    setError('')
    setLoading(true)
    try {
      setCurrent(await request(`&sessionId=${encodeURIComponent(sessionId)}`))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open chat.')
    } finally {
      setLoading(false)
    }
  }
  async function send() {
    if (!prompt.trim() || busy) return
    const message = prompt
    setBusy(true)
    setError('')
    try {
      const session = await request('', {
        agentId: identity.copilotId,
        sessionId: current?.sessionId,
        message,
      })
      setCurrent(session)
      setPrompt('')
      setSessions((all) => [
        session,
        ...all.filter((s) => s.sessionId !== session.sessionId),
      ])
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Could not send message. Reopen the session before retrying.',
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="general-chat">
      <div className="chat-session-toolbar">
        <select
          aria-label="Chat history"
          value={current?.sessionId ?? ''}
          disabled={busy || loading}
          onChange={(e) =>
            e.target.value ? void choose(e.target.value) : setCurrent(undefined)
          }
        >
          <option value="">New conversation</option>
          {sessions.map((s) => (
            <option key={s.sessionId} value={s.sessionId}>
              {s.title || 'Untitled conversation'}
            </option>
          ))}
        </select>
        <button
          disabled={busy || loading}
          onClick={() => {
            setCurrent(undefined)
            setPrompt('')
            setError('')
          }}
        >
          <Plus size={13} /> New
        </button>
      </div>
      <div className="studio-conversation">
        {!current && (
          <div className="studio-copilot-welcome">
            <MessageSquare size={24} />
            <h2>Room for an idea.</h2>
            <p>
              Talk through mechanics, brainstorm a world, or ask a question.
              These conversations have their own history in Commons.
            </p>
          </div>
        )}
        {current?.history
          ?.filter(
            (m) =>
              ['user', 'assistant'].includes(m.role) && messageText(m.content),
          )
          .map((m, i) => (
            <div key={i} className={`studio-message ${m.role}`}>
              <small>{m.role === 'user' ? 'You' : 'Assistant'}</small>
              <p>{messageText(m.content)}</p>
            </div>
          ))}
        {(busy || loading) && (
          <p role="status">{busy ? 'Thinking…' : 'Loading conversation…'}</p>
        )}
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        <div ref={end} />
      </div>
      <div className="arcade-composer-wrap">
        <ChatComposer
          value={prompt}
          onChange={setPrompt}
          onSubmit={() => void send()}
          busy={busy}
          disabled={!identity.user || !identity.copilotId || loading}
          placeholder={identity.user ? 'Ask anything…' : 'Sign in to chat'}
        />
      </div>
    </div>
  )
}
