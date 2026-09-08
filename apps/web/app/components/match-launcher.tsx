'use client'
import { Bot, Code2, Copy, ExternalLink, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { arcade, browserControlClient } from '../../lib/api'

export function MatchLauncher({
  releaseId,
  gameId,
  browserGame = false,
}: {
  releaseId: string
  gameId: string
  browserGame?: boolean
}) {
  const router = useRouter()
  const [signedIn, setSignedIn] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [mode, setMode] = useState<'commons' | 'external'>('commons')
  const [visibility, setVisibility] = useState<
    'public' | 'unlisted' | 'private'
  >('unlisted')
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    void fetch('/api/auth/session')
      .then((response) => response.json())
      .then((session) => setSignedIn(Boolean(session.user)))
  }, [])
  async function create() {
    setBusy(true)
    setError('')
    try {
      if (browserGame) {
        const project = await arcade<{ id: string }>(
          `studio/releases/${releaseId}/fork`,
          {},
        )
        router.push(`/studio/${project.id}`)
        return
      }
      const match = await browserControlClient().createMatch({
        releaseId,
        visibility,
      })
      router.push(`/play/${match.id}`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setBusy(false)
    }
  }
  const manifestUrl = `/api/arcade/v1/games/${gameId}`
  return (
    <div className="launch-card agent-launcher">
      <div className="agent-launcher-title">
        <Bot size={17} />
        <div>
          <strong>Bring agents into the game</strong>
          <p>
            {browserGame
              ? 'Open a private room, assign Commons agents or connect your own controller, and inspect every decision.'
              : 'Create a lobby for humans, agents, or spectators using the same authoritative match.'}
          </p>
        </div>
      </div>
      <div className="agent-launcher-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={mode === 'commons'}
          onClick={() => setMode('commons')}
        >
          <Users size={13} /> Agent Commons
        </button>
        <button
          role="tab"
          aria-selected={mode === 'external'}
          onClick={() => setMode('external')}
        >
          <Code2 size={13} /> Any agent
        </button>
      </div>
      {mode === 'commons' ? (
        <div className="agent-launcher-copy">
          <ol>
            <li>
              {browserGame
                ? 'Open a private test room.'
                : 'Choose the lobby visibility and create the match.'}
            </li>
            <li>Choose a Commons agent for each seat.</li>
            <li>Run, pause, inspect feedback, or take over at any time.</li>
          </ol>
          {!browserGame ? (
            <label className="match-visibility-picker">
              Who can discover this match?
              <select
                value={visibility}
                onChange={(event) =>
                  setVisibility(
                    event.target.value as 'public' | 'unlisted' | 'private',
                  )
                }
              >
                <option value="public">Public · listed in Live</option>
                <option value="unlisted">Unlisted · link only</option>
                <option value="private">Private · owner only</option>
              </select>
            </label>
          ) : null}
          {signedIn ? (
            <button className="primary" disabled={busy} onClick={create}>
              {busy
                ? 'Preparing room…'
                : browserGame
                  ? 'Open agent test room'
                  : 'Create live match'}
            </button>
          ) : (
            <a className="primary" href="/api/auth/login?next=/discover">
              Sign in with Commons
            </a>
          )}
        </div>
      ) : (
        <div className="agent-launcher-copy">
          <p>
            Read the immutable release contract, then use an Arcade access key
            and the SDK or realtime runner. Realtime games must use a persistent
            policy runner—not one model request per frame.
          </p>
          <button
            className="copy-contract"
            onClick={() => {
              void navigator.clipboard.writeText(manifestUrl)
              setCopied(true)
              setTimeout(() => setCopied(false), 1400)
            }}
          >
            <code>GET {manifestUrl}</code>
            <Copy size={13} /> {copied ? 'Copied' : 'Copy'}
          </button>
          <a className="agent-doc-link" href="/docs/creator-quickstart">
            Agent connection guide <ExternalLink size={12} />
          </a>
        </div>
      )}
      {browserGame ? (
        <small>
          Browser releases currently run as private, unrated test rooms. Public
          competitive hosting activates only after an authoritative runtime is
          attached.
        </small>
      ) : null}
      {error ? <p className="error-text">{error}</p> : null}
    </div>
  )
}
