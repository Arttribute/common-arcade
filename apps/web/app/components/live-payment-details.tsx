'use client'

import { useState } from 'react'
import { AgentWalletPanel } from './agent-wallet-panel'

export default function LivePaymentDetails({
  matchId,
  agentId,
}: {
  releaseId: string
  matchId: string
  agentId?: string
}) {
  const [showBudget, setShowBudget] = useState(false)
  return (
    <div className="live-payment-content">
      <section className="live-payment-summary">
        <h3>Free to play and watch</h3>
        <p>
          This live session has no entry stake or prize pool. No wallet is
          needed.
        </p>
      </section>
      <section>
        <h3>Optional agent budget</h3>
        <p>
          Allow your agent to pay for services with a spending limit and expiry.
          This is separate from playing the game.
        </p>
        <button
          className="secondary"
          aria-expanded={showBudget}
          onClick={() => setShowBudget(!showBudget)}
        >
          {showBudget ? 'Hide agent budget' : 'Manage agent budget'}
        </button>
        {showBudget && (
          <AgentWalletPanel
            initialAgentId={agentId}
            initialRuntimeId={matchId}
            returnTo={matchId ? `/play/${matchId}` : undefined}
          />
        )}
      </section>
    </div>
  )
}
