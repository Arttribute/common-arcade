'use client'

import dynamic from 'next/dynamic'
import { memo, useRef, useState } from 'react'
import { Wallet, X } from 'lucide-react'

const PaymentDetails = dynamic(() => import('./live-payment-details'), {
  loading: () => <p role="status">Loading payment controls…</p>,
})

/** A single compact button in the roster; payment controls open in a dialog. */
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
    <section aria-label="Match payments">
      <button
        type="button"
        className="live-payment-button"
        onClick={() => {
          setOpened(true)
          dialog.current?.showModal()
        }}
      >
        <Wallet size={14} />
        Payments & rewards
        <span>Testnet</span>
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
