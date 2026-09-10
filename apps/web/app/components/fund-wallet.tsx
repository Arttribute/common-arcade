'use client'
import { useRef, useState } from 'react'
import {
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  http,
  isAddress,
  zeroAddress,
  type Address,
} from 'viem'
import {
  NETWORKS,
  usdcUnits,
  type PaymentNetwork,
} from '@common-arcade/economy'
import { useArcadeWallet, WalletConnectionButton } from './arcade-wallet'
import { useWalletTransaction } from './use-wallet-transaction'
import { WalletActionStatus } from './wallet-action-status'
import { walletError } from './wallet-transaction'

export function FundWallet({
  address,
  network,
  onFunded,
}: {
  address: string
  network: PaymentNetwork
  onFunded?(): Promise<void>
}) {
  const connection = useArcadeWallet(),
    transaction = useWalletTransaction()
  const [amount, setAmount] = useState('5'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const lock = useRef(false)
  const config = NETWORKS[network]
  async function fund() {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      const units = usdcUnits(amount),
        sender = connection.address
      if (
        !sender ||
        units <= 0n ||
        !config.testnet ||
        !isAddress(address) ||
        address.toLowerCase() === zeroAddress
      )
        throw new Error('Connect a wallet and enter a positive USDC amount')
      if (sender.toLowerCase() === address.toLowerCase())
        throw new Error('Choose a different wallet to fund this agent')
      const wallet = await connection.client(config.chain)
      if (wallet.account?.address.toLowerCase() !== sender.toLowerCase())
        throw new Error('Your wallet changed. Review the transfer again')
      const reader = createPublicClient({
        chain: config.chain,
        transport: http(),
      })
      const balance = await reader.readContract({
        address: config.token,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [sender],
      })
      if (balance < units)
        throw new Error(`Not enough USDC on ${config.chain.name}`)
      await transaction.submit(
        {
          chainId: config.chain.id,
          contract: config.token,
          token: config.token,
        },
        wallet,
        {
          to: config.token,
          chainId: config.chain.id,
          value: '0',
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: 'transfer',
            args: [address as Address, units],
          }),
        },
        'Agent funding',
      )
      await onFunded?.().catch(() => {})
    } catch (e) {
      setError(walletError(e))
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  return (
    <details className="wallet-funding">
      <summary>Add USDC from your wallet</summary>
      <div className="wallet-review">
        <WalletConnectionButton disabled={busy} />
        <p className="studio-help">
          Transfer testnet USDC on {config.chain.name} to this agent. This adds
          funds; it does not increase the agent’s spending allowance.
        </p>
        <p className="wallet-recipient">Recipient: {address}</p>
        <label>
          USDC amount
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            disabled={busy}
          />
        </label>
        <p className="studio-help">
          Review the transfer in your wallet before confirming. Your wallet
          needs {config.chain.nativeCurrency.symbol} for this transaction. The
          agent also needs network fee funds to play.
        </p>
        <button
          type="button"
          className="primary"
          disabled={busy || !connection.address || !!transaction.pending}
          onClick={() => void fund()}
        >
          {busy
            ? 'Transfer in progress…'
            : `Review ${amount || '0'} USDC transfer`}
        </button>
        {error && <p role="alert">{error}</p>}
        <WalletActionStatus
          pending={transaction.pending}
          status={transaction.status}
          check={transaction.check}
          disabled={busy}
        />
      </div>
    </details>
  )
}
