'use client'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'

// shadcn composition: Radix owns focus trapping, Escape and focus restoration.
export function Dialog({
  trigger,
  title,
  description,
  children,
}: {
  trigger: ReactNode
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <DialogPrimitive.Root>
      <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="dialog-overlay" />
        <DialogPrimitive.Content className="dialog-content">
          <header>
            <DialogPrimitive.Title>{title}</DialogPrimitive.Title>
            {description && (
              <DialogPrimitive.Description>
                {description}
              </DialogPrimitive.Description>
            )}
          </header>
          {children}
          <DialogPrimitive.Close className="dialog-close" aria-label="Close">
            <X size={18} />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
