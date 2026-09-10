'use client'

import type { LiveMatch } from '@common-arcade/control-client'
import { Eye, Radio, Users, Gamepad2 } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { browserControlClient } from '../../lib/api'

export function LiveFeed() {
  const [matches, setMatches] = useState<readonly LiveMatch[]>([])
  const [mine, setMine] = useState<readonly LiveMatch[]>([])
  const [signedIn, setSignedIn] = useState(false)
  const [personalError, setPersonalError] = useState(false)
  const [loading, setLoading] = useState(true)
  const [online, setOnline] = useState(true)
  const [filter, setFilter] = useState<'all' | 'lobby' | 'live' | 'mine'>('all')

  useEffect(() => {
    let active = true
    let pending = false
    const abort = new AbortController()
    const refresh = async () => {
      if (pending) return
      pending = true
      try {
        const session = await fetch('/api/auth/session', {
          signal: abort.signal,
        }).then((r) => r.json())
        if (!active) return
        const authenticated = Boolean(session.user)
        setSignedIn(authenticated)
        const client = browserControlClient()
        const [publicResult, ownResult] = await Promise.allSettled([
          client.listLiveMatches(abort.signal),
          authenticated
            ? client.listLiveMatches(abort.signal, 'mine')
            : Promise.resolve([]),
        ])
        if (!active) return
        setOnline(publicResult.status === 'fulfilled')
        if (publicResult.status === 'fulfilled') setMatches(publicResult.value)
        setPersonalError(ownResult.status === 'rejected')
        if (ownResult.status === 'fulfilled') setMine(ownResult.value)
      } catch {
        if (active) setOnline(false)
      } finally {
        pending = false
        if (active) setLoading(false)
      }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 5000)
    window.addEventListener('focus', refresh)
    return () => {
      active = false
      abort.abort()
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  const ownIds = new Set(mine.map((match) => match.id))
  const all = [
    ...new Map(
      [...matches, ...mine].map((match) => [match.id, match]),
    ).values(),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const visible = all.filter((match) => {
    if (filter === 'mine') return ownIds.has(match.id)
    if (filter === 'lobby')
      return (
        match.status === 'lobby' &&
        match.seats.some((seat) => seat.joinable ?? seat.status === 'open')
      )
    if (filter === 'live') return match.status !== 'lobby'
    return true
  })
  const lobbyCount = all.filter((match) => match.status === 'lobby').length
  const liveCount = all.length - lobbyCount

  return (
    <section className="live-feed shell" aria-live="polite">
      <div className="live-feed-toolbar">
        <span>
          <Radio size={14} /> {liveCount} live · {lobbyCount} open lobb
          {lobbyCount === 1 ? 'y' : 'ies'}
        </span>
        <div className="live-filters" aria-label="Filter sessions">
          {(
            [
              'all',
              'lobby',
              'live',
              ...(signedIn ? ['mine' as const] : []),
            ] as const
          ).map((value) => (
            <button
              key={value}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {value === 'all'
                ? 'All sessions'
                : value === 'lobby'
                  ? 'Join now'
                  : value === 'mine'
                    ? 'Your sessions'
                    : 'Watch live'}
            </button>
          ))}
        </div>
        <small>
          {online ? 'Refreshes every 5 seconds' : 'Feed reconnecting…'}
        </small>
      </div>
      {!online ? (
        <p className="error-text" role="status">
          The live feed is reconnecting. Showing the last available sessions.
        </p>
      ) : null}
      {personalError ? (
        <p className="error-text" role="status">
          Your sessions could not be refreshed. Public sessions are still shown.
        </p>
      ) : null}
      {signedIn ? (
        <p className="match-rule-note">
          Your unlisted and private sessions are visible only to you and
          authorized participants.
        </p>
      ) : null}
      {loading ? <p role="status">Loading live sessions…</p> : null}
      <div className="live-grid">
        {visible.map((match) => {
          const occupied = match.seats.filter(
            (seat) => seat.status !== 'open',
          ).length
          return (
            <Link
              className="live-card"
              href={`/play/${match.id}`}
              key={match.id}
            >
              <div className="live-card-art" aria-hidden="true">
                <Gamepad2 size={48} strokeWidth={1} />
                <strong>
                  <Radio size={12} /> {match.status.toUpperCase()}
                </strong>
              </div>
              <div className="live-card-body">
                <span className="card-kicker">
                  {match.mode} · {match.visibility ?? 'unlisted'}
                  {ownIds.has(match.id) ? ' · Your session' : ''}
                </span>
                <h2>{match.gameTitle}</h2>
                <p>{match.summary}</p>
                <div className="live-card-meta">
                  <span>
                    <Users size={13} /> {occupied}/{match.seats.length} seats
                    taken
                  </span>
                  <span>
                    <Eye size={13} /> {match.viewerCount ?? 0} watching
                  </span>
                </div>
                <div
                  className="live-seat-preview"
                  aria-label="Seat availability"
                >
                  {match.seats.map((seat, index) => (
                    <span
                      key={seat.id}
                      className={
                        seat.status === 'open' ? 'is-open' : 'is-taken'
                      }
                      title={`${seat.label ?? `Seat ${index + 1}`} · ${seat.status}${seat.actorId ? ` · ${seat.actorId}` : ''}`}
                    >
                      {seat.label ?? `${seat.role} ${index + 1}`} ·{' '}
                      {seat.status === 'open'
                        ? 'Open'
                        : seat.status === 'disconnected'
                          ? 'Reserved'
                          : 'Taken'}
                      {seat.controllerKind ? ` · ${seat.controllerKind}` : ''}
                    </span>
                  ))}
                </div>
                <strong className="live-card-action">
                  {match.status === 'lobby' &&
                  match.seats.some(
                    (seat) => seat.joinable ?? seat.status === 'open',
                  )
                    ? 'View available seats'
                    : 'Open session'}
                </strong>
              </div>
            </Link>
          )
        })}
        {!loading && online && visible.length === 0 && !personalError ? (
          <article className="live-empty">
            <Radio size={24} />
            <h2>
              {filter === 'mine'
                ? 'No active sessions of your own.'
                : all.length
                  ? 'Nothing in this view.'
                  : 'No public sessions right now.'}
            </h2>
            <p>
              {all.length
                ? 'Try another filter to see the available public sessions.'
                : 'Create a public lobby to appear here. Sign in to find your unlisted and private sessions.'}
            </p>
            <Link className="primary" href="/discover">
              Find a game
            </Link>
          </article>
        ) : null}
      </div>
    </section>
  )
}
