'use client'
import { useEffect, useState, type ReactNode } from 'react'
import { ChevronUp } from 'lucide-react'

/**
 * Show the latest `pageSize` messages and reveal earlier ones a page at a
 * time, instead of rendering an ever-growing scroll. Change `resetKey` (e.g.
 * the session id) to start a newly opened conversation from its latest page.
 */
export function usePagedMessages<T>(
  items: readonly T[],
  resetKey?: unknown,
  pageSize = 20,
) {
  const [pages, setPages] = useState(1)
  useEffect(() => setPages(1), [resetKey])
  const hidden = Math.max(0, items.length - pages * pageSize)
  return {
    /** Index of the first visible item, for stable keys. */
    offset: hidden,
    hidden,
    visible: items.slice(hidden),
    showEarlier: () => setPages((count) => count + 1),
  }
}

export function EarlierMessages({
  hidden,
  onShow,
}: {
  hidden: number
  onShow: () => void
}) {
  if (hidden <= 0) return null
  return (
    <button type="button" className="chat-earlier" onClick={onShow}>
      <ChevronUp size={13} />
      Show earlier messages ({hidden})
    </button>
  )
}

/**
 * Paged message list: renders the latest page plus a "Show earlier" control.
 * `render` receives each item's index in the full list, for stable keys.
 */
export function PagedMessages<T>({
  items,
  resetKey,
  pageSize,
  render,
}: {
  items: readonly T[]
  resetKey?: unknown
  pageSize?: number
  render: (item: T, index: number) => ReactNode
}) {
  const { visible, hidden, offset, showEarlier } = usePagedMessages(
    items,
    resetKey,
    pageSize,
  )
  return (
    <>
      <EarlierMessages hidden={hidden} onShow={showEarlier} />
      {visible.map((item, index) => render(item, offset + index))}
    </>
  )
}

/** Long replies are clamped behind "Show more" rather than flooding the panel. */
export function MessageText({
  text,
  limit = 900,
}: {
  text: string
  limit?: number
}) {
  const [expanded, setExpanded] = useState(false)
  const long = text.length > limit
  return (
    <>
      <p>{long && !expanded ? `${text.slice(0, limit).trimEnd()}…` : text}</p>
      {long ? (
        <button
          type="button"
          className="chat-more"
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      ) : null}
    </>
  )
}
