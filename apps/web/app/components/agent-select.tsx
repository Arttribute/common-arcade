'use client'
import * as Popover from '@radix-ui/react-popover'
import { Bot, Check, ChevronsUpDown, Search, UserRound } from 'lucide-react'
import {
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react'
import './agent-select.css'

export type SelectableAgent = {
  agentId: string
  name: string
  avatar?: string | null
  modelId?: string | null
}

/** Commons' searchable avatar/name switcher, shared by every Arcade agent choice. */
export function AgentSelect({
  agents,
  value,
  onChange,
  disabled,
  placeholder = 'Choose an agent',
  allowNone,
  noneLabel = 'No agent — I will play',
  compact = false,
  ariaLabel = 'Commons agent',
}: {
  agents: SelectableAgent[]
  value: string
  onChange: (agentId: string) => void
  disabled?: boolean
  placeholder?: string
  allowNone?: boolean
  noneLabel?: string
  compact?: boolean
  ariaLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const search = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const listId = useId()
  const selected = agents.find((agent) => agent.agentId === value)
  const label =
    selected?.name || (!value && allowNone ? noneLabel : placeholder)
  const filtered = agents.filter((agent) =>
    `${agent.name} ${agent.modelId ?? ''}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  )
  const showNone =
    allowNone &&
    (!query.trim() ||
      noneLabel.toLowerCase().includes(query.trim().toLowerCase()))
  function choose(id: string) {
    setOpen(false)
    if (id !== value) onChange(id)
  }
  function navigate(event: KeyboardEvent) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const options = Array.from(
      list.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ??
        [],
    )
    if (!options.length) return
    if (event.target === search.current && ['Home', 'End'].includes(event.key))
      return
    event.preventDefault()
    const index = options.indexOf(document.activeElement as HTMLButtonElement)
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? options.length - 1
          : event.key === 'ArrowDown'
            ? (index + 1) % options.length
            : index < 0
              ? options.length - 1
              : (index - 1 + options.length) % options.length
    options[next]?.focus()
  }
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) setQuery('')
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-controls={listId}
          aria-haspopup="listbox"
          className={`agent-select-trigger ${compact ? 'is-compact' : ''}`}
          title={label}
          disabled={disabled || (!agents.length && !allowNone)}
        >
          {selected ? (
            <AgentAvatar agent={selected} compact={compact} />
          ) : (
            <span className="agent-select-avatar">
              <Bot size={16} />
            </span>
          )}
          <span className="agent-select-identity">
            <span>{label}</span>
            {!compact && selected?.modelId && <small>{selected.modelId}</small>}
          </span>
          <ChevronsUpDown size={14} aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="arcade agent-select-popover"
          aria-label="Choose a Commons agent"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            search.current?.focus()
          }}
          onKeyDown={navigate}
        >
          <div className="agent-select-search">
            <Search size={14} aria-hidden />
            <input
              ref={search}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Switch agent…"
              aria-label="Search agents"
            />
          </div>
          <div
            ref={list}
            id={listId}
            role="listbox"
            aria-label={ariaLabel}
            className="agent-select-list"
          >
            {showNone && (
              <button
                type="button"
                role="option"
                aria-selected={!value}
                onClick={() => choose('')}
              >
                <span className="agent-select-avatar">
                  <UserRound size={16} />
                </span>
                <span className="agent-select-identity">{noneLabel}</span>
                {!value && <Check size={16} />}
              </button>
            )}
            {filtered.map((agent) => (
              <button
                key={agent.agentId}
                type="button"
                role="option"
                aria-selected={agent.agentId === value}
                onClick={() => choose(agent.agentId)}
              >
                <AgentAvatar agent={agent} />
                <span className="agent-select-identity">
                  <span>{agent.name}</span>
                  {agent.modelId && <small>{agent.modelId}</small>}
                </span>
                {agent.agentId === value && <Check size={16} aria-hidden />}
              </button>
            ))}
            {!filtered.length && !showNone && (
              <p className="agent-select-empty" role="status">
                No agents found
              </p>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function AgentAvatar({
  agent,
  compact,
}: {
  agent: SelectableAgent
  compact?: boolean
}) {
  const [failed, setFailed] = useState<string>()
  const src = agent.avatar
  const safe = src && (/^https?:\/\//.test(src) || /^\/(?!\/)/.test(src))
  const hue =
    [...agent.name].reduce(
      (sum, character) => sum + character.charCodeAt(0),
      0,
    ) % 360
  return (
    <span
      className={`agent-select-avatar ${compact ? 'is-compact' : ''}`}
      aria-hidden
      style={
        {
          '--art-hue': hue,
          backgroundColor: `hsl(${hue} 68% 86%)`,
        } as CSSProperties
      }
    >
      {safe && src !== failed ? (
        <img src={src} alt="" onError={() => setFailed(src)} />
      ) : (
        agent.name.slice(0, 3).toLowerCase()
      )}
    </span>
  )
}

export function AgentBadge({ name }: { name: string }) {
  return (
    <span className="agent-badge">
      <Bot size={14} aria-hidden />
      {name}
    </span>
  )
}
