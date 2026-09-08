'use client'

import type { LiveMatch } from '@common-arcade/control-client'
import { Eye, Radio, Users } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { browserControlClient } from '../../lib/api'

export function LiveFeed() {
  const [matches, setMatches] = useState<readonly LiveMatch[]>([])
  const [online, setOnline] = useState(true)
  const [filter, setFilter] = useState<'all' | 'lobby' | 'live'>('all')

  useEffect(() => {
    let active = true
    const refresh = async () => {
      try {
        const next = await browserControlClient().listLiveMatches()
        if (active) {
          setMatches(next)
          setOnline(true)
        }
      } catch {
        if (active) setOnline(false)
      }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 5000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [])

  const visible = matches.filter((match) => {
    if (filter === 'lobby') return match.status === 'lobby'
    if (filter === 'live') return match.status !== 'lobby'
    return true
  })
  const lobbyCount = matches.filter((match) => match.status === 'lobby').length
  const liveCount = matches.length - lobbyCount

  return (
    <section className="live-feed shell" aria-live="polite">
      <div className="live-feed-toolbar">
        <span>
          <Radio size={14} /> {liveCount} live · {lobbyCount} open lobb
          {lobbyCount === 1 ? 'y' : 'ies'}
        </span>
        <div className="live-filters" aria-label="Filter sessions">
          {(['all', 'lobby', 'live'] as const).map((value) => (
            <button
              key={value}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {value === 'all'
                ? 'All sessions'
                : value === 'lobby'
                  ? 'Join now'
                  : 'Watch live'}
            </button>
          ))}
        </div>
        <small>
          {online ? 'Refreshes every 5 seconds' : 'Feed reconnecting…'}
        </small>
      </div>
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
                <span>× ○ ×</span>
                <strong>
                  <Radio size={12} /> {match.status.toUpperCase()}
                </strong>
              </div>
              <div className="live-card-body">
                <span className="card-kicker">{match.mode}</span>
                <h2>{match.gameTitle}</h2>
                <p>{match.summary}</p>
                <div className="live-card-meta">
                  <span>
                    <Users size={13} /> {occupied}/{match.seats.length} seats
                  </span>
                  <span>
                    <Eye size={13} /> {match.viewerCount ?? 0} watching
                  </span>
                </div>
                <strong className="live-card-action">
                  {match.status === 'lobby'
                    ? 'Join open lobby'
                    : 'Watch session'}
                </strong>
              </div>
            </Link>
          )
        })}
        {online && visible.length === 0 ? (
          <article className="live-empty">
            <Radio size={24} />
            <h2>
              {matches.length ? 'Nothing in this view.' : 'The stage is quiet.'}
            </h2>
            <p>
              {matches.length
                ? 'Try another filter to see the available public sessions.'
                : 'Public matches appear here as soon as a creator opens a lobby. Unlisted and private sessions remain off the feed.'}
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
