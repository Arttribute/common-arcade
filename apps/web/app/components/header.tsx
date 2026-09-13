'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'
import {
  Compass,
  Radio,
  Hammer,
  Bot,
  BookOpen,
  PanelLeftClose,
} from 'lucide-react'
import { AccountMenu } from './account-menu'
import { Brand } from './brand'
import { SidebarRecents } from './sidebar-recents'

// Every page mounts its own Header, so a preference held only in state starts
// over — expanded — on each navigation, then snaps shut once storage is read.
// Holding it at module scope lets the next page mount already in the reader's
// chosen state. (Null on a fresh load, so server and client markup agree.)
let rememberedPreference: boolean | null = null

export function Header({
  beforeSignOut,
}: { beforeSignOut?: () => Promise<unknown> } = {}) {
  const path = usePathname()
  // `null` until the reader has chosen; until then the landing page opens
  // with the sidebar closed so the hero has the full width, and every other
  // page opens with it expanded.
  const [preference, setPreference] = useState<boolean | null>(
    rememberedPreference,
  )
  // Width transitions start only after the first settle, so restoring a saved
  // preference on a fresh load does not animate the rail open or shut.
  const [settled, setSettled] = useState(rememberedPreference !== null)
  const locked =
    /^\/(games|studio)\/[^/]+/.test(path) || /^\/play\/[^/]+/.test(path)
  const collapsed = locked || (preference ?? path === '/')
  useEffect(() => {
    if (rememberedPreference === null) {
      try {
        const stored = sessionStorage.getItem('arcade-sidebar-collapsed')
        if (stored !== null) {
          rememberedPreference = stored === 'true'
          setPreference(rememberedPreference)
        }
      } catch {}
    }
    const frame = requestAnimationFrame(() => setSettled(true))
    return () => cancelAnimationFrame(frame)
  }, [])
  function toggle() {
    const value = !collapsed
    rememberedPreference = value
    setPreference(value)
    try {
      sessionStorage.setItem('arcade-sidebar-collapsed', String(value))
    } catch {}
  }
  return (
    <nav
      className={`app-sidebar${collapsed ? ' is-collapsed' : ''}${locked ? ' is-locked' : ''}${settled ? ' is-settled' : ''}`}
      aria-label="Main navigation"
    >
      <div className="sidebar-brand-row">
        {collapsed && !locked ? (
          // Closed, the mark itself is the way back in: one control where
          // there used to be a logo stacked over an expand button.
          <button
            type="button"
            className="brand brand-toggle"
            onClick={toggle}
            aria-label="Expand sidebar"
            title="Expand sidebar"
          >
            <Brand />
          </button>
        ) : (
          <Link
            className="brand"
            href="/"
            aria-label="Common Arcade home"
            title="Common Arcade"
          >
            <Brand />
          </Link>
        )}
        {!locked && !collapsed && (
          <button
            className="sidebar-toggle"
            onClick={toggle}
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
          >
            <PanelLeftClose size={16} />
          </button>
        )}
      </div>
      <div className="nav-links">
        {(
          [
            ['/discover', 'Discover', Compass],
            ['/live', 'Live', Radio],
            ['/studio', 'Studio', Hammer],
            ['/agents', 'Agents', Bot],
            ['/docs', 'Docs', BookOpen],
          ] as const
        ).map(([href, title, Icon]) => (
          <Link
            key={href}
            href={href}
            aria-label={title}
            title={title}
            aria-current={path.startsWith(href) ? 'page' : undefined}
          >
            <Icon size={16} strokeWidth={1.75} />
            <span>{title}</span>
          </Link>
        ))}
      </div>
      {!collapsed ? (
        <Suspense fallback={null}>
          <SidebarRecents />
        </Suspense>
      ) : null}
      <div className="sidebar-footer">
        <AccountMenu beforeSignOut={beforeSignOut} />
      </div>
    </nav>
  )
}
