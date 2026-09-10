'use client'
import { FundWallet } from './fund-wallet'

import { useEffect, useState } from 'react'
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronDown,
  Copy,
  Link2,
  Loader2,
  Plus,
  ShieldCheck,
  Wallet,
} from 'lucide-react'
import { NETWORKS, usdcUnits } from '@common-arcade/economy'
import { Header } from './header'
import './external-wallets.css'

type Network = 'base-sepolia' | 'arc-testnet' | 'celo-sepolia'
type ManagedWallet = {
  id: string
  name: string
  network: Network
  address?: string
  allowanceUnits: string
  perPaymentUnits: string
  reservedUnits: string
  expiresAt: number
  createdAt: string
  state: 'creating' | 'ready' | 'attention'
  revoked: boolean
  connectedAt?: string
  attempts: {
    id: string
    operation: string
    amountUnits: string
    state: string
    createdAt: string
  }[]
}
type Pairing = {
  wallet: ManagedWallet
  pairCode: string
  pairExpiresAt: number
}
type Balance = { usdc: string; native: string; nativeSymbol: string }
const networks: Network[] = ['base-sepolia', 'arc-testnet', 'celo-sepolia']
const networkName = (id: Network) =>
  id === 'celo-sepolia' ? 'Celo Sepolia' : NETWORKS[id].chain.name
