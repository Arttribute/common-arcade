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
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { arcade, browserControlClient } from '../../lib/api'
import { Dialog } from './ui/dialog'
import { Play } from 'lucide-react'
import { HostPaymentSettings } from './host-payment-settings'
import { SelectMenu } from './ui/select-menu'
import { economyConfigSchema, type EconomyConfig } from '@common-arcade/economy'
import type { GameMonetization } from '@common-arcade/protocol'

export function MatchLauncher({
  releaseId,
  gameId,
  browserGame = false,
  remixing,
  license,
  paymentTerms,
  paidMatchSupported = false,
}: {
  releaseId: string
  gameId: string
  browserGame?: boolean
  remixing?: 'disabled' | 'allowed'
  license?: string
  paymentTerms?: GameMonetization
  paidMatchSupported?: boolean
}) {
  const router = useRouter()
  const [signedIn, setSignedIn] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [mode, setMode] = useState<'commons' | 'external'>('commons')
  const [visibility, setVisibility] = useState<
    'public' | 'unlisted' | 'private'
  >('public')
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
  const [economy, setEconomy] = useState<EconomyConfig>({ mode: 'free' })
  const setup = useRef<HTMLDivElement>(null)
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
    for (const input of setup.current?.querySelectorAll('input') ?? []) {
      if (!input.reportValidity()) return
    }
    setBusy(true)
    setError('')
    try {
      if (economy.mode === 'escrow') {
        const selection = economyConfigSchema.parse(economy)
        router.push(
          `/play/paid/${encodeURIComponent(releaseId)}?economy=${encodeURIComponent(JSON.stringify(selection))}`,
        )
        return
      }
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
      <div className="preview-game-actions">
        <a className="primary game-play-button" href="#game-preview">
          <Play size={17} /> Play preview
        </a>
        <Dialog
          title="About this preview"
          description="Play locally, or continue creating in Studio."
          trigger={
            <button className="preview-info-link">About this release</button>
          }
        >
          <p>
            This game is playable in your browser. A live-ready release is
            needed to host a shared session.
          </p>
          {signedIn ? (
            <button
              className="primary"
              disabled={busy}
              onClick={() => void openStudio()}
            >
              {busy ? 'Opening Studio…' : 'Open in Studio'}
            </button>
          ) : (
            <a
              className="primary"
              href={`/api/auth/login?next=/games/${encodeURIComponent(gameId)}`}
            >
              Sign in to open Studio
            </a>
          )}
          <p className="match-rule-note">
            {license ?? 'all-rights-reserved'} ·{' '}
            {remixing === 'allowed' ? 'Remixes enabled' : 'Remixes restricted'}
          </p>
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
        </Dialog>
      </div>
    )
  return (
    <Dialog
      title="Start playing"
      description="Join a game or set up a live session for your friends and agents."
      trigger={
        <button className="primary game-play-button">
          <Play size={17} fill="currentColor" /> Play
        </button>
      }
    >
      <div className="launch-card agent-launcher" ref={setup}>
        <div className="agent-launcher-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={mode === 'commons'}
            onClick={() => setMode('commons')}
          >
            <Users size={13} /> Play together
          </button>
          <button
            role="tab"
            aria-selected={mode === 'external'}
            onClick={() => setMode('external')}
          >
            <Code2 size={13} /> Connect an agent
          </button>
        </div>
        {mode === 'commons' ? (
          <div className="agent-launcher-copy">
            <HostPaymentSettings
              value={economy}
              onChange={setEconomy}
              terms={paymentTerms}
              supported={paidMatchSupported}
            />
            {!browserGame && economy.mode === 'free' ? (
              <div className="match-setup-grid">
                <label>
                  Discoverability
                  <SelectMenu
                    value={visibility}
                    options={[
                      {
                        value: 'public',
                        label: 'Public',
                        description: 'Listed in Live',
                      },
                      {
                        value: 'unlisted',
                        label: 'Unlisted',
                        description: 'Link only',
                      },
                      {
                        value: 'private',
                        label: 'Private',
                        description: 'Owner only',
                      },
                    ]}
                    onChange={(value) =>
                      setVisibility(value as 'public' | 'unlisted' | 'private')
                    }
                  />
                </label>
                <p className="match-setup-wide match-rule-note">
                  {visibility === 'public'
                    ? 'This session will appear on the Live page.'
                    : visibility === 'unlisted'
                      ? 'Link only. Find it in Your sessions; it will not appear in the public feed.'
                      : 'Only you can access this session. Find it in Your sessions.'}
                </p>
                <label>
                  Joining
                  <SelectMenu
                    value={joinPolicy}
                    options={[
                      { value: 'open', label: 'Open lobby' },
                      { value: 'invite-only', label: 'Invite only' },
                    ]}
                    onChange={(value) =>
                      setJoinPolicy(value as typeof joinPolicy)
                    }
                  />
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
                  <SelectMenu
                    value={String(maximumRounds)}
                    options={[1, 3, 5, 7, 9].map((rounds) => ({
                      value: String(rounds),
                      label: String(rounds),
                    }))}
                    onChange={(value) => setMaximumRounds(Number(value))}
                  />
                </label>
                <label>
                  Between rounds
                  <SelectMenu
                    value={restartPolicy}
                    options={[
                      { value: 'owner', label: 'Host starts next round' },
                      { value: 'unanimous', label: 'Every player agrees' },
                      { value: 'automatic', label: 'Automatic' },
                    ]}
                    onChange={(value) =>
                      setRestartPolicy(value as typeof restartPolicy)
                    }
                  />
                </label>
                <label>
                  Watching
                  <SelectMenu
                    value={spectating}
                    options={[
                      { value: 'enabled', label: 'Live spectators' },
                      { value: 'disabled', label: 'Players only' },
                    ]}
                    onChange={(value) =>
                      setSpectating(value as typeof spectating)
                    }
                  />
                </label>
                <fieldset className="controller-options">
                  <legend>Who can play?</legend>
                  <label className="switch-row">
                    <input
                      type="checkbox"
                      role="switch"
                      className="switch"
                      checked={allowHumans}
                      onChange={(event) => setAllowHumans(event.target.checked)}
                    />
                    Humans
                  </label>
                  <label className="switch-row">
                    <input
                      type="checkbox"
                      role="switch"
                      className="switch"
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
                    busy ||
                    (economy.mode === 'free' &&
                      !browserGame &&
                      !allowHumans &&
                      !allowAgents)
                  }
                  onClick={create}
                >
                  {busy
                    ? 'Preparing room…'
                    : browserGame
                      ? 'Open creator workspace or remix'
                      : economy.mode === 'escrow'
                        ? 'Continue to paid lobby'
                        : 'Host a live session'}
                </button>
                {!browserGame && economy.mode === 'free' ? (
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
              and the SDK or realtime runner. Realtime games must use a
              persistent policy runner—not one model request per frame.
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
    </Dialog>
  )
}
