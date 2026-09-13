import { PaymentSummary } from './payment-disclosure'
import { formatUnits } from 'viem'
import {
  NETWORKS,
  type EconomyConfig,
  type SettlementAccounting,
} from '@common-arcade/economy'
import type { JsonValue } from '@common-arcade/protocol'

export function PaidSessionResult({
  stage,
  result,
  accounting,
  economy,
  recipients,
  showBreakdown = true,
  breakdownOnly = false,
}: {
  stage: string
  result?: JsonValue
  accounting?: SettlementAccounting
  economy: EconomyConfig
  showBreakdown?: boolean
  breakdownOnly?: boolean
  recipients: string[]
}) {
  if (stage !== 'settled' && stage !== 'settlement-pending') return null
  const value =
    result && typeof result === 'object' && !Array.isArray(result)
      ? result
      : undefined
  const winnerSeat =
    typeof value?.winnerSeatId === 'string' ? value.winnerSeatId : undefined
  const winner =
    winnerSeat === 'sea_player_1'
      ? 1
      : winnerSeat === 'sea_player_2'
        ? 2
        : undefined
  const draw = value?.outcome === 'draw'
  return (
    <section
      className={breakdownOnly ? undefined : 'paid-result'}
      aria-label={breakdownOnly ? 'Payment breakdown' : 'Session result'}
    >
      {!breakdownOnly && (
        <>
          <h2>
            {winner
              ? `Player ${winner} wins`
              : draw
                ? 'A draw — well played'
                : 'Game complete'}
          </h2>
          <p>
            {economy.mode === 'free'
              ? 'Free play · no payments'
              : stage === 'settlement-pending'
                ? 'Result recorded. Payment settlement is pending.'
                : accounting?.status === 'refundable'
                  ? 'This table allows contribution refunds. No success fee.'
                  : 'Settlement confirmed. Allocated funds can now be claimed.'}
          </p>
          {stage === 'settled' &&
            accounting?.status === 'allocated' &&
            accounting.allocations.some((a) => a.role === 'winner') && (
              <p className="payment-result-reward">
                {formatUnits(
                  accounting.allocations
                    .filter((a) => a.role === 'winner')
                    .reduce((total, a) => total + BigInt(a.amountUnits), 0n),
                  6,
                )}{' '}
                test USDC allocated to the winner
              </p>
            )}
        </>
      )}
      {showBreakdown && economy.mode === 'escrow' && (
        <details className="payment-disclosure">
          <PaymentSummary>Rewards & payment breakdown</PaymentSummary>
          <p>{NETWORKS[economy.network].chain.name} · test USDC</p>
          {accounting && stage === 'settled' ? (
            <>
              <dl className="payment-facts">
                <div>
                  <dt>Prize contributions</dt>
                  <dd>
                    {formatUnits(BigInt(accounting.prizePoolUnits), 6)} USDC
                  </dd>
                </div>
                {BigInt(accounting.spectatorPoolUnits) > 0n && (
                  <div>
                    <dt>Spectator contributions</dt>
                    <dd>
                      {formatUnits(BigInt(accounting.spectatorPoolUnits), 6)}{' '}
                      USDC
                    </dd>
                  </div>
                )}
                <div>
                  <dt>Total success fee</dt>
                  <dd>{formatUnits(BigInt(accounting.feeUnits), 6)} USDC</dd>
                </div>
              </dl>
              {accounting.allocations.length > 0 && (
                <>
                  <p>
                    Amounts allocated by the escrow contract. Recipients
                    withdraw these separately; allocation does not mean the
                    funds have reached their wallets.
                  </p>
                  <ul className="payment-allocation-list">
                    {accounting.allocations.map((allocation, index) => {
                      const player = recipients.findIndex(
                        (recipient) =>
                          recipient.toLowerCase() ===
                          allocation.recipient.toLowerCase(),
                      )
                      return (
                        <li key={`${allocation.role}-${index}`}>
                          <div>
                            <strong>
                              {allocation.role === 'winner'
                                ? player >= 0
                                  ? `Player ${player + 1}`
                                  : 'Winner'
                                : allocation.role === 'royalty'
                                  ? 'Remix royalty'
                                  : allocation.role === 'creator'
                                    ? 'Creator'
                                    : 'Platform'}
                            </strong>
                            <span>
                              {formatUnits(BigInt(allocation.amountUnits), 6)}{' '}
                              USDC
                            </span>
                          </div>
                          <code>{allocation.recipient}</code>
                        </li>
                      )
                    })}
                  </ul>
                </>
              )}
              {BigInt(accounting.spectatorPayoutUnits) > 0n && (
                <p>
                  {formatUnits(BigInt(accounting.spectatorPayoutUnits), 6)} USDC
                  allocated to spectator payouts or refunds. Each eligible
                  spectator claims their own share.
                </p>
              )}
            </>
          ) : (
            <p>
              {stage === 'settlement-pending'
                ? 'Amounts will be shown after onchain settlement.'
                : 'The onchain breakdown is temporarily unavailable. Use the transaction receipts below to verify settlement.'}
            </p>
          )}
        </details>
      )}
    </section>
  )
}
