'use client'
import { Bot } from 'lucide-react'
import { Select, SelectOption } from './ui/select'

/**
 * Commons agent picker, shaped like the one in Agent Commons: a proper
 * dropdown with a placeholder and a check against the current choice, rather
 * than a bare native <select> that can only show a name.
 *
 * Used anywhere a seat, grant or session needs an agent, so the control reads
 * the same everywhere it appears.
 */
export function AgentSelect({
  agents,
  value,
  onChange,
  disabled,
  placeholder = 'Choose an agent',
  allowNone,
  noneLabel = 'No agent — I will play',
}: {
  agents: { agentId: string; name: string }[]
  value: string
  onChange: (agentId: string) => void
  disabled?: boolean
  placeholder?: string
  allowNone?: boolean
  noneLabel?: string
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => onChange(next === NONE ? '' : next)}
      placeholder={placeholder}
      disabled={disabled || (!agents.length && !allowNone)}
      ariaLabel="Commons agent"
    >
      {allowNone && <SelectOption value={NONE} title={noneLabel} />}
      {agents.map((agent) => (
        <SelectOption
          key={agent.agentId}
          value={agent.agentId}
          title={agent.name}
          hint={agent.agentId}
        />
      ))}
    </Select>
  )
}

/* Radix Select forbids an empty-string item value, so "no selection" needs a
 * sentinel that is mapped back to '' on the way out. */
const NONE = '__none__'

export function AgentBadge({ name }: { name: string }) {
  return (
    <span className="agent-badge">
      <Bot size={14} aria-hidden />
      {name}
    </span>
  )
}
