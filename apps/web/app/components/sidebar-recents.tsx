'use client'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { StudioProject } from '@common-arcade/studio'
import { arcade } from '../../lib/api'

type CopilotSession = {
  sessionId: string
  agentId: string
  title?: string
  createdAt: string
  updatedAt?: string
}
type BrowserRun = { id: string; createdAt: string }
type Recent = { key: string; title: string; href: string; at: string }

// Sessions are listed per project, so Recents reads the most recently touched
// projects only — enough to fill the list without a request per project.
const PROJECT_LIMIT = 8
const RECENT_LIMIT = 20

async function loadRecents(): Promise<Recent[]> {
  const { projects } = await arcade<{ projects: StudioProject[] }>('projects')
  const recent = [...projects]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, PROJECT_LIMIT)
  const perProject = await Promise.all(
    recent.map(async (project) => {
      const game = project.document.title || 'Untitled game'
      const [chats, runs] = await Promise.all([
        arcade<{ sessions: CopilotSession[] }>(
          `projects/${project.id}/copilot-sessions`,
        ).catch(() => ({ sessions: [] })),
        arcade<{ runs: BrowserRun[] }>(
          `projects/${project.id}/browser-runs`,
        ).catch(() => ({ runs: [] })),
      ])
      return [
        ...chats.sessions.map((session) => ({
          key: `chat:${session.sessionId}`,
          title: session.title || game,
          href: `/studio/${project.id}?session=${encodeURIComponent(session.sessionId)}&agent=${encodeURIComponent(session.agentId)}`,
          at: session.updatedAt ?? session.createdAt,
        })),
        ...runs.runs.map((run) => ({
          key: `run:${run.id}`,
          title: `${game} playtest`,
          href: `/studio/${project.id}?run=${encodeURIComponent(run.id)}`,
          at: run.createdAt,
        })),
      ]
    }),
  )
  return perProject
    .flat()
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, RECENT_LIMIT)
}

/**
 * Recents, like the Agent Commons dashboard: the reader's latest Studio work —
 * game-building conversations with their copilot and playtest sessions —
 * newest first, each opening straight back into Studio. One line per item,
 * the title and nothing else. Signed-out readers see nothing here.
 */
export function SidebarRecents() {
  const path = usePathname()
  const search = useSearchParams()
  const [recents, setRecents] = useState<Recent[] | null>(null)
  const [signedIn, setSignedIn] = useState(true)

  useEffect(() => {
    let active = true
    const refresh = async () => {
      try {
        const session = await fetch('/api/auth/session').then((response) =>
          response.json(),
        )
        if (!active) return
        if (!session.user) {
          setSignedIn(false)
          return
        }
        setSignedIn(true)
        const next = await loadRecents()
        if (active) setRecents(next)
      } catch {
        if (active) setRecents((current) => current ?? [])
      }
    }
    void refresh()
    window.addEventListener('focus', refresh)
    return () => {
      active = false
      window.removeEventListener('focus', refresh)
    }
    // Studio work changes as the reader moves around, so re-read on navigation.
  }, [path])

  if (!signedIn) return null
  const here = `${path}?${search.toString()}`
  return (
    <section className="sidebar-recents" aria-label="Recent Studio sessions">
      <div className="sidebar-recents-label">
        <span>Recents</span>
        {recents === null ? (
          <Loader2 size={12} className="spin" aria-hidden />
        ) : null}
      </div>
      <div className="sidebar-recents-list">
        {recents === null ? (
          [0, 1, 2].map((index) => (
            <span
              key={index}
              className="sidebar-recents-skeleton"
              style={{ opacity: 1 - index * 0.25 }}
            />
          ))
        ) : recents.length === 0 ? (
          <p className="sidebar-recents-empty">
            Your Studio conversations and playtests will appear here.
          </p>
        ) : (
          recents.map((recent) => (
            <Link
              key={recent.key}
              href={recent.href}
              className="sidebar-recent"
              aria-current={here === recent.href ? 'page' : undefined}
              title={recent.title}
            >
              {recent.title}
            </Link>
          ))
        )}
      </div>
    </section>
  )
}
