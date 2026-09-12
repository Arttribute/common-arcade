import { Gamepad2 } from 'lucide-react'

export function Brand({ compact = false }: { compact?: boolean }) {
  return compact ? (
    <span className="arcade-brand-icon">
      <Gamepad2 size={18} strokeWidth={1.75} />
    </span>
  ) : (
    <span className="arcade-wordmark">
      <span>Common</span>
      <span>Arcade</span>
    </span>
  )
}
