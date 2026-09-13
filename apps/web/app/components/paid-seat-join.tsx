'use client'
import { useEffect, useRef, useState } from 'react'
import { formatUnits, type Address } from 'viem'
import {
  NETWORKS,
  hashArcadeId,
  usdcUnits,
  transactionExplorerUrl,
  type EconomyConfig,
  type EscrowDeployment,
} from '@common-arcade/economy'
import { AgentSelect } from './agent-select'
import { preparePaymentBudget } from '../../lib/payment-budget'
import { paymentService } from '../../lib/paid-session'

interface Lobby {
  id: string
  pool?: string
  deployment?: EscrowDeployment
  economy: Extract<EconomyConfig, { mode: 'escrow' }>
  recipients: Address[]
  funded?: boolean[]
}
interface Agent {
  agentId: string
  name: string
}
interface Wallet {
  id: string
  address: string
  walletType: string
  isActive: boolean
}
interface Grant {
  id: string
  wallet_id: string
  runtime_session_id: string
  expires_at: string
  revoked_at: string | null
  budget_units: string
  reserved_units: string
  policy: {
    network: string
    origin: string
    payTo: string
    maxPaymentUnits: string
    arcade?: { matchId: string; seatId: string; allowedOperations: string[] }
  }
}
async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/agent-wallets/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const result = await response.json()
  if (!response.ok)
    throw new Error(
      result.message ?? result.error ?? 'Could not join this seat',
    )
  return result
}
export function PaidSeatJoin({
  table,
  account,
  busy,
  onJoin,
  onJoined,
}: {
  table: Lobby
  account?: Address
  busy: boolean
  onJoin: (seat: number) => Promise<void>
  onJoined: () => Promise<void>
}) {
  const [kind, setKind] = useState<'human' | 'agent'>('human')
  const [agents, setAgents] = useState<Agent[]>([])
  const [agentId, setAgentId] = useState('')
  const [agentReady, setAgentReady] = useState<boolean>()
  const [signedIn, setSignedIn] = useState<boolean>()
  const [selectedSeat, setSelectedSeat] = useState(0)
  const [budget, setBudget] = useState(
    formatUnits(BigInt(table.economy.stakeUnits) || 1000000n, 6),
  )
  const [working, setWorking] = useState(false)
  const [message, setMessage] = useState('')
  const [receipt, setReceipt] = useState<string>()
  const [joinedAgent, setJoinedAgent] = useState<string>()
  const pendingGrant = useRef<{ agentId: string; seat: number; grant: Grant }>(
    undefined,
  )
  const stake = BigInt(table.economy.stakeUnits)
  const mySeat = table.recipients.findIndex(
    (address) => address.toLowerCase() === account?.toLowerCase(),
  )
  const available = table.recipients
    .map((_, i) => i)
    .filter((i) => !table.funded?.[i])
  const seat = available.includes(selectedSeat) ? selectedSeat : available[0]
  useEffect(() => {
    if (kind !== 'agent') return
    let cancelled = false
    fetch('/api/auth/session')
      .then((r) => r.json())
      .then(async (session) => {
        if (cancelled) return
        setSignedIn(!!session.user)
        if (!session.user) return
        const value = await api<Agent[] | { data: Agent[] }>('agents')
        if (cancelled) return
        const list = Array.isArray(value) ? value : value.data
        setAgents(list)
        setAgentId((current) => current || list[0]?.agentId || '')
      })
      .catch((error) => {
        if (!cancelled) setMessage(error.message)
      })
    return () => {
      cancelled = true
    }
  }, [kind])
  useEffect(() => {
    if (kind !== 'agent' || !agentId) return
    let cancelled = false
    setAgentReady(undefined)
    api<{ openSeatDeposits?: boolean; sponsoredSeatDeposits?: boolean }>(
      `wallets/agent/${agentId}/payment-capabilities`,
    )
      .then((value) => {
        if (!cancelled)
          setAgentReady(
            value.openSeatDeposits === true &&
              (stake > 0n || value.sponsoredSeatDeposits === true),
          )
      })
      .catch(() => {
        if (!cancelled) setAgentReady(false)
      })
    return () => {
      cancelled = true
    }
  }, [kind, agentId, stake])
  async function join() {
    if (seat === undefined) return
    setWorking(true)
    setMessage('')
    try {
      const limit = usdcUnits(budget)
      if (limit < stake || (kind === 'agent' && limit <= 0n))
        throw new Error('Your budget must cover the entry amount.')
      if (kind === 'human') {
        await onJoin(seat)
        return
      }
      if (!agentId) throw new Error('Choose your agent first.')
      if (!agentReady)
        throw new Error(
          'Agent entry payments are not available yet. No budget has been created.',
        )
      const wallets = await api<Wallet[]>(`wallets/agent/${agentId}`)
      const wallet = wallets.find((w) => w.isActive && w.walletType === 'eoa')
      if (!wallet)
        throw new Error(
          'This agent needs a payment wallet. Create one in Commons, then return to join.',
        )
      if (
        table.recipients.some(
          (a) => a.toLowerCase() === wallet.address.toLowerCase(),
        )
      )
        throw new Error('This agent already has a seat.')
      const grants = await api<Grant[]>(
        `wallets/agent/${agentId}/payment-sessions`,
      )
      const config = NETWORKS[table.economy.network]
      const matches = (g: Grant) =>
        g.wallet_id === wallet.id &&
        !g.revoked_at &&
        new Date(g.expires_at).getTime() > Date.now() + 30000 &&
        g.policy.network === config.x402Network &&
        g.policy.origin === paymentService &&
        g.policy.payTo.toLowerCase() ===
          table.deployment?.contract.toLowerCase() &&
        g.policy.arcade?.matchId === table.id &&
        g.policy.arcade.seatId === hashArcadeId(`sea_player_${seat + 1}`) &&
        g.policy.arcade.allowedOperations.includes('stake') &&
        BigInt(g.budget_units) - BigInt(g.reserved_units) >= stake &&
        BigInt(g.policy.maxPaymentUnits) >= stake
      let grant =
        pendingGrant.current?.agentId === agentId &&
        pendingGrant.current.seat === seat &&
        matches(pendingGrant.current.grant)
          ? pendingGrant.current.grant
          : grants.find(matches)
      if (!grant) {
        const reviewed = preparePaymentBudget({
          agentId,
          agentName: agents.find((a) => a.agentId === agentId)?.name ?? agentId,
          walletId: wallet.id,
          walletAddress: wallet.address,
          runtime: `arcade:${table.id}:${agentId}`,
          kind: 'arcade',
          network: table.economy.network,
          recipient: '',
          origin: paymentService,
          budget,
          perPayment: stake > 0n ? formatUnits(stake, 6) : budget,
          minutes: '60',
          seat: `sea_player_${seat + 1}`,
          operations: { stake: true, bounty: false, bet: false },
          table,
        })
        grant = await api<Grant>(`wallets/agent/${agentId}/payment-sessions`, {
          ...reviewed.body,
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        })
        pendingGrant.current = { agentId, seat, grant }
      }
      setMessage('Your agent is joining and paying from its approved budget…')
      const paid = await api<{ transaction: string }>(
        `wallets/agent/${agentId}/arcade/deposit`,
        {
          paymentSessionId: grant.id,
          runtimeSessionId: grant.runtime_session_id,
          idempotencyKey: `join_${table.id}_${seat + 1}`,
          operation: 'stake',
        },
      )
      setJoinedAgent(agentId)
      setReceipt(paid.transaction)
      setMessage('Your agent’s seat is confirmed.')
      await onJoined()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not join')
    } finally {
      setWorking(false)
    }
  }
  return (
    <section className="paid-seat-join">
      <div className="paid-lobby-seats">
        {table.recipients.map((address, index) => (
          <div className="paid-player-card" key={index}>
            <strong>Seat {index + 1}</strong>
            <p>
              {table.funded?.[index]
                ? mySeat === index
                  ? 'You · Ready'
                  : `${address.slice(0, 8)}… · Ready`
                : 'Open seat'}
            </p>
            {!table.funded?.[index] && available.length > 1 && (
              <button
                className="secondary"
                disabled={busy || working}
                aria-pressed={seat === index}
                onClick={() => setSelectedSeat(index)}
              >
                {seat === index ? 'Selected' : 'Choose seat'}
              </button>
            )}
          </div>
        ))}
      </div>
      {available.length > 0 && (
        <>
          <div className="actions" role="group" aria-label="Who is playing">
            <button
              className={kind === 'human' ? 'primary' : 'secondary'}
              aria-pressed={kind === 'human'}
              disabled={working}
              onClick={() => setKind('human')}
            >
              Play myself
            </button>
            <button
              className={kind === 'agent' ? 'primary' : 'secondary'}
              aria-pressed={kind === 'agent'}
              disabled={working}
              onClick={() => setKind('agent')}
            >
              Use my agent
            </button>
          </div>
          {kind === 'agent' && signedIn === false ? (
            <a
              className="primary"
              href={`/api/auth/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`}
            >
              Sign in to choose an agent
            </a>
          ) : (
            <>
              {kind === 'agent' && (
                <AgentSelect
                  agents={agents}
                  value={agentId}
                  onChange={setAgentId}
                  disabled={working}
                />
              )}
              {(kind === 'agent' || stake > 0n) && (
                <label className="field">
                  {kind === 'agent'
                    ? 'Agent budget (USDC)'
                    : 'Your budget (USDC)'}
                  <input
                    inputMode="decimal"
                    value={budget}
                    disabled={working}
                    onChange={(event) => setBudget(event.target.value)}
                  />
                </label>
              )}
              <p>
                {formatUnits(stake, 6)} test USDC entry ·{' '}
                {NETWORKS[table.economy.network].chain.name}. Network fees are
                separate.
              </p>
              {kind === 'agent' && (
                <p>
                  This budget is for this agent and session only. Entry is paid
                  automatically; unused budget stays in its wallet.
                </p>
              )}
              <button
                className="primary"
                disabled={
                  busy ||
                  working ||
                  (kind === 'agent' &&
                    (!agentId || !agentReady || joinedAgent === agentId)) ||
                  (kind === 'human' && mySeat >= 0)
                }
                onClick={() => void join()}
              >
                {working
                  ? 'Joining…'
                  : kind === 'agent'
                    ? joinedAgent === agentId
                      ? 'Agent is ready'
                      : 'Approve budget & join'
                    : mySeat >= 0
                      ? 'You have a seat'
                      : stake > 0n
                        ? `Join & pay ${formatUnits(stake, 6)} USDC`
                        : 'Join seat'}
              </button>
            </>
          )}
        </>
      )}
      {kind === 'agent' && agentReady === false && (
        <p role="status">
          Agent entries are temporarily unavailable while the wallet service
          updates. You can still join with your own wallet.
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {receipt && (
        <a
          href={transactionExplorerUrl(table.economy.network, receipt)}
          target="_blank"
          rel="noreferrer"
        >
          View agent payment transaction
        </a>
      )}
    </section>
  )
}
