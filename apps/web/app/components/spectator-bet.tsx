'use client'
import { useRef, useState } from 'react'
import { Eye } from 'lucide-react'
import { payWithAgent, type PaidLobby } from '../../lib/agent-game-payment'
import { BrowserWalletPicker } from './browser-wallet-picker'
import { Select, SelectOption } from './ui/select'

export function SpectatorBet({
  table,
  agent,
  onBet,
  onRefresh,
  onBusyChange,
}: {
  table: PaidLobby
  agent?: { agentId: string; name: string }
  onBet: (
    operation: 'bet' | 'bounty',
    seat: number,
    amount: string,
    progress: (message: string) => void,
  ) => Promise<void>
  onRefresh: () => Promise<void>
  onBusyChange: (busy: boolean) => void
}) {
  const [seat, setSeat] = useState('0')
  const [operation, setOperation] = useState<'bet' | 'bounty'>(
    table.economy.spectatorBets ? 'bet' : 'bounty',
  )
  const [amount, setAmount] = useState('1')
  const [useAgent, setUseAgent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const attempt = useRef<string>(undefined)
  const pending = useRef(false)
  async function bet() {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    onBusyChange(true)
    try {
      if (useAgent && agent) {
        attempt.current ??= crypto.randomUUID()
        await payWithAgent({
          table,
          ...agent,
          agentName: agent.name,
          seat: Number(seat),
          operation,
          amount,
          budget: amount,
          idempotencyKey: attempt.current,
          onProgress: setMessage,
        })
      } else await onBet(operation, Number(seat), amount, setMessage)
      setMessage(
        operation === 'bet'
          ? 'Bet confirmed.'
          : 'Prize contribution confirmed.',
      )
      attempt.current = undefined
      await onRefresh().catch(() => {})
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Could not place this bet',
      )
    } finally {
      setBusy(false)
      onBusyChange(!!attempt.current)
      pending.current = false
    }
  }
  return (
    <details className="roster-seat spectator-seat">
      <summary className="roster-seat-heading">
        <Eye size={16} />
        <strong>
          Spectator ·{' '}
          {table.economy.spectatorBets ? 'Back a player' : 'Sponsor the prize'}
        </strong>
      </summary>
      <div className="roster-seat-body">
        {table.economy.spectatorBets && table.economy.bounties && (
          <Select
            value={operation}
            onValueChange={(value) => setOperation(value as 'bet' | 'bounty')}
            ariaLabel="Spectator contribution"
            disabled={busy || !!attempt.current}
          >
            <SelectOption value="bet" title="Back a player" />
            <SelectOption value="bounty" title="Sponsor the prize" />
          </Select>
        )}
        <p className="match-rule-note">
          Watching is free.{' '}
          {operation === 'bet'
            ? `Betting is optional. You can lose your bet; ${table.economy.feeBps / 100}% applies to profits.`
            : `This contribution rewards the winner after the ${table.economy.feeBps / 100}% success fee.`}
        </p>
        {operation === 'bet' && (
          <Select
            value={seat}
            onValueChange={setSeat}
            ariaLabel="Player to back"
            disabled={busy || !!attempt.current}
          >
            {table.recipients.map((_, index) => (
              <SelectOption
                key={index}
                value={String(index)}
                title={`Player ${index + 1}`}
                disabled={!table.funded?.[index]}
              />
            ))}
          </Select>
        )}
        <label className="field">
          {operation === 'bet' ? 'Bet' : 'Prize contribution'} (test USDC)
          <input
            inputMode="decimal"
            value={amount}
            disabled={busy || !!attempt.current}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        {agent && (
          <label>
            <input
              type="checkbox"
              checked={useAgent}
              disabled={busy || !!attempt.current}
              onChange={(e) => setUseAgent(e.target.checked)}
            />{' '}
            Use {agent.name}’s wallet
          </label>
        )}
        {useAgent ? (
          <small>
            Approve {amount} USDC for this agent’s{' '}
            {operation === 'bet' ? 'bet on this player' : 'prize contribution'}.
            It pays automatically from its own wallet.
          </small>
        ) : (
          <BrowserWalletPicker disabled={busy} />
        )}
        <button
          className="primary"
          disabled={
            busy || (operation === 'bet' && !table.funded?.[Number(seat)])
          }
          onClick={() => void bet()}
        >
          {busy
            ? 'Confirming…'
            : useAgent
              ? `Approve budget & ${operation === 'bet' ? 'place bet' : 'contribute'}`
              : `${operation === 'bet' ? 'Bet' : 'Contribute'} ${amount} USDC`}
        </button>
        {message && <p role="status">{message}</p>}
      </div>
    </details>
  )
}
