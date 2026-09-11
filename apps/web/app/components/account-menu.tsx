'use client'
import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import {
  Bot,
  ChevronsUpDown,
  ExternalLink,
  LogIn,
  LogOut,
  UserRound,
} from 'lucide-react'

type Account = { id: string; name: string }
export function AccountMenu({
  user: supplied,
  beforeSignOut,
}: {
  user?: Account | null
  beforeSignOut?: () => Promise<unknown>
}) {
  const [user, setUser] = useState<Account | null>(supplied ?? null)
  const [loading, setLoading] = useState(supplied === undefined)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const menu = useRef<HTMLDetailsElement>(null),
    pathname = usePathname()
  useEffect(() => {
    if (supplied !== undefined) {
      setUser(supplied)
      setLoading(false)
      return
    }
    const controller = new AbortController()
    void fetch('/api/auth/session', { signal: controller.signal })
      .then((r) => r.json())
      .then((s) => setUser(s.user))
      .catch(() => undefined)
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [supplied])
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (menu.current && !menu.current.contains(event.target as Node))
        menu.current.open = false
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && menu.current?.open) {
        menu.current.open = false
        menu.current.querySelector('summary')?.focus()
      }
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', escape)
    }
  }, [])
  async function signOut() {
    setBusy(true)
    setError('')
    try {
      await beforeSignOut?.()
      const response = await fetch('/api/auth/logout', { method: 'POST' })
      if (!response.ok) throw Error('Could not sign out. Please try again.')
      window.location.assign('/')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not sign out.')
      setBusy(false)
    }
  }
  if (loading)
    return (
      <span className="arcade-account-loading" aria-label="Loading account">
        <UserRound size={16} />
      </span>
    )
  if (!user)
    return (
      <a
        className="arcade-sign-in"
        href={`/api/auth/login?next=${encodeURIComponent(pathname || '/studio')}`}
      >
        <LogIn size={16} />
        {/* Wrapped so the collapsed rail can clip the label without taking the
            link's accessible name away with it. */}
        <span>Sign in</span>
      </a>
    )
  return (
    <details ref={menu} className="arcade-account">
      <summary
        aria-label={`Account: ${user.name}`}
        title="Your Commons account"
      >
        <span className="arcade-avatar">
          {user.name.trim().slice(0, 1).toUpperCase() || (
            <UserRound size={14} />
          )}
        </span>
        <span className="arcade-account-name">{user.name}</span>
        <ChevronsUpDown size={14} />
      </summary>
      <div className="arcade-account-popover">
        <strong>{user.name}</strong>
        <small>Signed in</small>
        <a href="/agents">
          <Bot size={16} />
          My agents
        </a>
        <a href="https://www.agentcommons.io">
          <ExternalLink size={16} />
          Open Commons
        </a>
        <button type="button" disabled={busy} onClick={() => void signOut()}>
          <LogOut size={16} />
          {busy ? 'Signing out…' : 'Log out'}
        </button>
        {error && <p role="alert">{error}</p>}
      </div>
    </details>
  )
}
