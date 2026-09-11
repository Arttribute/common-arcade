'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Compass, Radio, Hammer, Bot, BookOpen, Gamepad2 } from 'lucide-react'
import { AccountMenu } from './account-menu'

export function Header() {
  const path = usePathname()
  return (
    <nav className="app-sidebar" aria-label="Main navigation">
      <Link className="brand" href="/">
        <span className="brand-mark">
          <Gamepad2 size={22} />
        </span>
        <span>
          Common
          <br />
          Arcade
        </span>
      </Link>
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
            aria-current={path.startsWith(href) ? 'page' : undefined}
          >
            <Icon size={18} />
            <span>{title}</span>
          </Link>
        ))}
      </div>
      <div className="sidebar-footer">
        <AccountMenu />
      </div>
    </nav>
  )
}
