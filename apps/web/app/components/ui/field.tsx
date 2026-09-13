'use client'
import {
  useId,
  useRef,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react'
import { Upload } from 'lucide-react'

/**
 * The shared form primitives. Every control in the app is one of these, so a
 * text box in Studio, in a dialog and on the game page are the same object at
 * the same height — the one exception is the chat composer, which is its own
 * designed surface.
 */
export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input {...props} className={`ui-input ${props.className ?? ''}`.trim()} />
  )
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`ui-textarea ${props.className ?? ''}`.trim()}
    />
  )
}

/** A labelled control. The label is bound by id, so the control stays a sibling
 *  rather than a child — which is what lets Radix triggers sit here too. */
export function Field({
  label,
  hint,
  htmlFor,
  className = '',
  children,
}: {
  label?: ReactNode
  hint?: ReactNode
  htmlFor?: string
  className?: string
  children: ReactNode
}) {
  return (
    <div className={`ui-field ${className}`.trim()}>
      {label ? (
        <label className="ui-field-label" htmlFor={htmlFor}>
          {label}
        </label>
      ) : null}
      {children}
      {hint ? <p className="ui-field-hint">{hint}</p> : null}
    </div>
  )
}

/**
 * A file picker that reads as a button. The native control renders as
 * "Choose file / No file chosen" in a system font that matches nothing else on
 * the page, so it is kept for behaviour and hidden from view.
 */
export function FilePicker({
  accept,
  label,
  onFile,
  disabled,
}: {
  accept?: string
  label: ReactNode
  onFile: (file: File) => void
  disabled?: boolean
}) {
  const input = useRef<HTMLInputElement>(null)
  const id = useId()
  return (
    <>
      <button
        type="button"
        className="ui-button"
        disabled={disabled}
        onClick={() => input.current?.click()}
        aria-describedby={id}
      >
        <Upload size={14} aria-hidden />
        {label}
      </button>
      <input
        ref={input}
        id={id}
        type="file"
        accept={accept}
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) onFile(file)
          event.target.value = ''
        }}
      />
    </>
  )
}
