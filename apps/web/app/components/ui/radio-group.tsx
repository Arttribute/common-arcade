'use client'
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group'
import type { ReactNode } from 'react'

/**
 * shadcn composition over Radix RadioGroup, as a stack of selectable rows.
 *
 * Radix owns arrow-key navigation within the group, which a set of loose
 * <input type="radio"> elements only gets when they share a `name`.
 */
export function RadioGroup({
  value,
  onValueChange,
  disabled,
  ariaLabel,
  children,
}: {
  value: string
  onValueChange: (value: string) => void
  disabled?: boolean
  ariaLabel?: string
  children: ReactNode
}) {
  return (
    <RadioGroupPrimitive.Root
      className="ui-radio-group"
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      aria-label={ariaLabel}
    >
      {children}
    </RadioGroupPrimitive.Root>
  )
}

export function RadioOption({
  value,
  title,
  hint,
  disabled,
}: {
  value: string
  title: ReactNode
  hint?: ReactNode
  disabled?: boolean
}) {
  return (
    <label className="ui-radio-option">
      <RadioGroupPrimitive.Item
        className="ui-radio"
        value={value}
        disabled={disabled}
      >
        <RadioGroupPrimitive.Indicator className="ui-radio-indicator" />
      </RadioGroupPrimitive.Item>
      <span className="ui-radio-copy">
        <span>{title}</span>
        {hint ? <small>{hint}</small> : null}
      </span>
    </label>
  )
}
