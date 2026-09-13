'use client'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import type { ReactNode } from 'react'

/**
 * shadcn composition over Radix Switch: a track that slides a thumb.
 *
 * Use this — never a bare checkbox — for a setting that takes effect the
 * moment it is toggled. A checkbox promises a later Save; a switch does not.
 */
export function Switch({
  checked,
  onCheckedChange,
  disabled,
  id,
  ariaLabel,
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  id?: string
  ariaLabel?: string
}) {
  return (
    <SwitchPrimitive.Root
      id={id}
      className="ui-switch"
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={ariaLabel}
    >
      <SwitchPrimitive.Thumb className="ui-switch-thumb" />
    </SwitchPrimitive.Root>
  )
}

/** A switch with its label and optional description, as one clickable row. */
export function SwitchField({
  checked,
  onCheckedChange,
  disabled,
  label,
  hint,
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  label: ReactNode
  hint?: ReactNode
}) {
  return (
    <label className="ui-switch-field">
      <span className="ui-switch-field-copy">
        <span>{label}</span>
        {hint ? <small>{hint}</small> : null}
      </span>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
      />
    </label>
  )
}
