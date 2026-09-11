'use client'
import { useEffect, useState } from 'react'
// `provider/next` only exports RootProvider; the theme hook lives on the base
// provider, which re-exports next-themes' own useTheme.
import { useTheme } from 'fumadocs-ui/provider/base'
import { Monitor, Moon, Sun } from 'lucide-react'

// `label` is what fits in the sidebar's third of a column; `name` is the
// accessible name, which stays explicit.
const OPTIONS = [
  ['light', 'Light', 'Light', Sun],
  ['dark', 'Dark', 'Dark', Moon],
  ['system', 'Auto', 'System', Monitor],
] as const

/**
 * Light / dark / system switch.
 *
 * `next-themes` is already mounted by fumadocs' RootProvider, so this only
 * drives it — there is no second theme system. It writes `class="dark"` on
 * <html>, which is what the `.dark` palette in tokens.css responds to.
 *
 * It lives in the sidebar footer beside the account menu: reachable from every
 * screen, in the place people look for preferences, and in the tab order right
 * before the account controls rather than buried in a menu.
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  // The resolved theme is unknown until the client mounts. Rendering the group
  // unpressed until then keeps server and client markup identical.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  return (
    <div className="theme-toggle" role="group" aria-label="Colour theme">
      {OPTIONS.map(([value, label, name, Icon]) => (
        <button
          key={value}
          type="button"
          aria-label={name}
          title={`${name} theme`}
          aria-pressed={mounted ? theme === value : undefined}
          onClick={() => setTheme(value)}
        >
          <Icon size={15} />
          <span>{label}</span>
        </button>
      ))}
    </div>
  )
}
