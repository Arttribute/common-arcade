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

it('adds a missing testnet and reads the wallet account after switching chains', async () => {
  const before = '0x1111111111111111111111111111111111111111'
  const after = '0x2222222222222222222222222222222222222222'
  let added = false
  let chain = '0x1'
  const methods: string[] = []
  const provider = {
    request: vi.fn(async ({ method }: { method: string }) => {
      methods.push(method)
      if (method === 'eth_requestAccounts') return [before]
      if (method === 'eth_accounts') return [after]
      if (method === 'eth_chainId') return chain
      if (method === 'wallet_addEthereumChain') {
        added = true
        return null
      }
      if (method === 'wallet_switchEthereumChain') {
        if (!added) throw { code: 4902, message: 'Unknown chain' }
        chain = '0x14a34'
        return null
      }
      throw new Error(method)
    }),
  }
  vi.stubGlobal(
    'window',
    Object.assign(new EventTarget(), { ethereum: provider }),
  )
  const { connectedPaymentWallet } = await import('./browser-wallets')
  const wallet = await connectedPaymentWallet('base-sepolia')
  expect(wallet.account.address).toBe(after)
  expect(wallet.chain?.id).toBe(84532)
  expect(methods).toContain('wallet_addEthereumChain')
  expect(
    methods.filter((m) => m === 'wallet_switchEthereumChain'),
  ).toHaveLength(2)
  expect(methods.at(-1)).toBe('eth_accounts')
})
