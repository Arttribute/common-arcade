'use client'

import { useState } from 'react'
import { CheckCircle2, X } from 'lucide-react'
import { arcade } from '../../lib/api'
import { CopyButton } from './ui/copy-button'

/**
 * One panel to connect an external agent to a reserved seat: copy the
 * instructions, optionally create a play-only key, done. Nothing to navigate.
 */
export function ExternalSeatAgent({
  matchId,
  seatId,
  controllerId,
  connected,
  onClose,
}: {
  matchId: string
  seatId: string
  controllerId: string
  connected: boolean
  onClose: () => void
}) {
  const [token, setToken] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const origin =
    typeof window === 'undefined'
      ? 'https://arcade.agentcommons.io'
      : window.location.origin
  const instructions = `Connect your agent to Common Arcade with @common-arcade/sdk. Use an Arcade access key as ARCADE_TOKEN; do not embed it in source code.
API URL: ${origin}/api/arcade
Match ID: ${matchId}
Seat ID: ${seatId}
Controller ID: ${controllerId}
The seat is already reserved. Create a control session using these exact IDs, connect RealtimeClient with the returned ticket, read observation.full, and submit your agent's chosen legal action using the control.granted lease. Omit targetTick for immediate realtime inputs. Stop when match.transition reports a completed or canceled session, or control is revoked.
SDK installation and examples: ${origin}/docs/creator-quickstart`
  return (
    <section
      className="external-seat-agent"
      aria-label="Connect an external agent"
    >
      <header>
        <strong>
          {connected ? (
            <>
              <CheckCircle2 size={14} /> External agent connected
            </>
          ) : (
            'Connect your external agent'
          )}
        </strong>
        <button
          type="button"
          className="external-seat-close"
          aria-label="Close setup"
          onClick={onClose}
        >
          <X size={14} />
        </button>
      </header>
      <p>
        This seat is reserved. Run your agent in its own environment; it keeps
        playing after you close this tab.
      </p>
      <div className="external-seat-snippet">
        <pre>{instructions}</pre>
        <CopyButton
          text={instructions}
          label="Copy instructions"
          onError={setError}
        />
      </div>
      <div className="external-seat-key">
        {token ? (
          <>
            <input
              readOnly
              type="password"
              value={token}
              aria-label="Play key (shown once)"
            />
            <CopyButton text={token} label="Copy key" onError={setError} />
          </>
        ) : (
          <button
            type="button"
            className="secondary compact"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              setError('')
              void arcade<{ token: string }>('access-keys', {
                name: 'External live player',
                scopes: ['matches:play'],
                days: 1,
              })
                .then((result) => setToken(result.token))
                .catch((cause) => setError(cause.message))
                .finally(() => setBusy(false))
            }}
          >
            {busy ? 'Creating key…' : 'Create 1-day play key'}
          </button>
        )}
        <small>
          Play-only: this key can’t edit or publish games.{' '}
          <a href="/agents" target="_blank" rel="noreferrer">
            Manage keys
          </a>
        </small>
      </div>
      {error ? <p role="alert">{error}</p> : null}
    </section>
  )
}
