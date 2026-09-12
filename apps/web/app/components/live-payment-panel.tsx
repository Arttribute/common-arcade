'use client'

import dynamic from 'next/dynamic'
import { memo, useRef, useState } from 'react'
import { Wallet, X } from 'lucide-react'

const PaymentDetails = dynamic(() => import('./live-payment-details'), {
  loading: () => <p role="status">Loading payment controls…</p>,
})

export const LivePaymentPanel = memo(function LivePaymentPanel({
  releaseId,
  matchId,
  agentId,
}: {
  releaseId: string
  matchId: string
  agentId?: string
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [opened, setOpened] = useState(false)
  return (
    <section className="live-payment-card" aria-label="Match payments">
      <div>
        <Wallet size={16} />
        <strong>Payments & rewards</strong>
      </div>
      <p>
        {matchId
          ? 'This session is free to play.'
          : 'Choose free play or view paid match options.'}
      </p>
      <button
        className="secondary compact"
        onClick={() => {
          setOpened(true)
          dialog.current?.showModal()
        }}
      >
        Open payment controls
      </button>
      <dialog
        className="live-payment-dialog"
        ref={dialog}
        aria-label="Payments and rewards"
        onClose={() => setOpened(false)}
      >
        <header>
          <div>
            <span className="eyebrow">TESTNET PAYMENTS</span>
            <h2>Payments & rewards</h2>
          </div>
          <button
            type="button"
            className="secondary compact"
            aria-label="Close payment controls"
            onClick={() => dialog.current?.close()}
          >
            <X size={18} />
          </button>
        </header>
        {opened && (
          <PaymentDetails
            releaseId={releaseId}
            matchId={matchId}
            agentId={agentId}
          />
        )}
      </dialog>
    </section>
  )
})
