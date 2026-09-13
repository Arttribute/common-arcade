'use client'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import type { ReactNode } from 'react'

/**
 * shadcn composition over Radix Tabs, in two looks that share one behaviour:
 *
 *   - `segmented` (default) — a pill track, for filtering a list in place.
 *   - `underline` — for switching what a panel is showing.
 *
 * Both are neutral: the selected tab is marked with the foreground colour and
 * a raised surface, never a coloured wash.
 */
export function Tabs({
  value,
  onValueChange,
  ariaLabel,
  variant = 'segmented',
  className = '',
  children,
}: {
  value: string
  onValueChange: (value: string) => void
  ariaLabel?: string
  variant?: 'segmented' | 'underline'
  className?: string
  children: ReactNode
}) {
  return (
    <TabsPrimitive.Root value={value} onValueChange={onValueChange}>
      <TabsPrimitive.List
        className={`ui-tabs ui-tabs-${variant} ${className}`.trim()}
        aria-label={ariaLabel}
      >
        {children}
      </TabsPrimitive.List>
    </TabsPrimitive.Root>
  )
}

export function Tab({
  value,
  children,
  count,
  ariaLabel,
  title,
}: {
  value: string
  children: ReactNode
  count?: number
  ariaLabel?: string
  title?: string
}) {
  return (
    <TabsPrimitive.Trigger
      className="ui-tab"
      value={value}
      aria-label={ariaLabel}
      title={title}
    >
      {children}
      {count ? <span className="ui-tab-count">{count}</span> : null}
    </TabsPrimitive.Trigger>
  )
}
