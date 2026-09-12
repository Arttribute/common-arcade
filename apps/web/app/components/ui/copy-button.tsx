'use client'
import { useEffect, useState } from 'react'
import { Check, Copy } from 'lucide-react'

/** Copies `text` and briefly confirms, so every copy action in Arcade behaves the same. */
export function CopyButton({
  text,
  label = 'Copy',
  copiedLabel = 'Copied',
  onError,
}: {
  text: string
  label?: string
  copiedLabel?: string
  onError?: (message: string) => void
}) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(timer)
  }, [copied])
  return (
    <button
      type="button"
      className="copy-button"
      onClick={() => {
        void navigator.clipboard
          .writeText(text)
          .then(() => setCopied(true))
          .catch(() => onError?.('Could not copy. Select the text instead.'))
      }}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
      {copied ? copiedLabel : label}
    </button>
  )
}
