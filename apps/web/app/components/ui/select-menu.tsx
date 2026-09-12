'use client'
import * as Popover from '@radix-ui/react-popover'
import { Check, ChevronsUpDown, Search } from 'lucide-react'
import {
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react'

export type SelectMenuOption = {
  value: string
  label: string
  /** Secondary line, e.g. an agent's model or a network's asset. */
  description?: string
  /** `true` shows a generated initial avatar (agents, people); a node is shown as-is. */
  avatar?: boolean | ReactNode
  disabled?: boolean
}

// Lists longer than this get a search box, like Agent Commons' agent switcher.
const SEARCH_THRESHOLD = 7

/**
 * Arcade's single selector, in the style of Agent Commons' agent switcher: a
 * trigger showing the current choice, opening a popover list with an optional
 * search box. Used everywhere a native <select> used to be so every picker
 * looks and behaves the same. Radix owns focus, Escape and outside clicks.
 */
export function SelectMenu({
  value,
  options,
  onChange,
  label,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  emptyText = 'No matches',
  compact = false,
  disabled = false,
  className,
}: {
  value: string
  options: readonly SelectMenuOption[]
  onChange: (value: string) => void
  /** Accessible name; omit when the menu sits inside a visible <label>. */
  label?: string
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  /** A small inline pill instead of a full-width field. */
  compact?: boolean
  disabled?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const current = options.find((option) => option.value === value)
  const searchable = options.length > SEARCH_THRESHOLD

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((option) =>
      `${option.label} ${option.description ?? ''}`.toLowerCase().includes(q),
    )
  }, [options, query])

  function setMenuOpen(next: boolean) {
    setOpen(next)
    if (!next) setQuery('')
  }

  function choose(next: string) {
    setMenuOpen(false)
    if (next !== value) onChange(next)
  }

  function moveFocus(event: KeyboardEvent) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const items = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>(
        'button:not(:disabled)',
      ) ?? [],
    )
    if (items.length === 0) return
    event.preventDefault()
    const at = items.indexOf(document.activeElement as HTMLButtonElement)
    const next =
      event.key === 'ArrowDown'
        ? (at + 1) % items.length
        : at <= 0
          ? items.length - 1
          : at - 1
    items[next]?.focus()
  }

  return (
    <Popover.Root open={open} onOpenChange={setMenuOpen}>
      <Popover.Trigger asChild disabled={disabled}>
        <button
          type="button"
          className={[
            'select-menu-trigger',
            compact ? 'compact' : '',
            className ?? '',
          ]
            .filter(Boolean)
            .join(' ')}
          aria-label={label}
          aria-haspopup="listbox"
        >
          {current?.avatar ? <OptionAvatar option={current} /> : null}
          <span className="select-menu-text">
            <span className="select-menu-label">
              {current?.label ?? placeholder}
            </span>
            {!compact && current?.description ? (
              <span className="select-menu-description">
                {current.description}
              </span>
            ) : null}
          </span>
          <ChevronsUpDown size={14} aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="select-menu-content"
          align="start"
          sideOffset={6}
          onKeyDown={moveFocus}
          onOpenAutoFocus={(event) => {
            // Without a search box, start on the current choice rather than the first row.
            if (searchable) return
            const selected = listRef.current?.querySelector<HTMLButtonElement>(
              '[aria-selected="true"]',
            )
            if (selected) {
              event.preventDefault()
              selected.focus()
            }
          }}
        >
          {searchable ? (
            <div className="select-menu-search">
              <Search size={13} aria-hidden="true" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
              />
            </div>
          ) : null}
          <div
            ref={listRef}
            className="select-menu-list"
            role="listbox"
            aria-label={label}
          >
            {filtered.length === 0 ? (
              <p className="select-menu-empty">{emptyText}</p>
            ) : (
              filtered.map((option) => {
                const selected = option.value === value
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    disabled={option.disabled}
                    className="select-menu-item"
                    onClick={() => choose(option.value)}
                  >
                    {option.avatar ? <OptionAvatar option={option} /> : null}
                    <span className="select-menu-text">
                      <span className="select-menu-label">{option.label}</span>
                      {option.description ? (
                        <span className="select-menu-description">
                          {option.description}
                        </span>
                      ) : null}
                    </span>
                    {selected ? <Check size={14} aria-hidden="true" /> : null}
                  </button>
                )
              })
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function OptionAvatar({ option }: { option: SelectMenuOption }) {
  if (option.avatar && option.avatar !== true)
    return <span className="select-menu-avatar">{option.avatar}</span>
  // Deterministic hue per name, so the same agent always gets the same colour.
  let hue = 0
  for (const character of option.label)
    hue = (hue * 31 + character.charCodeAt(0)) % 360
  return (
    <span
      className="select-menu-avatar initial"
      style={{ '--avatar-hue': hue } as CSSProperties}
      aria-hidden="true"
    >
      {option.label.trim().slice(0, 1).toUpperCase() || '?'}
    </span>
  )
}
