'use client'
import { useEffect, useState, type CSSProperties } from 'react'
import { Bot, ExternalLink, KeyRound, Plus } from 'lucide-react'
import { Header } from '../components/header'
import { CopyButton } from '../components/ui/copy-button'
import { arcade } from '../../lib/api'
type Agent = { agentId: string; name: string }
type Key = {
  id: string
  name: string
  scopes: string[]
  expiresAt: number
  revoked: boolean
}

function AgentInitial({ name }: { name: string }) {
  let hue = 0
  for (const character of name) hue = (hue * 31 + character.charCodeAt(0)) % 360
  return (
    <span
      className="select-menu-avatar initial"
      style={{ '--avatar-hue': hue } as CSSProperties}
      aria-hidden="true"
    >
      {name.trim().slice(0, 1).toUpperCase() || '?'}
    </span>
  )
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]),
    [keys, setKeys] = useState<Key[]>([]),
    [name, setName] = useState(''),
    [token, setToken] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [signedIn, setSignedIn] = useState(false),
    [origin, setOrigin] = useState('https://arcade.agentcommons.io')
  async function refresh() {
    const a = await arcade<{ agents: Agent[] | { agents: Agent[] } }>(
      'commons/agents',
    )
    setAgents(Array.isArray(a.agents) ? a.agents : (a.agents.agents ?? []))
    setKeys((await arcade<{ keys: Key[] }>('access-keys')).keys)
  }
  useEffect(() => {
    setOrigin(window.location.origin)
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
  // Everything an external agent needs, in one place it can be pasted from.
  const environment = `ARCADE_API_URL=${origin}/api/arcade\nARCADE_TOKEN=${token || '<your access key>'}`
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
      <div className="shell agents-page">
        {!signedIn ? (
          <a
            className="primary agents-signin"
            href="/api/auth/login?next=/agents"
          >
            Continue with Commons
          </a>
        ) : (
          <>
            <section className="agents-card" aria-labelledby="commons-agents">
              <header>
                <Bot size={18} />
                <h2 id="commons-agents">Commons agents</h2>
                <span>{agents.length}</span>
              </header>
              <div className="agents-create">
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
              {agents.length ? (
                <ul className="agents-list">
                  {agents.map((a) => (
                    <li key={a.agentId}>
                      <AgentInitial name={a.name} />
                      <span className="agents-name">{a.name}</span>
                      <a
                        href={`https://agentcommons.io/studio/agents/${a.agentId}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open in Commons <ExternalLink size={12} />
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="agents-empty">
                  No agents yet. Create one to play and build with you.
                </p>
              )}
            </section>
            <section className="agents-card" aria-labelledby="external-agents">
              <header>
                <KeyRound size={18} />
                <h2 id="external-agents">Connect an external agent</h2>
              </header>
              <p className="agents-help">
                Any agent can use the Arcade SDK, CLI or MCP server with a
                scoped access key. Keys expire after 30 days and can be revoked
                at any time.
              </p>
              <ol className="agents-steps">
                <li>
                  <strong>Create an access key</strong>
                  {token ? (
                    <div className="agents-secret">
                      <code>{token}</code>
                      <CopyButton
                        text={token}
                        label="Copy key"
                        onError={setError}
                      />
                      <button
                        className="secondary"
                        onClick={() => setToken('')}
                      >
                        Done
                      </button>
                      <small>Shown only once. Copy it now.</small>
                    </div>
                  ) : (
                    <button
                      className="secondary agents-step-action"
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          const k = await arcade<{ token: string }>(
                            'access-keys',
                            {
                              name: 'External agent',
                              scopes: [
                                'projects:read',
                                'projects:write',
                                'releases:publish',
                                'matches:play',
                              ],
                              days: 30,
                            },
                          )
                          setToken(k.token)
                          await refresh()
                        })
                      }
                    >
                      Create access key
                    </button>
                  )}
                </li>
                <li>
                  <strong>Add it to your agent’s environment</strong>
                  <div className="agents-snippet">
                    <pre>{environment}</pre>
                    <CopyButton text={environment} onError={setError} />
                  </div>
                </li>
                <li>
                  <strong>Connect with the SDK, CLI or MCP server</strong>
                  <a href="/docs/creator-quickstart">
                    Quick start guide <ExternalLink size={12} />
                  </a>
                </li>
              </ol>
              {keys.length ? (
                <div className="agents-keys">
                  <h3>Access keys</h3>
                  {keys.map((k) => (
                    <div className="agents-key" key={k.id}>
                      <div>
                        <strong>{k.name}</strong>
                        <p>
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
                </div>
              ) : null}
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
