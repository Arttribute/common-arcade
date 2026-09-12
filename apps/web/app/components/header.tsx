'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
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

export function Header({
  beforeSignOut,
}: { beforeSignOut?: () => Promise<unknown> } = {}) {
  const path = usePathname()
  const [preference, setPreference] = useState(false)
  const locked =
    /^\/(games|studio)\/[^/]+/.test(path) || /^\/play\/[^/]+/.test(path)
  const collapsed = locked || preference
  useEffect(() => {
    try {
      setPreference(
        sessionStorage.getItem('arcade-sidebar-collapsed') === 'true',
      )
    } catch {}
  }, [])
  function toggle() {
    const value = !preference
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
        <Link
          className="brand"
          href="/"
          aria-label="Common Arcade"
          title="Common Arcade"
        >
          <span className="brand-expanded">
            <Brand />
          </span>
          <span className="brand-collapsed">
            <Brand compact />
          </span>
        </Link>
        {!locked && (
          <button
            className="sidebar-toggle"
            onClick={toggle}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? (
              <PanelLeftOpen size={16} />
            ) : (
              <PanelLeftClose size={16} />
            )}
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
      <div className="sidebar-footer">
        <AccountMenu beforeSignOut={beforeSignOut} />
      </div>
    </nav>
  )
}
