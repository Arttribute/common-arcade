'use client'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ComposerSurface,
  ComposerTextArea,
  type ComposerAttachment,
} from '@agent-commons/ui'
import {
  Plus as PlusIcon,
  ArrowUp as ArrowUpIcon,
  LoaderCircle as SpinnerIcon,
  ChevronDown as ChevronIcon,
  Check as CheckIcon,
  X as CloseIcon,
  File as FileIcon,
} from 'lucide-react'

// Keep Commons' composer structure, with Lucide controls and the shared agent switcher.
function ComposerSelect({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string
  value?: string
  options: readonly { id: string; name: string }[]
  onChange: (id: string) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const container = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const dismiss = (event: Event) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', escape)
    }
  }, [open])
  if (!options.length) return null
  const selected = options.find((option) => option.id === value) ?? options[0]
  return (
    <div className="ac-composer-menu" ref={container}>
      <button
        type="button"
        className="ac-composer-pill"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={`${label}: ${selected?.name ?? ''}`}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="ac-composer-pill-label">{selected?.name}</span>
        <ChevronIcon size={13} />
      </button>
      {open && (
        <div className="ac-composer-popover" role="listbox" aria-label={label}>
          <p className="ac-composer-popover-heading">{label}</p>
          {options.map((option) => (
            <button
              type="button"
              key={option.id}
              role="option"
              aria-selected={option.id === selected?.id}
              onClick={() => {
                onChange(option.id)
                setOpen(false)
              }}
            >
              <span>{option.name}</span>
              {option.id === selected?.id && <CheckIcon size={14} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function ChatComposer({
  value,
  onChange,
  onSubmit,
  disabled,
  busy,
  placeholder = 'What would you like to create?',
  agentPicker,
  models = [],
  modelId,
  onModelChange,
  attachments = [],
  onFiles,
  onRemoveAttachment,
  context,
  footer,
}: {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  disabled?: boolean
  busy?: boolean
  placeholder?: string
  agentPicker?: ReactNode
  models?: readonly { id: string; name: string }[]
  modelId?: string
  onModelChange?: (id: string) => void
  attachments?: readonly ComposerAttachment[]
  onFiles?: (files: File[]) => void
  onRemoveAttachment?: (id: string) => void
  context?: ReactNode
  footer?: ReactNode
}) {
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const uploading = attachments.some((a) => a.status === 'uploading')
  const sendable = Boolean(value.trim()) && !disabled && !busy && !uploading
  return (
    <ComposerSurface
      className={dragging ? 'ac-composer-dragging' : ''}
      onDragOver={(e) => {
        if (!onFiles || busy) return
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node))
          setDragging(false)
      }}
      onDrop={(e) => {
        if (!onFiles || busy) return
        e.preventDefault()
        setDragging(false)
        onFiles(Array.from(e.dataTransfer.files))
      }}
    >
      {context && <div className="ac-composer-context">{context}</div>}
      {!!attachments.length && (
        <div className="ac-composer-attachments">
          {attachments.map((a) => (
            <span
              key={a.id}
              className={`ac-attachment ${a.status === 'error' ? 'ac-attachment-error' : ''}`}
            >
              <span className="ac-attachment-icon">
                {a.status === 'uploading' ? (
                  <SpinnerIcon size={14} className="ac-spin" />
                ) : (
                  <FileIcon size={14} />
                )}
              </span>
              <span className="ac-attachment-text">
                <span className="ac-attachment-name">{a.name}</span>
                <span className="ac-attachment-status">
                  {a.status === 'uploading'
                    ? 'Uploading…'
                    : a.status === 'error'
                      ? 'Upload failed'
                      : 'Attached'}
                </span>
              </span>
              {onRemoveAttachment && (
                <button
                  type="button"
                  title={`Remove ${a.name}`}
                  aria-label={`Remove ${a.name}`}
                  onClick={() => onRemoveAttachment(a.id)}
                >
                  <CloseIcon size={13} />
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      <ComposerTextArea
        aria-label="Message your agent"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            if (sendable) onSubmit()
          }
        }}
      />
      <div className="ac-composer-controls">
        {onFiles && (
          <>
            <input
              ref={input}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files) onFiles(Array.from(e.target.files))
                e.target.value = ''
              }}
            />
            <button
              type="button"
              className="ac-tool-button"
              aria-label="Add files and media"
              title="Add files and media"
              disabled={disabled || busy}
              onClick={() => input.current?.click()}
            >
              <PlusIcon size={16} />
            </button>
          </>
        )}
        {agentPicker}
        <span className="ac-composer-spacer" />
        {footer}
        {onModelChange && (
          <ComposerSelect
            label="Model"
            value={modelId}
            options={models}
            onChange={onModelChange}
            disabled={disabled || busy}
          />
        )}
        <button
          type="button"
          className="ac-composer-send"
          aria-label={busy ? 'Agent is working' : 'Send message'}
          title={busy ? 'Agent is working' : 'Send message'}
          disabled={!sendable}
          onClick={onSubmit}
        >
          {busy || uploading ? (
            <SpinnerIcon size={16} className="ac-spin" />
          ) : (
            <ArrowUpIcon size={16} />
          )}
        </button>
      </div>
    </ComposerSurface>
  )
}
