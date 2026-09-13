'use client'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatUnits } from 'viem'
import type { EconomyConfig } from '@common-arcade/economy'
import { hostPaidSession } from '../../lib/paid-session'
import { browserControlClient } from '../../lib/api'

/** Compatibility for old host links: open the game first, with no wallet connection gate. */
export function PaidSessionEntry({
  releaseId,
  initialEconomy = { mode: 'free' },
}: {
  releaseId: string
  initialEconomy?: EconomyConfig
}) {
  const router = useRouter()
  const id = useRef<string>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function host() {
    if (busy) return
    setBusy(true)
    try {
      id.current ??= crypto.randomUUID()
      const match =
        initialEconomy.mode === 'escrow'
          ? await hostPaidSession({
              id: id.current,
              releaseId,
              economy: initialEconomy,
            })
          : await browserControlClient().createMatch({
              releaseId,
              visibility: 'unlisted',
            })
      router.replace(
        `/play/${match.id}${initialEconomy.mode === 'escrow' ? '?paid=1' : ''}`,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open this game')
      setBusy(false)
    }
  }
  return (
    <div className="match-shell">
      <aside className="match-panel live-player-panel">
        <strong>Start a live session</strong>
        <p className="match-rule-note">
          {initialEconomy.mode === 'escrow'
            ? `${formatUnits(BigInt(initialEconomy.stakeUnits), 6)} test USDC per seat. Players pay when they take a seat.`
            : 'Free to play.'}
        </p>
        <button className="primary" disabled={busy} onClick={() => void host()}>
          {busy ? 'Opening session…' : 'Host a live session'}
        </button>
        {error && <p role="alert">{error}</p>}
      </aside>
      <section className="game-stage">
        <div className="live-stage-view">
          <iframe
            className="live-game-frame"
            src={`/api/arcade/v1/studio/releases/${encodeURIComponent(releaseId)}/preview`}
            title="Game preview"
            sandbox="allow-scripts"
          />
        </div>
      </section>
    </div>
  )
}
