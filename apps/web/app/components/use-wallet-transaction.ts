'use client'
import { useEffect, useRef, useState } from 'react'
import { createPublicClient, http, type WalletClient } from 'viem'
import {
  NETWORKS,
  type ContractCall,
  type EscrowDeployment,
} from '@common-arcade/economy'
import {
  pendingTransactionKey,
  readPendingTransaction,
  submitConfirmedCall,
  type SubmittedTransaction,
} from './wallet-transaction'

// Prevent overlapping wallet submissions from separate funding/table components.
let submissionInProgress = false

export function useWalletTransaction() {
  const [pending, setPending] = useState<SubmittedTransaction>()
  const [status, setStatus] = useState('')
  const running = useRef(false)
  const current = useRef<SubmittedTransaction | undefined>(undefined)
  useEffect(() => {
    const sync = () => {
      try {
        const p = readPendingTransaction(
          localStorage.getItem(pendingTransactionKey),
        )
        current.current = p
        setPending(p)
      } catch {}
    }
    sync()
    window.addEventListener('storage', sync)
    window.addEventListener('arcade-wallet-transaction', sync)
    return () => {
      window.removeEventListener('storage', sync)
      window.removeEventListener('arcade-wallet-transaction', sync)
    }
  }, [])
  function update(value: SubmittedTransaction | undefined, message: string) {
    current.current = value
    setPending(value)
    setStatus(message)
    try {
      if (value)
        localStorage.setItem(pendingTransactionKey, JSON.stringify(value))
      else localStorage.removeItem(pendingTransactionKey)
      window.dispatchEvent(new Event('arcade-wallet-transaction'))
    } catch {
      /* The in-memory hash remains visible when storage is unavailable. */
    }
  }
  async function submit(
    deployment: EscrowDeployment,
    wallet: WalletClient,
    call: ContractCall,
    label: string,
  ) {
    let saved: SubmittedTransaction | undefined
    try {
      saved = readPendingTransaction(
        localStorage.getItem(pendingTransactionKey),
      )
    } catch {}
    if (current.current || saved || running.current || submissionInProgress)
      throw new Error(
        'Check the pending transaction before sending another one',
      )
    const network = Object.values(NETWORKS).find(
      (n) => n.testnet && n.chain.id === deployment.chainId,
    )
    if (!network) throw new Error('Unsupported transaction network')
    running.current = true
    submissionInProgress = true
    setStatus(`Approve ${label.toLowerCase()} in your wallet…`)
    try {
      return await submitConfirmedCall({
        deployment,
        wallet,
        call,
        label,
        update,
        reader: createPublicClient({ chain: network.chain, transport: http() }),
      })
    } finally {
      running.current = false
      submissionInProgress = false
    }
  }
  async function check() {
    if (!pending) return
    const network = Object.values(NETWORKS).find(
      (n) => n.testnet && n.chain.id === pending.chainId,
    )
    if (!network) throw new Error('Unsupported transaction network')
    const reader = createPublicClient({
      chain: network.chain,
      transport: http(),
    })
    try {
      let replaced = false
      const receipt = await reader.waitForTransactionReceipt({
        hash: pending.hash,
        confirmations: 2,
        timeout: 10000,
        onReplaced: ({ reason, transactionReceipt }) => {
          if (reason !== 'repriced') replaced = true
          else
            update(
              { ...pending, hash: transactionReceipt.transactionHash },
              'Transaction sped up. Checking confirmation…',
            )
        },
      })
      update(
        undefined,
        replaced
          ? 'The transaction was cancelled or replaced in your wallet. Review its activity before making another payment.'
          : receipt.status === 'success'
            ? `${pending.label} confirmed. Refresh the table or balance to see the result.`
            : `${pending.label} reverted. Network fees may apply.`,
      )
    } catch {
      setStatus(
        'Still awaiting a confirmed receipt. Check the transaction in the explorer.',
      )
    }
  }
  return { pending, status, setStatus, submit, check }
}
