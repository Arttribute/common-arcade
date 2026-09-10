'use client'
import { NETWORKS } from '@common-arcade/economy'
import type { SubmittedTransaction } from './wallet-transaction'
export function WalletActionStatus({
  pending,
  status,
  check,
  disabled = false,
}: {
  pending?: SubmittedTransaction
  status: string
  check(): Promise<void>
  disabled?: boolean
}) {
  const network = Object.values(NETWORKS).find(
    (n) => n.chain.id === pending?.chainId,
  )
  if (!status && !pending) return null
  return (
    <div className="wallet-action-status" role="status">
      <p>{status || `${pending?.label} is awaiting confirmation.`}</p>
      {pending && (
        <div className="actions">
          {network && (
            <a
              href={`${network.explorer}/tx/${pending.hash}`}
              target="_blank"
              rel="noreferrer"
            >
              View transaction ↗
            </a>
          )}
          <button
            type="button"
            className="secondary"
            disabled={disabled}
            onClick={() => void check()}
          >
            Check confirmation
          </button>
        </div>
      )}
    </div>
  )
}
