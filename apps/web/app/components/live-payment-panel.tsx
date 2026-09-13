'use client'
import './payments.css'

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
      <button
        type="button"
        className="ui-button"
        onClick={() => {
          setOpened(true)
          dialog.current?.showModal()
        }}
      >
        <Wallet size={14} aria-hidden />
        Agent budget
      </button>
      <dialog
        className="live-payment-dialog"
        ref={dialog}
        aria-label="Entry and agent budget"
        onClose={() => setOpened(false)}
      >
        <header>
          <div>
            <h2>Entry & agent budget</h2>
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
