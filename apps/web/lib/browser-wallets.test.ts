import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

it('discovers multiple extensions and sends every wallet method only to the selected provider', async () => {
  const browser = new EventTarget()
  vi.stubGlobal('window', browser)
  const metamask = { request: vi.fn(async () => []) }
  const coinbase = { request: vi.fn(async () => []) }
  const announce = (uuid: string, name: string, provider: unknown) =>
    browser.dispatchEvent(
      new CustomEvent('eip6963:announceProvider', {
        detail: { info: { uuid, name }, provider },
      }),
    )
  browser.addEventListener('eip6963:requestProvider', () => {
    announce('meta', 'MetaMask', metamask)
    announce('coin', 'Coinbase Wallet', coinbase)
  })
  const wallets = await import('./browser-wallets')
  wallets.discoverBrowserWallets()
  expect(wallets.walletSnapshot().map((w) => w.name)).toEqual([
    'MetaMask',
    'Coinbase Wallet',
  ])
  wallets.selectBrowserWallet('coin')
  announce('meta', 'MetaMask', metamask)
  expect(wallets.walletSnapshot()).toHaveLength(2)
  expect(wallets.paymentProvider()).toBe(coinbase)
  for (const method of [
    'eth_requestAccounts',
    'personal_sign',
    'wallet_switchEthereumChain',
    'eth_sendTransaction',
  ])
    await wallets.paymentProvider().request({ method } as never)
  expect(coinbase.request).toHaveBeenCalledTimes(4)
  expect(metamask.request).not.toHaveBeenCalled()
  wallets.selectBrowserWallet('meta')
  expect(wallets.paymentProvider()).toBe(metamask)
})

it('supports legacy injection, late announcements, and discovery without prompting for accounts', async () => {
  const legacy = { request: vi.fn(async () => []), isMetaMask: true }
  const browser = Object.assign(new EventTarget(), { ethereum: legacy })
  vi.stubGlobal('window', browser)
  const wallets = await import('./browser-wallets')
  wallets.discoverBrowserWallets()
  expect(wallets.paymentProvider()).toBe(legacy)
  browser.dispatchEvent(
    new CustomEvent('eip6963:announceProvider', {
      detail: { info: { uuid: 'late', name: 'MetaMask' }, provider: legacy },
    }),
  )
  expect(wallets.walletSnapshot()).toHaveLength(1)
  expect(legacy.request).not.toHaveBeenCalled()
})

it('ignores malformed announcements and gives a useful missing-wallet message', async () => {
  const browser = new EventTarget()
  vi.stubGlobal('window', browser)
  const wallets = await import('./browser-wallets')
  wallets.discoverBrowserWallets()
  browser.dispatchEvent(
    new CustomEvent('eip6963:announceProvider', { detail: { provider: {} } }),
  )
  expect(() => wallets.paymentProvider()).toThrow('MetaMask, Coinbase Wallet')
})
