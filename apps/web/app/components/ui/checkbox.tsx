'use client'
import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import { Check } from 'lucide-react'
import type { ReactNode } from 'react'

/**
 * shadcn composition over Radix Checkbox. A checkbox is for a value that is
 * part of a form the reader will submit or save; a setting that applies
 * immediately belongs in `Switch` instead.
 */
export function Checkbox({
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
    <CheckboxPrimitive.Root
      id={id}
      className="ui-checkbox"
      checked={checked}
      disabled={disabled}
      aria-label={ariaLabel}
      onCheckedChange={(next) => onCheckedChange(next === true)}
    >
      <CheckboxPrimitive.Indicator className="ui-checkbox-indicator">
        <Check size={12} strokeWidth={3} aria-hidden />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export function CheckboxField({
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
    <label className="ui-checkbox-field">
      <Checkbox
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
      />
      <span className="ui-checkbox-field-copy">
        <span>{label}</span>
        {hint ? <small>{hint}</small> : null}
      </span>
    </label>
  )
}
