'use client'

import { useEffect, useState } from 'react'
import type { StudioRelease } from '@common-arcade/protocol'
import { arcade } from '../../lib/api'
import { AgentWalletPanel } from './agent-wallet-panel'

const paymentService = process.env.NEXT_PUBLIC_ARCADE_PAYMENTS_URL ?? ''

export default function LivePaymentDetails({
  releaseId,
  matchId,
  agentId,
}: {
  releaseId: string
  matchId: string
  agentId?: string
}) {
  const [release, setRelease] = useState<StudioRelease>()
  const [error, setError] = useState('')
  const [networks, setNetworks] = useState<string[]>()
  useEffect(() => {
    let active = true
    arcade<StudioRelease>(`studio/releases/${encodeURIComponent(releaseId)}`)
      .then((value) => {
        if (active) setRelease(value)
      })
      .catch((cause) => {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : 'Payment options could not be loaded.',
          )
      })
    return () => {
      active = false
    }
  }, [releaseId])
  useEffect(() => {
    const controller = new AbortController()
    if (!paymentService) {
      setNetworks([])
      return
    }
    fetch(`${paymentService}/v1/economy/config`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Payments unavailable')
        return response.json()
      })
      .then((value) =>
        setNetworks(Array.isArray(value.networks) ? value.networks : []),
      )
      .catch(() => {
        if (!controller.signal.aborted) setNetworks([])
      })
    return () => controller.abort()
  }, [])
  return (
    <div className="live-payment-content">
      <section className="live-payment-summary">
        <h3>{release?.document.title ?? 'Match payments'}</h3>
        <dl>
          <div>
            <dt>Current entry cost</dt>
            <dd>Free</dd>
          </div>
          <div>
            <dt>Payment network</dt>
            <dd>
              {networks === undefined
                ? 'Checking availability…'
                : networks.includes('base-sepolia')
                  ? 'Base Sepolia · test USDC'
                  : networks.length
                    ? 'Testnet USDC'
                    : 'Temporarily unavailable'}
            </dd>
          </div>
        </dl>
        {matchId && (
          <p>
            This session has no entry stake or prize pool. Agent service
            payments use a separate spending budget.
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        {!release && !error && (
          <p role="status">Checking this release’s payment options…</p>
        )}
      </section>
      <AgentWalletPanel
        initialAgentId={agentId}
        initialRuntimeId={matchId}
        returnTo={matchId ? `/play/${matchId}` : undefined}
      />
    </div>
  )
}
