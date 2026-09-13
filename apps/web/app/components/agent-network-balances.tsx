'use client'
import { useEffect, useState } from 'react'
import { NETWORKS } from '@common-arcade/economy'
import { RefreshCw, ExternalLink } from 'lucide-react'
import { parseAgentBalance } from '../../lib/agent-balances'
export function AgentNetworkBalances({
  wallet,
}: {
  wallet: { id: string; address: string }
}) {
  const [balances, setBalances] = useState<
    Record<string, { usdc: string; native: string } | null>
  >({})
  const [loading, setLoading] = useState(false)
  const [version, refresh] = useState(0)
  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    setBalances({})
    setLoading(true)
    Promise.allSettled(
      Object.values(NETWORKS)
        .filter((n) => n.testnet)
        .map(async (n) => {
          try {
            const response = await fetch(
              `/api/agent-wallets/wallets/${encodeURIComponent(wallet.id)}/balance?chainId=${n.chain.id}`,
              { cache: 'no-store', signal: controller.signal },
            )
            if (!response.ok) throw new Error('Balance unavailable')
            const balance = parseAgentBalance(
              await response.json(),
              wallet.address,
              n.chain.id,
            )
            if (!cancelled) setBalances((b) => ({ ...b, [n.id]: balance }))
          } catch {
            if (!cancelled) setBalances((b) => ({ ...b, [n.id]: null }))
          }
        }),
    ).then(() => {
      if (!cancelled) setLoading(false)
    })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [wallet.id, wallet.address, version])
  return (
    <section
      className="agent-network-balances"
      aria-label="Agent network balances"
    >
      <div className="wallet-summary-head">
        <span>Wallet balances</span>
        <button
          type="button"
          className="secondary compact"
          disabled={loading}
          onClick={() => refresh((v) => v + 1)}
        >
          <RefreshCw size={13} aria-hidden />
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      <code>{wallet.address}</code>
      <div className="agent-network-grid">
        {Object.values(NETWORKS)
          .filter((n) => n.testnet)
          .map((n) => {
            const balance = balances[n.id]
            return (
              <div className="agent-network-balance" key={n.id}>
                <div>
                  <span>{n.chain.name}</span>
                  <a
                    aria-label={`View wallet on ${n.chain.name}`}
                    href={`${n.explorer}/${n.id === 'hedera-testnet' ? 'account' : 'address'}/${wallet.address}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink size={13} />
                  </a>
                </div>
                <strong role="status">
                  {balance
                    ? `${balance.usdc} USDC`
                    : balance === null
                      ? 'Balance unavailable'
                      : 'Loading…'}
                </strong>
                {balance && (
                  <small>
                    {balance.native} {n.chain.nativeCurrency.symbol}{' '}
                    {n.id === 'arc-testnet'
                      ? 'native · also used for gas'
                      : 'for network fees'}
                  </small>
                )}
              </div>
            )
          })}
      </div>
      <p className="field-hint">
        Test funds only. Each network has its own balance. Deposited stakes and
        claimable winnings appear in the game’s payment receipts. Hedera
        requires USDC token association.
      </p>
    </section>
  )
}
