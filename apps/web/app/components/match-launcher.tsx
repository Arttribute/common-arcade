'use client'
import {
  AlertTriangle,
  Bot,
  Code2,
  Copy,
  ExternalLink,
  Radio,
  Users,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { arcade, browserControlClient } from '../../lib/api'

export function MatchLauncher({
  releaseId,
  gameId,
  browserGame = false,
  remixing,
  license,
}: {
  releaseId: string
  gameId: string
  browserGame?: boolean
  remixing?: 'disabled' | 'allowed'
  license?: string
}) {
  const router = useRouter()
  const [signedIn, setSignedIn] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [mode, setMode] = useState<'commons' | 'external'>('commons')
  const [visibility, setVisibility] = useState<
    'public' | 'unlisted' | 'private'
  >('unlisted')
  const [joinPolicy, setJoinPolicy] = useState<'open' | 'invite-only'>('open')
  const [invites, setInvites] = useState('')
  const [allowHumans, setAllowHumans] = useState(true)
  const [allowAgents, setAllowAgents] = useState(true)
  const [spectating, setSpectating] = useState<'enabled' | 'disabled'>(
    'enabled',
  )
  const [maximumRounds, setMaximumRounds] = useState(3)
  const [restartPolicy, setRestartPolicy] = useState<
    'automatic' | 'owner' | 'unanimous'
  >('owner')
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    void fetch('/api/auth/session')
      .then((response) => response.json())
      .then((session) => setSignedIn(Boolean(session.user)))
  }, [])
  async function openStudio() {
    setBusy(true)
    setError('')
    try {
      const project = await arcade<{ id: string }>(
        `studio/releases/${releaseId}/fork`,
        {},
      )
      router.push(`/studio/${project.id}`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setBusy(false)
    }
  }
  async function create() {
    setBusy(true)
    setError('')
    try {
      const match = await browserControlClient().createMatch({
        releaseId,
        visibility,
        lobby: {
          joinPolicy,
          allowedControllers: [
            ...(allowHumans ? (['human'] as const) : []),
            ...(allowAgents ? (['agent'] as const) : []),
          ],
          invitedActorIds: invites
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean),
          spectating,
        },
        series: { maximumRounds, restartPolicy },
      })
      router.push(`/play/${match.id}`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setBusy(false)
    }
  }
  async function findOpenGame() {
    setBusy(true)
    setError('')
    try {
      const joined = await browserControlClient().findMatch({
        releaseId,
        controllerId: 'browser-human_player',
        controllerKind: 'human',
        lobby: {
          allowedControllers: ['human', 'agent'],
          spectating: 'enabled',
        },
        series: { maximumRounds, restartPolicy },
      })
      router.push(`/play/${joined.match.id}`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setBusy(false)
    }
  }
  const manifestUrl = `/api/arcade/v1/games/${gameId}`
  if (browserGame)
    return (
      <div className="launch-card preview-hosting-card">
        <div className="agent-launcher-title">
          <AlertTriangle size={18} />
          <div>
            <span className="preview-hosting-status">Preview only</span>
            <strong>This release cannot host a live session yet</strong>
            <p>
              Its rules, clock, state, validation, and result run independently
              in each viewer&apos;s browser. A lobby would create diverging
              copies, not one fair shared match.
            </p>
          </div>
        </div>
        <div className="preview-hosting-path">
          <strong>
            <Radio size={13} /> Legacy preview release
          </strong>
          <p>
            New Studio builds are created and tested against the authoritative
            live runtime as part of the normal Copilot build. This older release
            remains playable locally, but cannot open a synchronized lobby.
          </p>
        </div>
        {signedIn ? (
          <button
            className="primary"
            disabled={busy}
            onClick={() => void openStudio()}
          >
            {busy ? 'Opening Studio…' : 'Open project in Studio'}
          </button>
        ) : (
          <a
            className="primary"
            href={`/api/auth/login?next=/games/${encodeURIComponent(gameId)}`}
          >
            Sign in to open Studio
          </a>
        )}
        <a className="agent-doc-link" href="/docs/creator-quickstart">
          About live-ready games <ExternalLink size={12} />
        </a>
        <small>
          You can still play and record this local preview below. Published
          source is immutable; owners return to their workspace, while other
          creators receive an attributed copy only when remixes are enabled.{' '}
          {license ?? 'all-rights-reserved'} ·{' '}
          {remixing === 'allowed' ? 'remixes enabled' : 'remixes restricted'}.
        </small>
        {error ? <p className="error-text">{error}</p> : null}
      </div>
    )
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
            <li>
              Join yourself, or give the session link and release contract to
              your Commons or external agent.
            </li>
            <li>
              Every controller claims one authoritative seat; spectators use the
              same live state stream.
            </li>
          </ol>
          {!browserGame ? (
            <div className="match-setup-grid">
              <label>
                Discoverability
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
              <label>
                Joining
                <select
                  value={joinPolicy}
                  onChange={(event) =>
                    setJoinPolicy(event.target.value as typeof joinPolicy)
                  }
                >
                  <option value="open">Open lobby</option>
                  <option value="invite-only">Invite only</option>
                </select>
              </label>
              {joinPolicy === 'invite-only' ? (
                <label className="match-setup-wide">
                  Invited Commons IDs
                  <input
                    value={invites}
                    onChange={(event) => setInvites(event.target.value)}
                    placeholder="user_one, agent_owner_two"
                  />
                </label>
              ) : null}
              <label>
                Rounds
                <select
                  value={maximumRounds}
                  onChange={(event) =>
                    setMaximumRounds(Number(event.target.value))
                  }
                >
                  {[1, 3, 5, 7, 9].map((rounds) => (
                    <option key={rounds} value={rounds}>
                      {rounds}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Between rounds
                <select
                  value={restartPolicy}
                  onChange={(event) =>
                    setRestartPolicy(event.target.value as typeof restartPolicy)
                  }
                >
                  <option value="owner">Host starts next round</option>
                  <option value="unanimous">Every player agrees</option>
                  <option value="automatic">Automatic</option>
                </select>
              </label>
              <label>
                Watching
                <select
                  value={spectating}
                  onChange={(event) =>
                    setSpectating(event.target.value as typeof spectating)
                  }
                >
                  <option value="enabled">Live spectators</option>
                  <option value="disabled">Players only</option>
                </select>
              </label>
              <fieldset className="controller-options">
                <legend>Who can play?</legend>
                <label>
                  <input
                    type="checkbox"
                    checked={allowHumans}
                    onChange={(event) => setAllowHumans(event.target.checked)}
                  />
                  Humans
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={allowAgents}
                    onChange={(event) => setAllowAgents(event.target.checked)}
                  />
                  Agents
                </label>
              </fieldset>
            </div>
          ) : null}
          {signedIn ? (
            <div className="match-launch-actions">
              <button
                className="primary"
                disabled={
                  busy || (!browserGame && !allowHumans && !allowAgents)
                }
                onClick={create}
              >
                {busy
                  ? 'Preparing room…'
                  : browserGame
                    ? 'Open creator workspace or remix'
                    : 'Host a live session'}
              </button>
              {!browserGame ? (
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => void findOpenGame()}
                >
                  Find an open game
                </button>
              ) : null}
            </div>
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
      {error ? <p className="error-text">{error}</p> : null}
    </div>
  )
}
