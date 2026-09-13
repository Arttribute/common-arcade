import type { EIP1193Provider } from 'viem'

export type BrowserWallet = {
  id: string
  name: string
  provider: EIP1193Provider
}
const empty: readonly BrowserWallet[] = []
let wallets: readonly BrowserWallet[] = empty
let selected: string | undefined
let started = false
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((fn) => fn())
export const walletSnapshot = () => wallets
export const serverWalletSnapshot = () => empty
export const selectedWalletId = () => selected
export function subscribeWallets(fn: () => void) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
export function selectBrowserWallet(id: string) {
  if (!wallets.some((w) => w.id === id)) return
  selected = id
  emit()
}
export function discoverBrowserWallets() {
  if (typeof window === 'undefined' || started) return
  started = true
  const announced = new Set<EIP1193Provider>()
  window.addEventListener('eip6963:announceProvider', (event) => {
    const detail = (event as CustomEvent).detail
    if (
      !detail ||
      typeof detail.provider?.request !== 'function' ||
      typeof detail.info?.uuid !== 'string' ||
      !detail.info.uuid ||
      typeof detail.info?.name !== 'string' ||
      !detail.info.name ||
      announced.has(detail.provider)
    )
      return
    const old = wallets.find((w) => w.provider === detail.provider)
    const id = old?.id ?? detail.info.uuid
    if (wallets.some((w) => w.id === id && w.provider !== detail.provider))
      return
    announced.add(detail.provider)
    wallets = [
      ...wallets.filter((w) => w.provider !== detail.provider),
      { id, name: detail.info.name.slice(0, 80), provider: detail.provider },
    ]
    selected ??= id
    emit()
  })
  window.dispatchEvent(new Event('eip6963:requestProvider'))
  const ethereum = (
    window as unknown as {
      ethereum?: EIP1193Provider & { providers?: EIP1193Provider[] }
    }
  ).ethereum
  for (const provider of ethereum?.providers ?? (ethereum ? [ethereum] : [])) {
    if (
      typeof provider.request !== 'function' ||
      wallets.some((w) => w.provider === provider)
    )
      continue
    // Legacy injection remains usable when the extension does not announce itself.
    const flags = provider as EIP1193Provider & {
      isCoinbaseWallet?: boolean
      isMetaMask?: boolean
    }
    const id = `legacy-${wallets.length}`
    wallets = [
      ...wallets,
      {
        id,
        provider,
        name: flags.isCoinbaseWallet
          ? 'Coinbase Wallet'
          : flags.isMetaMask
            ? 'MetaMask'
            : 'Browser wallet',
      },
    ]
    selected ??= id
  }
  emit()
}
export function paymentProvider() {
  discoverBrowserWallets()
  const wallet = wallets.find((w) => w.id === selected)
  if (!wallet)
    throw new Error(
      'Open MetaMask, Coinbase Wallet, or another EVM browser wallet to continue.',
    )
  return wallet.provider
}
