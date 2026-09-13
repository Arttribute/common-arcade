import { Gamepad2 } from 'lucide-react'

/**
 * The Arcade mark: a gamepad on the signature tangerine tile. It is the only
 * logo — the same mark in the sidebar, the Studio rail and the favicon — so
 * the product is recognisable at every size without a wordmark.
 */
export function Brand({ size = 28 }: { size?: number }) {
  return (
    <span
      className="arcade-logo"
      style={{ width: size, height: size }}
      aria-hidden
    >
      <Gamepad2 size={Math.round(size * 0.64)} strokeWidth={2} />
    </span>
  )
}
