'use client'
import { useState, type CSSProperties } from 'react'
import { Gamepad2 } from 'lucide-react'

export function GameArtwork({
  title,
  src,
  className = '',
}: {
  title: string
  src?: string
  className?: string
}) {
  const [failed, setFailed] = useState<string>()
  const hue = [...title].reduce((n, c) => n + c.charCodeAt(0), 0) % 360
  const safe =
    src &&
    (/^https:\/\//.test(src) ||
      /^\/game-covers\/gam_[a-zA-Z0-9_]+\.jpg$/.test(src) ||
      /^data:image\/(jpeg|png|webp);base64,/.test(src))
  return (
    <div
      className={`game-artwork ${className}`}
      style={{ '--art-hue': hue } as CSSProperties}
    >
      {safe && failed !== src ? (
        <img
          src={src}
          alt={`${title} game artwork`}
          loading="lazy"
          onError={() => setFailed(src)}
        />
      ) : (
        <div
          className="game-artwork-fallback"
          aria-label={`${title} — artwork coming soon`}
        >
          <span className="game-artwork-fallback-icon">
            <Gamepad2 size={30} strokeWidth={1.3} />
          </span>
          <span>{title}</span>
        </div>
      )}
    </div>
  )
}
