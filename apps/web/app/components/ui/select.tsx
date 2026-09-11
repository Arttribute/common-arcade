'use client'
import * as SelectPrimitive from '@radix-ui/react-select'
import { Check, ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'

/**
 * Radix Select composed to match Agent Commons' picker: a bordered trigger the
 * same height as every other control, and a floating list with a check against
 * the current value.
 *
 * Radix owns keyboard navigation, typeahead and focus return. The native
 * <select> it replaces could not show more than a bare label per row.
 */
export function Select({
  value,
  onValueChange,
  placeholder,
  disabled,
  ariaLabel,
  children,
}: {
  value: string
  onValueChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  ariaLabel?: string
  children: ReactNode
}) {
  return (
    <SelectPrimitive.Root
      value={value || undefined}
      onValueChange={onValueChange}
      disabled={disabled}
    >
      <SelectPrimitive.Trigger
        className="ui-select-trigger"
        aria-label={ariaLabel}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon asChild>
          <ChevronDown size={16} aria-hidden />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        {/* `arcade` so the list inherits the app's tokens: Radix portals to
            document.body, outside the shell. */}
        <SelectPrimitive.Content
          className="arcade ui-select-content"
          position="popper"
          sideOffset={6}
        >
          <SelectPrimitive.Viewport className="ui-select-viewport">
            {children}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  )
}

export function SelectOption({
  value,
  disabled,
  title,
  hint,
}: {
  value: string
  disabled?: boolean
  title: string
  hint?: string
}) {
  return (
    <SelectPrimitive.Item
      value={value}
      disabled={disabled}
      className="ui-select-item"
    >
      <span className="ui-select-item-body">
        <SelectPrimitive.ItemText>{title}</SelectPrimitive.ItemText>
        {hint ? <small>{hint}</small> : null}
      </span>
      <SelectPrimitive.ItemIndicator asChild>
        <Check size={15} aria-hidden />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  )
}
