'use client'
import { useState, type CSSProperties } from 'react'
import {
  Gamepad2,
  Hourglass,
  Shuffle,
  Users,
  Zap,
  type LucideIcon,
} from 'lucide-react'

// Placeholders say what kind of game it is, rather than repeating the title.
const MODE_ICONS: Record<string, LucideIcon> = {
  realtime: Zap,
  'turn-based': Hourglass,
  simultaneous: Users,
  hybrid: Shuffle,
}

export function GameArtwork({
  title,
  src,
  mode,
  className = '',
}: {
  title: string
  src?: string
  /** The game's play mode, used to pick the placeholder icon. */
  mode?: string
  className?: string
}) {
  const [failed, setFailed] = useState<string>()
  const hue = [...title].reduce((n, c) => n + c.charCodeAt(0), 0) % 360
  const safe =
    src &&
    (/^https:\/\//.test(src) ||
      /^\/game-covers\/gam_[a-zA-Z0-9_]+\.jpg$/.test(src) ||
      /^data:image\/(jpeg|png|webp);base64,/.test(src))
  const Icon = (mode && MODE_ICONS[mode]) || Gamepad2
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
          role="img"
          aria-label={`${title} — artwork coming soon`}
        >
          <Icon size={32} strokeWidth={1.4} />
          <span>{title}</span>
        </div>
      )}
    </div>
  )
}
