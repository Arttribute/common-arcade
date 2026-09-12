'use client'
import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'fumadocs-ui/provider/base'

/**
 * Light/dark switch. The theme itself lives in fumadocs' RootProvider
 * (next-themes). `compact` renders icon-only, for narrow rails.
 */
export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { resolvedTheme, setTheme } = useTheme()
  // The server can't know the visitor's theme; render the light label until mounted.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const dark = mounted && resolvedTheme === 'dark'
  const label = dark ? 'Switch to light mode' : 'Switch to dark mode'
  return (
    <button
      type="button"
      className={compact ? 'theme-toggle compact' : 'theme-toggle'}
      aria-label={label}
      title={compact ? label : undefined}
      onClick={() => setTheme(dark ? 'light' : 'dark')}
    >
      {dark ? (
        <Sun size={compact ? 18 : 15} />
      ) : (
        <Moon size={compact ? 18 : 15} />
      )}
      {compact ? null : <span>{dark ? 'Light mode' : 'Dark mode'}</span>}
    </button>
  )
}
