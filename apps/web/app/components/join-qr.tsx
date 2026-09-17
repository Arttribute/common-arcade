'use client'

import { Check, Copy, QrCode } from 'lucide-react'
import { useState } from 'react'
import { encode } from 'uqr'
import { Dialog } from './ui/dialog'

/** Draws the code as one SVG path. The four-module quiet zone is part of the
 *  viewBox, so the code stays scannable on any surface in either theme. */
export function qrPath(text: string) {
  const { data, size } = encode(text, { ecc: 'M', border: 4 })
  let d = ''
  data.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) d += `M${x} ${y}h1v1h-1z`
    }),
  )
  return { d, size }
}

/** Only mounts while the dialog is open, so reading `window` here is safe
 *  during server rendering of the match page. */
function JoinCode() {
  const url = window.location.href
  const [copied, setCopied] = useState(false)
  const { d, size } = qrPath(url)
  return (
    <div className="join-qr">
      <svg
        className="join-qr-code"
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label="QR code linking to this session"
        shapeRendering="crispEdges"
      >
        <rect width={size} height={size} fill="#fff" />
        <path d={d} fill="#0c0a09" />
      </svg>
      <div className="join-qr-link">
        <span title={url}>{url.replace(/^https?:\/\//, '')}</span>
        <button
          className="icon-copy"
          onClick={() =>
            void navigator.clipboard.writeText(url).then(() => {
              setCopied(true)
              window.setTimeout(() => setCopied(false), 1400)
            })
          }
        >
          {copied ? <Check size={16} /> : <Copy size={16} />}
          {copied ? 'Copied' : 'Copy link'}
        </button>
      </div>
    </div>
  )
}

/** Opens a large QR code for the current session page so people nearby can
 *  join from their phones. Sits beside the Share link button. */
export function JoinQrButton() {
  return (
    <Dialog
      className="join-qr-dialog"
      trigger={
        <button
          className="icon-copy icon-only"
          aria-label="Show QR code to join"
          title="Show QR code"
        >
          <QrCode size={16} />
        </button>
      }
      title="Scan to join"
      description="Point a phone camera at the code to open this session."
    >
      <JoinCode />
    </Dialog>
  )
}
