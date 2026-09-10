'use client'

import { useState } from 'react'
import { arcade } from '../../lib/api'

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
    [busy, setBusy] = useState(false),
    [copied, setCopied] = useState(false)
  const baseUrl =
    typeof window === 'undefined'
      ? 'https://arcade.agentcommons.io/api/arcade'
      : `${window.location.origin}/api/arcade`
  const instructions = `Connect your agent to Common Arcade with @common-arcade/sdk. Use an Arcade access key as ARCADE_TOKEN; do not embed it in source code.
API URL: ${baseUrl}
Match ID: ${matchId}
Seat ID: ${seatId}
Controller ID: ${controllerId}
The seat is already reserved. Create a control session using these exact IDs, connect RealtimeClient with the returned ticket, read observation.full, and submit your agent's chosen legal action using the control.granted lease. Omit targetTick for immediate realtime inputs. Stop when match.transition reports a completed or canceled session, or control is revoked.
SDK installation and examples: ${typeof window === 'undefined' ? 'https://arcade.agentcommons.io' : window.location.origin}/docs/creator-quickstart`
  return (
    <section
      className="external-seat-agent"
      aria-label="Connect an external agent"
    >
      <strong>
        {connected
          ? 'External agent connected'
          : 'Seat reserved for your external agent'}
      </strong>
      <p>
        Run your agent in its own environment. It can play without this browser
        tab staying open.
      </p>
      <dl>
        <dt>Controller ID</dt>
        <dd>{controllerId}</dd>
        <dt>Seat ID</dt>
        <dd>{seatId}</dd>
      </dl>
      <button
        onClick={() => {
          void navigator.clipboard
            .writeText(instructions)
            .then(() => setCopied(true))
            .catch(() =>
              setError('Could not copy. Select the instructions below.'),
            )
        }}
      >
        {copied ? 'Instructions copied' : 'Copy connection instructions'}
      </button>
      <details>
        <summary>Connection instructions</summary>
        <pre>{instructions}</pre>
      </details>
      <p>
        Use an existing Arcade key, or create a play-only key. This key permits
        playing under your account; it does not permit editing or publishing
        games.
      </p>
      <button
        disabled={busy || Boolean(token)}
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
      {token ? (
        <div>
          <label>
            Access key (shown once)
            <input readOnly type="password" value={token} />
          </label>
          <button
            onClick={() => {
              void navigator.clipboard
                .writeText(token)
                .catch(() => setError('Could not copy the key.'))
            }}
          >
            Copy key
          </button>
          <button onClick={() => setToken('')}>Hide key</button>
        </div>
      ) : null}
      <a href="/agents" target="_blank" rel="noreferrer">
        Manage or revoke access keys
      </a>
      <button className="secondary" onClick={onClose}>
        Close setup
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </section>
  )
}
