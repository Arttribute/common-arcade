'use client'
import type { LiveMatch } from '@common-arcade/control-client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { browserControlClient } from '../../lib/api'

/**
 * Recent sessions in the sidebar, like the Recents list on the Agent Commons
 * dashboard: the signed-in player's own sessions — ones they host or hold a
 * seat in — newest activity first. Signed-out readers see nothing here.
 */
export function SidebarRecents() {
  const path = usePathname()
  const [sessions, setSessions] = useState<readonly LiveMatch[] | null>(null)
  const [signedIn, setSignedIn] = useState(false)

  useEffect(() => {
    let active = true
    const abort = new AbortController()
    const refresh = async () => {
      try {
        const session = await fetch('/api/auth/session', {
          signal: abort.signal,
        }).then((response) => response.json())
        if (!active) return
        setSignedIn(Boolean(session.user))
        if (!session.user) return setSessions([])
        const mine = await browserControlClient().listLiveMatches(
          abort.signal,
          'mine',
        )
        if (active) setSessions(mine)
      } catch {
        if (active) setSessions((current) => current ?? [])
      }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 15000)
    window.addEventListener('focus', refresh)
    return () => {
      active = false
      abort.abort()
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  if (!signedIn && sessions !== null) return null
  const current = path.match(/^\/play\/([^/]+)/)?.[1]
  return (
    <section className="sidebar-recents" aria-label="Recent sessions">
      <div className="sidebar-recents-label">
        <span>Recents</span>
        {sessions === null ? (
          <Loader2 size={12} className="spin" aria-hidden />
        ) : null}
      </div>
      <div className="sidebar-recents-list">
        {sessions === null ? (
          [0, 1, 2].map((index) => (
            <span
              key={index}
              className="sidebar-recents-skeleton"
              style={{ opacity: 1 - index * 0.25 }}
            />
          ))
        ) : sessions.length === 0 ? (
          <p className="sidebar-recents-empty">
            Sessions you host or join will appear here.
          </p>
        ) : (
          sessions.slice(0, 20).map((match) => (
            <Link
              key={match.id}
              href={`/play/${match.id}`}
              className="sidebar-recent"
              aria-current={match.id === current ? 'page' : undefined}
              title={match.gameTitle}
            >
              <span
                className="sidebar-recent-dot"
                data-live={match.status === 'running' ? 'yes' : 'no'}
                aria-hidden
              />
              <span className="sidebar-recent-title">{match.gameTitle}</span>
              <span className="sidebar-recent-status">
                {match.status === 'running' ? 'Live' : 'Lobby'}
              </span>
            </Link>
          ))
        )}
      </div>
    </section>
  )
}
