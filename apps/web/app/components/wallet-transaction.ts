import {
  createViemAdapter,
  type ContractCall,
  type EscrowDeployment,
} from '@common-arcade/economy'
import type { Hex, PublicClient, WalletClient } from 'viem'

export interface SubmittedTransaction {
  hash: Hex
  chainId: number
  address: string
  label: string
}
export const pendingTransactionKey = 'arcade:pending-wallet-transaction:v1'
export function readPendingTransaction(
  value: string | null,
): SubmittedTransaction | undefined {
  if (!value) return
  try {
    const p = JSON.parse(value)
    if (
      /^0x[\da-f]{64}$/i.test(p.hash) &&
      /^0x[\da-f]{40}$/i.test(p.address) &&
      Number.isSafeInteger(p.chainId) &&
      typeof p.label === 'string'
    )
      return p
  } catch {}
}
export function walletError(error: unknown): string {
  let cause: unknown = error
  for (let i = 0; cause && i < 8; i++) {
    const e = cause as { code?: number; name?: string; cause?: unknown }
    if (e.code === 4001 || e.name === 'UserRejectedRequestError')
      return 'You declined the wallet request. No further transaction was sent.'
    cause = e.cause
  }
  return error instanceof Error ? error.message : 'Wallet request failed'
}

/** Keep the submitted hash until a receipt is known, including across page reloads. */
export async function submitConfirmedCall({
  deployment,
  wallet,
  reader,
  call,
  label,
  update,
}: {
  deployment: EscrowDeployment
  wallet: WalletClient
  reader: PublicClient
  call: ContractCall
  label: string
  update: (pending: SubmittedTransaction | undefined, message: string) => void
}) {
  let submitted: SubmittedTransaction | undefined
  const adapter = createViemAdapter(deployment, wallet, reader, {
    submitted(hash) {
      submitted = {
        hash,
        chainId: deployment.chainId,
        address: wallet.account!.address,
        label,
      }
      update(submitted, `${label} submitted. Waiting for network confirmation…`)
    },
    confirmed() {
      update(undefined, `${label} confirmed.`)
    },
  })
  try {
    return await adapter.submit(call)
  } catch (error) {
    if (submitted) {
      if (
        error instanceof Error &&
        error.message === `Transaction reverted: ${submitted.hash}`
      )
        update(
          undefined,
          `${label} reverted. No funds were transferred by this transaction; network fees may apply.`,
        )
      else
        update(
          submitted,
          `${label} is awaiting confirmation. Check its status before sending another transaction.`,
        )
    }
    throw error
  }
}
