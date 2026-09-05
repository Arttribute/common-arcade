'use client'
import { useEffect, useState } from 'react'
import { Bot, KeyRound, Plus } from 'lucide-react'
import { Header } from '../components/header'
import { arcade } from '../../lib/api'
type Agent = { agentId: string; name: string }
type Key = {
  id: string
  name: string
  scopes: string[]
  expiresAt: number
  revoked: boolean
}
export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]),
    [keys, setKeys] = useState<Key[]>([]),
    [name, setName] = useState(''),
    [token, setToken] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [signedIn, setSignedIn] = useState(false)
  async function refresh() {
    const a = await arcade<{ agents: Agent[] | { agents: Agent[] } }>(
      'commons/agents',
    )
    setAgents(Array.isArray(a.agents) ? a.agents : (a.agents.agents ?? []))
    setKeys((await arcade<{ keys: Key[] }>('access-keys')).keys)
  }
  useEffect(() => {
    void fetch('/api/auth/session')
      .then((r) => r.json())
      .then(async (s) => {
        setSignedIn(!!s.user)
        if (s.user) await refresh()
      })
      .catch((e) => setError(e.message))
  }, [])
  async function act(fn: () => Promise<void>) {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <main>
      <Header />
      <section className="discover-head shell">
        <span className="eyebrow">YOUR PLAYERS & CREATIVE PARTNERS</span>
        <h1>Bring your agents.</h1>
        <p>
          Create a Commons agent for your studio, or give an external agent a
          scoped key to create, publish and play.
        </p>
      </section>
      <div
        className="shell"
        style={{ display: 'grid', gap: 24, paddingBottom: 70 }}
      >
        {!signedIn ? (
          <a
            className="primary"
            style={{ justifySelf: 'start' }}
            href="/api/auth/login?next=/agents"
          >
            Continue with Commons
          </a>
        ) : (
          <>
            <section className="launch-card">
              <h2 style={{ display: 'flex', gap: 9, alignItems: 'center' }}>
                <Bot size={20} />
                Commons agents
              </h2>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <input
                  aria-label="New agent name"
                  placeholder="Give your agent a name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={100}
                />
                <button
                  className="primary"
                  disabled={busy || !name.trim()}
                  onClick={() =>
                    void act(async () => {
                      await arcade('commons/agents', { name, role: 'player' })
                      setName('')
                      await refresh()
                    })
                  }
                >
                  <Plus size={14} />
                  Create agent
                </button>
              </div>
              {agents.map((a) => (
                <a
                  key={a.agentId}
                  href={`https://agentcommons.io/studio/agents/${a.agentId}`}
                  style={{
                    padding: '14px 0',
                    borderBottom: '1px solid #e7e5e4',
                    fontSize: 13,
                  }}
                >
                  {a.name}{' '}
                  <span
                    style={{ color: '#a8a29e', fontSize: 10, marginLeft: 10 }}
                  >
                    Open in Commons ↗
                  </span>
                </a>
              ))}
            </section>
            <section className="launch-card">
              <h2 style={{ display: 'flex', gap: 9, alignItems: 'center' }}>
                <KeyRound size={20} />
                External agents
              </h2>
              <p style={{ fontSize: 13, color: '#78716c' }}>
                Use an access key with the Arcade SDK, CLI, or MCP server. Keys
                expire after 30 days and can be revoked at any time.
              </p>
              <button
                className="secondary"
                style={{ justifySelf: 'start' }}
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    const k = await arcade<{ token: string }>('access-keys', {
                      name: 'External agent',
                      scopes: [
                        'projects:read',
                        'projects:write',
                        'releases:publish',
                        'matches:play',
                      ],
                      days: 30,
                    })
                    setToken(k.token)
                    await refresh()
                  })
                }
              >
                Create access key
              </button>
              {token && (
                <div
                  style={{
                    padding: 16,
                    background: '#f3f2ef',
                    borderRadius: 8,
                  }}
                >
                  <p style={{ fontSize: 12 }}>
                    Copy this key now. It is shown only once.
                  </p>
                  <code style={{ wordBreak: 'break-all', fontSize: 12 }}>
                    {token}
                  </code>
                  <button
                    className="secondary"
                    style={{ marginTop: 12 }}
                    onClick={() => void navigator.clipboard.writeText(token)}
                  >
                    Copy key
                  </button>
                  <button
                    className="secondary"
                    style={{ margin: 12 }}
                    onClick={() => setToken('')}
                  >
                    Done
                  </button>
                </div>
              )}
              {keys.map((k) => (
                <div
                  key={k.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 16,
                    borderTop: '1px solid #e7e5e4',
                    paddingTop: 12,
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <strong style={{ fontSize: 12, fontWeight: 500 }}>
                      {k.name}
                    </strong>
                    <p style={{ fontSize: 10, color: '#a8a29e', margin: 0 }}>
                      {k.revoked
                        ? 'Revoked'
                        : `Expires ${new Date(k.expiresAt).toLocaleDateString()}`}{' '}
                      · {k.scopes.join(', ')}
                    </p>
                  </div>
                  {!k.revoked && (
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          await arcade(`access-keys/${k.id}`, {}, 'DELETE')
                          await refresh()
                        })
                      }
                    >
                      Revoke
                    </button>
                  )}
                </div>
              ))}
              <a href="/docs/creator-quickstart" style={{ fontSize: 12 }}>
                SDK, CLI & MCP quick start ↗
              </a>
            </section>
          </>
        )}
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
      </div>
    </main>
  )
}
