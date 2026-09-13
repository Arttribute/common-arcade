'use client'
import { useRef, useState } from 'react'
import { Bot, ChevronDown, Circle, User } from 'lucide-react'
import { formatUnits } from 'viem'
import { NETWORKS, transactionExplorerUrl } from '@common-arcade/economy'
import { payWithAgent, type PaidLobby } from '../../lib/agent-game-payment'
import { BrowserWalletPicker } from './browser-wallet-picker'

export function PaidSeatJoin({
  table,
  seat,
  account,
  agent,
  onJoin,
  onRefresh,
  playing,
  expanded,
  onExpand,
  agentPlaying,
  onBusyChange,
  canResume,
}: {
  table: PaidLobby
  seat: number
  account?: string
  agent?: { agentId: string; name: string }
  onJoin: (seat: number, onProgress: (message: string) => void) => Promise<void>
  onRefresh: () => Promise<void>
  playing: boolean
  expanded: boolean
  onExpand: () => void
  agentPlaying?: boolean
  onBusyChange: (busy: boolean) => void
  canResume: boolean
}) {
  const [kind, setKind] = useState<'human' | 'agent'>()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [receipt, setReceipt] = useState<string>()
  const [budget, setBudget] = useState(
    formatUnits(BigInt(table.economy.stakeUnits) || 1000000n, 6),
  )
  const running = useRef(false)
  const funded = !!table.funded?.[seat]
  const yours = table.recipients[seat]?.toLowerCase() === account?.toLowerCase()
  const entry = formatUnits(BigInt(table.economy.stakeUnits), 6)
  async function join() {
    if (running.current) return
    running.current = true
    setBusy(true)
    onBusyChange(true)
    setMessage('')
    try {
      if (kind === 'agent' && agent) {
        const paid = await payWithAgent({
          table,
          ...agent,
          agentName: agent.name,
          seat,
          operation: 'stake',
          amount: entry,
          budget,
          idempotencyKey: `join_${table.id}_${seat + 1}`,
          onProgress: setMessage,
        })
        setReceipt(paid.transaction)
        setMessage(
          'Agent ready. It plays on the game server, even if you close this tab.',
        )
      } else {
        await onJoin(seat, setMessage)
        setMessage('Seat confirmed. You’re ready to play.')
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Could not take this seat',
      )
    } finally {
      await onRefresh().catch(() => {})
      setBusy(false)
      onBusyChange(false)
      running.current = false
    }
  }
  return (
    <details
      className={`roster-seat ${funded ? 'is-taken' : 'is-open'} ${yours ? 'is-yours' : ''}`}
      open={expanded || busy}
    >
      <summary
        className="roster-seat-heading"
        onClick={(event) => {
          event.preventDefault()
          onExpand()
        }}
      >
        <strong>Player · Seat {seat + 1}</strong>
        <span className={`seat-status ${funded ? 'is-taken' : 'is-open'}`}>
          {funded ? 'Taken' : 'Open'}
        </span>
        <ChevronDown size={16} className="roster-seat-chevron" aria-hidden />
      </summary>
      <div className="roster-seat-body">
        <div className="seat-occupant">
          {agentPlaying ? (
            <Bot size={16} />
          ) : funded ? (
            <User size={16} />
          ) : (
            <Circle size={16} />
          )}
          <span>
            {funded
              ? yours
                ? 'You · Ready'
                : `${agentPlaying ? 'Agent · ' : ''}${table.recipients[seat]?.slice(0, 8)}… · Ready`
              : 'Available seat'}
          </span>
        </div>
        <p className="match-rule-note">
          {entry} test USDC entry · {NETWORKS[table.economy.network].chain.name}
        </p>
        {((!playing && !funded) ||
          (canResume && funded && kind === 'agent')) && (
          <>
            {!kind ? (
              <>
                <button
                  className="secondary compact"
                  disabled={busy}
                  onClick={() => setKind('human')}
                >
                  <User size={16} /> Take seat {seat + 1}
                </button>
                {agent && (
                  <button
                    className="secondary compact"
                    disabled={busy}
                    onClick={() => setKind('agent')}
                  >
                    <Bot size={16} /> Assign {agent.name}
                  </button>
                )}
              </>
            ) : (
              <div className="seat-payment">
                {kind === 'human' ? (
                  <BrowserWalletPicker disabled={busy} />
                ) : (
                  <>
                    <strong>{agent?.name}</strong>
                    <label className="field">
                      Game budget (USDC)
                      <input
                        inputMode="decimal"
                        value={budget}
                        disabled={busy}
                        onChange={(event) => setBudget(event.target.value)}
                      />
                    </label>
                    <small>
                      Approves this agent’s entry for this game for one hour. It
                      pays from its own wallet; unused funds stay there. Network
                      fees are separate.
                    </small>
                  </>
                )}
                <button
                  className="primary"
                  disabled={busy || (kind === 'agent' && !agent)}
                  onClick={() => void join()}
                >
                  {busy
                    ? 'Taking seat…'
                    : kind === 'agent'
                      ? funded
                        ? 'Resume agent play'
                        : 'Approve budget & take seat'
                      : `Take seat & stake ${entry} USDC`}
                </button>
                {!busy && (
                  <button
                    className="text-button"
                    onClick={() => setKind(undefined)}
                  >
                    Back
                  </button>
                )}
              </div>
            )}
          </>
        )}
        {funded && canResume && !agentPlaying && agent && kind !== 'agent' && (
          <button
            className="secondary compact"
            onClick={() => setKind('agent')}
          >
            Resume {agent.name}
          </button>
        )}
        {message && (
          <p role="status" className="seat-payment-message">
            {message}
          </p>
        )}
        {receipt && (
          <a
            href={transactionExplorerUrl(table.economy.network, receipt)}
            target="_blank"
            rel="noreferrer"
          >
            Payment receipt
          </a>
        )}
      </div>
    </details>
  )
}
