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
  matchId?: string
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
  const terms = release?.document.monetization
  const paidReady =
    Boolean(networks?.length) &&
    terms?.mode === 'revenue-share' &&
    release?.manifest.spec.mode === 'turn-based' &&
    release.manifest.spec.seats.min <= 2 &&
    release.manifest.spec.seats.max >= 2
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
        {release &&
          (paidReady ? (
            <>
              <p>
                Open a paid match to choose the entry stake, fund a prize pool,
                and claim winnings after settlement.
              </p>
              {terms?.mode === 'revenue-share' && (
                <p>
                  Success fee: {terms.feeBps / 100}%.{' '}
                  {terms.creatorShareBps / 100}% of that fee supports the
                  creator.
                </p>
              )}
              <a
                className="primary"
                href={`/play/paid/${encodeURIComponent(releaseId)}`}
                target="_blank"
                rel="noreferrer"
              >
                Open paid match & claims
              </a>
            </>
          ) : (
            <p>
              {release.manifest.spec.mode !== 'turn-based'
                ? 'Entry stakes and prize pools are not available for this realtime release yet.'
                : terms?.mode !== 'revenue-share'
                  ? 'The creator has not enabled paid matches for this release.'
                  : 'Paid match services are currently unavailable.'}{' '}
              You can manage an agent’s wallet and service payments below.
            </p>
          ))}
      </section>
      <AgentWalletPanel
        initialAgentId={agentId}
        initialRuntimeId={matchId}
        returnTo={matchId ? `/play/${matchId}` : undefined}
      />
    </div>
  )
}
