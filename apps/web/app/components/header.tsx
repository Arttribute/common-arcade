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
  PanelLeftOpen,
} from 'lucide-react'
import { AccountMenu } from './account-menu'
import { Brand } from './brand'
import { SidebarRecents } from './sidebar-recents'

export function Header({
  beforeSignOut,
}: { beforeSignOut?: () => Promise<unknown> } = {}) {
  const path = usePathname()
  // `null` until the reader has chosen; until then the landing page opens
  // with the sidebar closed so the hero has the full width, and every other
  // page opens with it expanded.
  const [preference, setPreference] = useState<boolean | null>(null)
  const locked =
    /^\/(games|studio)\/[^/]+/.test(path) || /^\/play\/[^/]+/.test(path)
  const collapsed = locked || (preference ?? path === '/')
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem('arcade-sidebar-collapsed')
      if (stored !== null) setPreference(stored === 'true')
    } catch {}
  }, [])
  function toggle() {
    const value = !collapsed
    setPreference(value)
    try {
      sessionStorage.setItem('arcade-sidebar-collapsed', String(value))
    } catch {}
  }
  return (
    <nav
      className={`app-sidebar${collapsed ? ' is-collapsed' : ''}${locked ? ' is-locked' : ''}`}
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
            <PanelLeftOpen
              size={16}
              className="brand-toggle-hint"
              aria-hidden
            />
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
