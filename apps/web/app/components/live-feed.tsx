'use client'

import type { LiveMatch } from '@common-arcade/control-client'
import { Eye, Radio, Users } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { browserControlClient } from '../../lib/api'

export function LiveFeed() {
  const [matches, setMatches] = useState<readonly LiveMatch[]>([])
  const [online, setOnline] = useState(true)

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

  return (
    <section className="live-feed shell" aria-live="polite">
      <div className="live-feed-toolbar">
        <span>
          <Radio size={14} /> {matches.length} public room
          {matches.length === 1 ? '' : 's'}
        </span>
        <small>
          {online ? 'Refreshes every 5 seconds' : 'Feed reconnecting…'}
        </small>
      </div>
      <div className="live-grid">
        {matches.map((match) => {
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
              </div>
            </Link>
          )
        })}
        {online && matches.length === 0 ? (
          <article className="live-empty">
            <Radio size={24} />
            <h2>The stage is quiet.</h2>
            <p>
              Public matches appear here as soon as a creator opens a lobby.
              Unlisted and private sessions remain off the feed.
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
