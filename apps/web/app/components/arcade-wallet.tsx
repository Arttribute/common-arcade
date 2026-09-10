'use client'

import {
  createContext,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { PrivyProvider, usePrivy, useWallets } from '@privy-io/react-auth'
import {
  createWalletClient,
  custom,
  type Address,
  type Chain,
  type WalletClient,
} from 'viem'
import { NETWORKS } from '@common-arcade/economy'

interface WalletConnection {
  configured: boolean
  ready: boolean
  address?: Address
  wallets: { address: string; label: string }[]
  connect(): void
  select(address: string): void
  disconnect(): Promise<void>
  client(chain?: Chain): Promise<WalletClient>
}
const unavailable: WalletConnection = {
  configured: false,
  ready: true,
  wallets: [],
  connect() {},
  select() {},
  async disconnect() {},
  async client() {
    throw new Error('Wallet connection is not available yet')
  },
}
const WalletContext = createContext<WalletConnection>(unavailable)
export const useArcadeWallet = () => useContext(WalletContext)

function ConnectedProvider({ children }: { children: ReactNode }) {
  const { ready, connectOrCreateWallet, logout } = usePrivy()
  const { wallets, ready: walletsReady } = useWallets()
  const [selected, select] = useState<string>()
  const active =
    wallets.find((w) => w.address.toLowerCase() === selected?.toLowerCase()) ??
    wallets[0]
  const latest = useRef(active)
  latest.current = active
  return (
    <WalletContext.Provider
      value={{
        configured: true,
        ready: ready && walletsReady,
        address: active?.address as Address | undefined,
        wallets: wallets.map((w) => ({
          address: w.address,
          label:
            w.walletClientType === 'privy'
              ? 'Privy wallet'
              : 'Connected wallet',
        })),
        connect: () => connectOrCreateWallet(),
        select,
        disconnect: async () => {
          if (active?.walletClientType === 'privy') await logout()
          else await active?.disconnect()
          select(undefined)
        },
        client: async (chain) => {
          const wallet = latest.current
          if (!ready || !walletsReady || !wallet)
            throw new Error(
              'Connect your wallet first, then try this action again',
            )
          if (chain) await wallet.switchChain(chain.id)
          const provider = await wallet.getEthereumProvider()
          const client = createWalletClient({
            account: wallet.address as Address,
            chain,
            transport: custom(provider),
          })
          const accounts = await client.getAddresses()
          if (
            latest.current?.address.toLowerCase() !==
              wallet.address.toLowerCase() ||
            !accounts.some(
              (a) => a.toLowerCase() === wallet.address.toLowerCase(),
            )
          )
            throw new Error('Your wallet changed. Review the action again')
          return client
        },
      }}
    >
      {children}
    </WalletContext.Provider>
  )
}

export function ArcadeWalletProvider({ children }: { children: ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID
  if (!appId)
    return (
      <WalletContext.Provider value={unavailable}>
        {children}
      </WalletContext.Provider>
    )
  return (
    <PrivyProvider
      appId={appId}
      clientId={process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID}
      config={{
        loginMethods: ['wallet', 'email'],
        appearance: {
          theme: 'light',
          accentColor: '#292524',
          walletChainType: 'ethereum-only',
        },
        supportedChains: Object.values(NETWORKS)
          .filter((n) => n.testnet)
          .map((n) => n.chain),
        defaultChain: NETWORKS['base-sepolia'].chain,
        embeddedWallets: {
          ethereum: { createOnLogin: 'users-without-wallets' },
          showWalletUIs: true,
        },
      }}
    >
      <ConnectedProvider>{children}</ConnectedProvider>
    </PrivyProvider>
  )
}

export function WalletConnectionButton({
  disabled = false,
}: {
  disabled?: boolean
}) {
  const wallet = useArcadeWallet()
  const [error, setError] = useState('')
  return (
    <div className="wallet-connection">
      {wallet.address ? (
        <>
          <label className="wallet-select">
            Your wallet
            <select
              disabled={disabled}
              value={wallet.address}
              onChange={(e) => wallet.select(e.target.value)}
            >
              {wallet.wallets.map((w) => (
                <option key={w.address} value={w.address}>
                  {w.label} · {w.address.slice(0, 6)}…{w.address.slice(-4)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="secondary"
            disabled={disabled}
            onClick={wallet.connect}
          >
            Add wallet
          </button>
          <button
            type="button"
            className="secondary"
            disabled={disabled}
            onClick={() =>
              void wallet
                .disconnect()
                .catch(() => setError('Could not disconnect. Try again.'))
            }
          >
            Disconnect
          </button>
        </>
      ) : (
        <button
          type="button"
          className="secondary"
          disabled={disabled || !wallet.configured || !wallet.ready}
          onClick={wallet.connect}
        >
          {!wallet.configured
            ? 'Wallet connection coming soon'
            : wallet.ready
              ? 'Connect wallet'
              : 'Loading wallet…'}
        </button>
      )}
      {error && <small role="alert">{error}</small>}
    </div>
  )
}
