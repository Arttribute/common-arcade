'use client'
import { useEffect, useSyncExternalStore } from 'react'
import {
  discoverBrowserWallets,
  walletSnapshot,
  serverWalletSnapshot,
  selectedWalletId,
  subscribeWallets,
  selectBrowserWallet,
} from '../../lib/browser-wallets'
import { Select, SelectOption } from './ui/select'

export function useBrowserWallet() {
  const wallets = useSyncExternalStore(
    subscribeWallets,
    walletSnapshot,
    serverWalletSnapshot,
  )
  const selected = useSyncExternalStore(
    subscribeWallets,
    selectedWalletId,
    () => undefined,
  )
  useEffect(() => {
    discoverBrowserWallets()
  }, [])
  return {
    wallets,
    selected,
    provider: wallets.find((w) => w.id === selected)?.provider,
  }
}
export function BrowserWalletPicker({
  disabled = false,
}: {
  disabled?: boolean
}) {
  const { wallets, selected } = useBrowserWallet()
  return (
    <div className="field">
      <span className="field-label">Browser wallet</span>
      {wallets.length ? (
        <Select
          value={selected ?? ''}
          onValueChange={selectBrowserWallet}
          disabled={disabled}
          ariaLabel="Browser wallet"
        >
          {wallets.map((w) => (
            <SelectOption key={w.id} value={w.id} title={w.name} />
          ))}
        </Select>
      ) : (
        <p className="field-hint">
          Open MetaMask, Coinbase Wallet, or another EVM browser wallet, then
          reload.
        </p>
      )}
    </div>
  )
}