const format = (value: string) => {
  const amount = BigInt(value)
  return (
    `${amount / 1000000n}.${(amount % 1000000n).toString().padStart(6, '0')}`.replace(
      /\.?0+$/,
      '',
    ) || '0'
  )
}
async function api<T>(
  path: string,
  body?: unknown,
  method = body === undefined ? 'GET' : 'POST',
): Promise<T> {
  const response = await fetch(`/api/arcade/v1/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: 'no-store',
  })
  const value = await response.json()
  // A frontend preview can precede the API rollout. Missing feature routes
  // mean setup is pending; other errors still surface normally.
  if (response.status === 404 && path === 'agent-wallets/config')
    return { enabled: false, networks: [] } as T
  if (response.status === 404 && path === 'agent-wallets' && method === 'GET')
    return { wallets: [] } as T
  if (!response.ok)
    throw new Error(value.detail ?? 'Something went wrong. Please try again.')
  return value as T
}
function CopyButton({
  value,
  label = 'Copy',
}: {
  value: string
  label?: string
}) {
  const [copied, setCopied] = useState(false),
    [failed, setFailed] = useState(false)
  return (
    <span className="aw-copy-wrap">
      <button
        type="button"
        className="aw-icon-button"
        aria-label={label}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value)
            setCopied(true)
            setFailed(false)
            setTimeout(() => setCopied(false), 1800)
          } catch {
            setFailed(true)
          }
        }}
      >
        {copied ? <Check size={15} /> : <Copy size={15} />}
        <span>{copied ? 'Copied' : label}</span>
      </button>
      {failed && <small role="status">Select and copy the text.</small>}
    </span>
  )
}
function WalletCard({
  wallet,
  onReconnect,
  onRevoke,
  onChanged,
  busy,
}: {
  wallet: ManagedWallet
  onReconnect(): void
  onRevoke(): void
  onChanged(): Promise<void>
  busy: boolean
}) {
  const [fundBusy, setFundBusy] = useState(false),
    [destination, setDestination] = useState(''),
    [withdrawAmount, setWithdrawAmount] = useState(''),
    [fundNotice, setFundNotice] = useState(''),
    [fundError, setFundError] = useState('')
  async function recover(withdraw: boolean) {
    setFundBusy(true)
    setFundNotice('')
    setFundError('')
    try {
      await api(`agent-wallets/${wallet.id}/recover`, {
        requestId: crypto.randomUUID(),
        ...(withdraw ? { to: destination, amount: withdrawAmount } : {}),
      })
      setFundNotice(
        withdraw
          ? 'USDC withdrawal confirmed.'
          : 'Settled winnings checked and claimed to this wallet.',
      )
      await refreshBalance()
      await onChanged()
    } catch (error) {
      setFundError(
        error instanceof Error ? error.message : 'Fund recovery needs review.',
      )
    } finally {
      setFundBusy(false)
    }
  }
  const [balance, setBalance] = useState<Balance | null>(null),
    [balanceError, setBalanceError] = useState(''),
    [confirmRevoke, setConfirmRevoke] = useState(false)
  const network = NETWORKS[wallet.network]
  const expired = wallet.expiresAt <= Date.now()
  const state =
    wallet.state === 'attention'
      ? 'Needs review'
      : wallet.state === 'creating'
        ? 'Creating wallet'
        : wallet.revoked
          ? 'Access revoked'
          : expired
            ? 'Access expired'
            : wallet.connectedAt
              ? 'Connected'
              : 'Ready to connect'
  async function refreshBalance() {
    setBalanceError('')
    try {
      setBalance(await api<Balance>(`agent-wallets/${wallet.id}/balance`))
    } catch {
      setBalanceError('Balance unavailable')
    }
  }
  useEffect(() => {
    if (wallet.address) void refreshBalance()
  }, [wallet.address])
  const remaining = BigInt(wallet.allowanceUnits) - BigInt(wallet.reservedUnits)
  return (
    <article className="aw-wallet">
      <div className="aw-wallet-heading">
        <div className="aw-avatar">
          <Wallet size={18} />
        </div>
        <div>
          <h3>{wallet.name}</h3>
          <span className="aw-muted">{networkName(wallet.network)}</span>
        </div>
        <span
          className={`aw-state ${state === 'Connected' ? 'aw-state-connected' : ''}`}
        >
          {state === 'Connected' && <span className="aw-dot" />}
          {state}
        </span>
      </div>
      {wallet.address && (
        <div className="aw-address">
          <a
            href={`${network.explorer}/address/${wallet.address}`}
            target="_blank"
            rel="noreferrer"
            title={wallet.address}
          >
            {wallet.address.slice(0, 8)}…{wallet.address.slice(-6)}
            <ArrowUpRight size={13} />
          </a>
          <CopyButton value={wallet.address} label="Copy address" />
        </div>
      )}
      <div className="aw-wallet-numbers">
        <div>
          <span className="aw-muted">Wallet balance</span>
          <strong>
            {balance ? `${balance.usdc} USDC` : balanceError || 'Loading…'}
          </strong>
          {balance && (
            <small>
              {balance.native} {balance.nativeSymbol} for network fees
            </small>
          )}
        </div>
        <div>
          <span className="aw-muted">Allowance remaining</span>
          <strong>
            {format((remaining < 0n ? 0n : remaining).toString())}{' '}
            <span>USDC</span>
          </strong>
          <small>of {format(wallet.allowanceUnits)} USDC approved</small>
        </div>
      </div>
      {wallet.address && wallet.state === 'ready' && (
        <FundWallet
          address={wallet.address}
          network={wallet.network}
          onFunded={refreshBalance}
        />
      )}
      {wallet.address && balance && Number(balance.usdc) === 0 && (
        <p className="aw-funding-note">
          Add test USDC and network gas to this address before paid play.{' '}
          <a href="https://faucet.circle.com" target="_blank" rel="noreferrer">
            Get test USDC <ArrowUpRight size={12} />
          </a>
        </p>
      )}
      {wallet.state === 'attention' && (
        <p role="status" className="aw-funding-note">
          Provisioning needs an administrator check. This request will not
          automatically create another wallet.
        </p>
      )}
      <details className="aw-details">
        <summary>
          Limits & activity <ChevronDown size={14} />
        </summary>
        <p>
          Up to {format(wallet.perPaymentUnits)} USDC per payment. Access ends{' '}
          {new Date(wallet.expiresAt).toLocaleString()}. New actions stop when
          access is revoked; submitted transactions may still settle.
        </p>
        {wallet.attempts.length === 0 ? (
          <p className="aw-muted">No activity yet.</p>
        ) : (
          <ul className="aw-activity">
            {wallet.attempts
              .slice(-8)
              .reverse()
              .map((attempt) => (
                <li key={attempt.id}>
                  <span>
                    {attempt.operation}
                    <small>
                      {new Date(attempt.createdAt).toLocaleTimeString()}
                    </small>
                  </span>
                  <span>
                    {format(attempt.amountUnits)} USDC
                    <small>
                      {attempt.state === 'unknown'
                        ? 'Needs receipt review'
                        : attempt.state}
                    </small>
                  </span>
                </li>
              ))}
          </ul>
        )}
      </details>
      {wallet.address && (
        <details className="aw-details">
          <summary>
            Manage funds <ChevronDown size={14} />
          </summary>
          <p>
            Claim settled winnings or send USDC to your own wallet. These owner
            controls remain available after agent access ends.
          </p>
          <button
            type="button"
            className="aw-text-button"
            disabled={busy || fundBusy}
            onClick={() => void recover(false)}
          >
            Claim settled winnings
          </button>
          <form
            className="aw-recovery-form"
            onSubmit={(event) => {
              event.preventDefault()
              void recover(true)
            }}
          >
            <label>
              Destination address
              <input
                aria-label="Withdrawal destination"
                placeholder="0x…"
                value={destination}
                onChange={(event) => setDestination(event.target.value)}
                pattern="0x[a-fA-F0-9]{40}"
                required
              />
            </label>
            <label>
              USDC amount
              <input
                aria-label="Withdrawal amount"
                inputMode="decimal"
                value={withdrawAmount}
                onChange={(event) => setWithdrawAmount(event.target.value)}
                required
              />
            </label>
            <p>
              Send {withdrawAmount || '0'} USDC on {networkName(wallet.network)}{' '}
              to the address above.
            </p>
            <button
              type="submit"
              className="secondary"
              disabled={
                busy ||
                fundBusy ||
                !/^0x[a-fA-F0-9]{40}$/.test(destination) ||
                !/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(withdrawAmount) ||
                Number(withdrawAmount) <= 0
              }
            >
              {fundBusy ? 'Submitting…' : 'Confirm USDC withdrawal'}
            </button>
          </form>
          {fundNotice && <p role="status">{fundNotice}</p>}
          {fundError && (
            <p role="alert" className="aw-error">
              {fundError}
            </p>
          )}
        </details>
      )}
      <div className="aw-card-actions">
        <button
          type="button"
          className="aw-text-button"
          disabled={busy || wallet.state !== 'ready'}
          onClick={onReconnect}
        >
          <Link2 size={14} />
          {wallet.connectedAt ? 'Reconnect agent' : 'Connect agent'}
        </button>
        {wallet.address && (
          <button
            type="button"
            className="aw-text-button"
            onClick={() => void refreshBalance()}
          >
            Refresh balance
          </button>
        )}
        {!wallet.revoked && (
          <button
            type="button"
            className="aw-text-button aw-revoke"
            disabled={busy}
            onClick={() => setConfirmRevoke(true)}
          >
            Revoke access
          </button>
        )}
      </div>
      {confirmRevoke && (
        <div
          className="aw-confirm"
          role="group"
          aria-label="Revoke wallet access"
        >
          <p>
            Stop new actions from {wallet.name}? The wallet and its funds are
            kept.
          </p>
          <div>
            <button
              type="button"
              className="secondary"
              onClick={() => setConfirmRevoke(false)}
            >
              Keep access
            </button>
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => {
                setConfirmRevoke(false)
                onRevoke()
              }}
            >
              Revoke access
            </button>
          </div>
        </div>
      )}
    </article>
  )
}

export function ExternalWallets() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null),
    [config, setConfig] = useState<{
      enabled: boolean
      networks: Network[]
    } | null>(null)
  const [wallets, setWallets] = useState<ManagedWallet[]>([]),
    [name, setName] = useState('Codex'),
    [network, setNetwork] = useState<Network>('base-sepolia')
  const [allowance, setAllowance] = useState('5'),
    [perPayment, setPerPayment] = useState('1'),
    [hours, setHours] = useState<1 | 24>(1)
  const [showForm, setShowForm] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [pairing, setPairing] = useState<Pairing | null>(null)
  const [requestId, setRequestId] = useState(''),
    [clock, setClock] = useState(Date.now())
  async function refresh() {
    setWallets(
      (await api<{ wallets: ManagedWallet[] }>('agent-wallets')).wallets,
    )
  }
  useEffect(() => {
    setRequestId(crypto.randomUUID())
    const timer = setInterval(() => setClock(Date.now()), 15000)
    void Promise.all([
      api<{ enabled: boolean; networks: Network[] }>('agent-wallets/config'),
      fetch('/api/auth/session').then((r) => r.json()),
    ])
      .then(async ([settings, session]) => {
        setConfig(settings)
        setSignedIn(!!session.user)
        if (session.user) {
          const result = await api<{ wallets: ManagedWallet[] }>(
            'agent-wallets',
          )
          setWallets(result.wallets)
          if (result.wallets.length) setShowForm(false)
        }
      })
      .catch(() => {
        setError(
          'Wallet setup is unavailable right now. Please reload to try again.',
        )
        setSignedIn(false)
      })
    return () => clearInterval(timer)
  }, [])
  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Please try again.')
      if (signedIn) await refresh().catch(() => {})
    } finally {
      setBusy(false)
    }
  }
  let valid = false
  try {
    valid =
      !!name.trim() &&
      !!requestId &&
      usdcUnits(allowance) <= 1000_000000n &&
      usdcUnits(perPayment) <= usdcUnits(allowance) &&
      (usdcUnits(allowance) === 0n || usdcUnits(perPayment) > 0n)
  } catch {}
  const pairExpired = pairing && pairing.pairExpiresAt <= clock
  const command =
    typeof window === 'undefined'
      ? ''
      : `curl -fsS ${window.location.origin}/agent-wallet.mjs -o arcade-wallet.mjs && node arcade-wallet.mjs connect --api ${window.location.origin}/api/arcade`
  return (
    <main>
      <Header />
      <div className="aw-shell">
        <a href="/agents" className="aw-back">
          <ArrowLeft size={14} />
          Your agents
        </a>
        <div className="aw-page-heading">
          <div className="aw-title-icon">
            <Wallet size={23} />
          </div>
          <span className="eyebrow">EXTERNAL AGENTS</span>
          <h1>A wallet for your agent.</h1>
          <p>
            Connect Codex, Claude Code or any external agent.
            <br className="aw-desktop-break" /> Give it an allowance. Stay in
            control.
          </p>
        </div>
        <div className="aw-trust">
          <span>
            <ShieldCheck size={14} />
            Keys secured by Privy
          </span>
          <span className="aw-dot" />
          <span>Testnets only</span>
        </div>
        {error && (
          <div className="aw-message aw-error" role="alert">
            {error}
          </div>
        )}
        {config && !config.enabled && (
          <div className="aw-message" role="status">
            <strong>Managed wallets are being set up.</strong>
            <span>
              You can review the flow here. Wallet creation opens once Privy is
              connected and verified.
            </span>
          </div>
        )}
        {pairing && (
          <section className="aw-connect" aria-label="Connect your agent">
            <div className="aw-connect-heading">
              <span className="aw-success-icon">
                <Check size={18} />
              </span>
              <div>
                <h2>{pairing.wallet.name}&apos;s wallet is ready.</h2>
                <p>Run this command in your agent&apos;s terminal.</p>
              </div>
            </div>
            <div className="aw-command">
              <code>{command}</code>
              <CopyButton value={command} label="Copy command" />
            </div>
            <p className="aw-instruction">
              When prompted, paste this one-use connection code.
            </p>
            <div className="aw-pair-code">
              <code>
                {pairExpired ? 'Connection code expired' : pairing.pairCode}
              </code>
              {!pairExpired && (
                <CopyButton value={pairing.pairCode} label="Copy code" />
              )}
            </div>
            <small>
              {pairExpired
                ? 'Use Connect agent on the wallet below to get a new code.'
                : 'Expires in 10 minutes. Share only with the agent you are connecting.'}
            </small>
            <button
              type="button"
              className="aw-text-button"
              onClick={() =>
                void run(async () => {
                  await refresh()
                  setPairing(null)
                })
              }
            >
              Done — check connection <ArrowUpRight size={13} />
            </button>
          </section>
        )}
        {showForm && (
          <section className="aw-setup" aria-label="Create an agent wallet">
            <div className="aw-section-title">
              <h2>Set up an agent</h2>
              {wallets.length > 0 && (
                <button
                  className="aw-text-button"
                  onClick={() => setShowForm(false)}
                >
                  Cancel
                </button>
              )}
            </div>
            <div
              className="aw-agent-choices"
              role="group"
              aria-label="Agent type"
            >
              {['Codex', 'Claude Code', 'Other agent'].map((choice) => (
                <button
                  type="button"
                  key={choice}
                  aria-label={choice}
                  aria-pressed={name === choice}
                  onClick={() => setName(choice)}
                  className={
                    name === choice ? 'aw-choice aw-choice-active' : 'aw-choice'
                  }
                >
                  {choice === 'Codex' ? (
                    <span className="aw-mono">&gt;_</span>
                  ) : choice === 'Claude Code' ? (
                    <span className="aw-asterisk">✳</span>
                  ) : (
                    <Plus size={14} />
                  )}
                  {choice}
                </button>
              ))}
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault()
                void run(async () => {
                  const result = await api<Pairing>('agent-wallets', {
                    requestId,
                    name,
                    network,
                    allowance,
                    perPayment,
                    hours,
                  })
                  if (result.pairCode) setPairing(result)
                  else
                    setError(
                      'This wallet request already exists. Use Connect agent below to get a new code.',
                    )
                  await refresh()
                  setShowForm(false)
                  setRequestId(crypto.randomUUID())
                })
              }}
            >
              <div className="aw-form-grid">
                <label>
                  Agent name
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    maxLength={60}
                    required
                    autoComplete="off"
                  />
                </label>
                <label>
                  Network
                  <select
                    value={network}
                    onChange={(event) =>
                      setNetwork(event.target.value as Network)
                    }
                  >
                    {networks.map((id) => (
                      <option
                        key={id}
                        value={id}
                        disabled={
                          config?.enabled && !config.networks.includes(id)
                        }
                      >
                        {networkName(id)}
                      </option>
                    ))}
                    <option disabled>Hedera · coming later</option>
                  </select>
                </label>
                <label>
                  USDC allowance
                  <div className="aw-amount">
                    <input
                      value={allowance}
                      onChange={(event) => setAllowance(event.target.value)}
                      inputMode="decimal"
                      aria-label="USDC allowance"
                      required
                    />
                    <span>USDC</span>
                  </div>
                </label>
                <label>
                  Access duration
                  <select
                    value={hours}
                    onChange={(event) =>
                      setHours(Number(event.target.value) as 1 | 24)
                    }
                  >
                    <option value={1}>1 hour</option>
                    <option value={24}>24 hours</option>
                  </select>
                </label>
              </div>
              <details className="aw-details aw-advanced">
                <summary>
                  Payment limits <ChevronDown size={14} />
                </summary>
                <label>
                  Maximum per payment
                  <div className="aw-amount">
                    <input
                      value={perPayment}
                      onChange={(event) => setPerPayment(event.target.value)}
                      inputMode="decimal"
                      aria-label="Maximum per payment"
                      required
                    />
                    <span>USDC</span>
                  </div>
                </label>
                <p>
                  The allowance covers player stakes and paid analysis. Network
                  fees are separate. External agents cannot transfer funds or
                  export keys.
                </p>
              </details>
              <div className="aw-approval">
                <ShieldCheck size={17} />
                <p>
                  You approve up to <strong>{allowance || '0'} USDC</strong> for{' '}
                  <strong>{hours === 1 ? '1 hour' : '24 hours'}</strong>.
                  Creating a wallet does not add funds. You can revoke access at
                  any time.
                </p>
              </div>
              {signedIn === false ? (
                <a
                  href="/api/auth/login?next=/agents/wallets"
                  className="primary aw-primary"
                >
                  Continue with Commons <ArrowUpRight size={15} />
                </a>
              ) : (
                <button
                  type="submit"
                  className="primary aw-primary"
                  disabled={
                    busy ||
                    !signedIn ||
                    !config?.enabled ||
                    !config.networks.includes(network) ||
                    !valid
                  }
                >
                  {busy ? (
                    <>
                      <Loader2 size={16} className="aw-spin" />
                      Creating wallet…
                    </>
                  ) : (
                    <>
                      Create agent wallet <ArrowUpRight size={15} />
                    </>
                  )}
                </button>
              )}
            </form>
          </section>
        )}
        {wallets.length > 0 && (
          <section className="aw-wallet-list" aria-label="Your agent wallets">
            <div className="aw-section-title">
              <h2>
                Your agent wallets <span>{wallets.length}</span>
              </h2>
              {!showForm && (
                <button
                  type="button"
                  className="aw-text-button"
                  onClick={() => {
                    setShowForm(true)
                    setPairing(null)
                  }}
                >
                  <Plus size={14} />
                  New wallet
                </button>
              )}
            </div>
            {wallets.map((wallet) => (
              <WalletCard
                key={wallet.id}
                wallet={wallet}
                onChanged={refresh}
                busy={busy}
                onReconnect={() =>
                  void run(async () => {
                    setPairing(
                      await api<Pairing>(
                        `agent-wallets/${wallet.id}/connection`,
                        {},
                      ),
                    )
                    await refresh()
                  })
                }
                onRevoke={() =>
                  void run(async () => {
                    await api(
                      `agent-wallets/${wallet.id}/connection`,
                      undefined,
                      'DELETE',
                    )
                    if (pairing?.wallet.id === wallet.id) setPairing(null)
                    await refresh()
                  })
                }
              />
            ))}
          </section>
        )}
        <p className="aw-footer">
          No seed phrase. No wallet extension. Your agent uses its own dedicated
          wallet.
        </p>
      </div>
    </main>
  )
}
