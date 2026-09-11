'use client'
import type { Observation } from '@common-arcade/protocol'
import { useEffect, useState, useRef } from 'react'
import { Wallet2 } from 'lucide-react'
import {
  NETWORKS,
  hashArcadeId,
  usdcUnits,
  type PaymentNetwork,
} from '@common-arcade/economy'
import { AgentSelect } from './agent-select'
import { Select, SelectOption } from './ui/select'
export interface AgentTableContext {
  id: string
  stage?: string
  pool?: string
  deployment?: { contract: string; chainId: number }
  economy: { mode: string; network?: string }
  sequence: number
  state: { hands: Record<string, number[]>; turn: string | null } | null
  recipients: string[]
}
interface Agent {
  agentId: string
  name: string
}
interface Wallet {
  id: string
  address: string
  walletType: string
  chainId: string
  isActive: boolean
}
interface Grant {
  id: string
  wallet_id: string
  runtime_session_id: string
  budget_units: string
  reserved_units: string
  expires_at: string
  revoked_at: string | null
  policy: {
    network: string
    payTo: string
    origin: string
    arcade?: { matchId: string }
  }
}
interface Attempt {
  id: string
  state: string
  amount_units: string
  resource: string
  settlement?: { transaction?: string }
}
async function api<T>(
  path: string,
  body?: unknown,
  method = body === undefined ? 'GET' : 'POST',
): Promise<T> {
  const response = await fetch(`/api/agent-wallets/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const value = await response.json()
  if (!response.ok)
    throw new Error(
      Array.isArray(value.message)
        ? value.message.join(', ')
        : (value.message ?? value.error ?? 'Wallet operation failed'),
    )
  return value as T
}
const format = (value: string) => {
  const n = BigInt(value)
  return `${n / 1000000n}.${(n % 1000000n).toString().padStart(6, '0')}`
}
export function AgentWalletPanel({
  table,
  onWalletSelected,
  initialAgentId,
  initialRuntimeId,
  returnTo = '/agents',
}: {
  table?: AgentTableContext
  onWalletSelected?: (address: string) => void
  initialAgentId?: string
  initialRuntimeId?: string
  returnTo?: string
}) {
  const [agentRunning, setAgentRunning] = useState(false),
    [agents, setAgents] = useState<Agent[]>([]),
    [agentId, setAgentId] = useState(''),
    [wallets, setWallets] = useState<Wallet[]>([]),
    [walletId, setWalletId] = useState(''),
    [grants, setGrants] = useState<Grant[]>([]),
    [attempts, setAttempts] = useState<Attempt[]>([]),
    [selectedGrant, setSelectedGrant] = useState(''),
    [signedIn, setSignedIn] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [balance, setBalance] = useState(''),
    [network, setNetwork] = useState<PaymentNetwork>('base-sepolia'),
    [kind, setKind] = useState<'x402' | 'arcade'>('x402'),
    [runtime, setRuntime] = useState(initialRuntimeId ?? ''),
    [origin, setOrigin] = useState(
      process.env.NEXT_PUBLIC_ARCADE_PAYMENTS_URL ?? '',
    ),
    [recipient, setRecipient] = useState(''),
    [budget, setBudget] = useState('5'),
    [perPayment, setPerPayment] = useState('1'),
    [minutes, setMinutes] = useState('60'),
    [seat, setSeat] = useState('sea_player_2'),
    [operations, setOperations] = useState({
      stake: true,
      bounty: false,
      bet: false,
    })
  const [runtimeSessions, setRuntimeSessions] = useState<
    { sessionId: string; title: string | null }[]
  >([])
  /* Technical settings start open only if something in them still needs
   * filling; after that the reader owns the disclosure. Initialised once on
   * purpose, so it does not spring back open as they type. */
  const [showAdvanced, setShowAdvanced] = useState(
    () =>
      !(initialRuntimeId ?? '') || !process.env.NEXT_PUBLIC_ARCADE_PAYMENTS_URL,
  )
  useEffect(() => {
    if (!agentId) return
    let cancelled = false
    setRuntimeSessions([])
    api<{ sessionId: string; title: string | null }[]>(
      `wallets/agent/${agentId}/runtime-sessions`,
    )
      .then((value) => {
        if (!cancelled) setRuntimeSessions(value)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [agentId])
  const attemptedTurn = useRef('')
  const wallet = wallets.find((w) => w.id === walletId),
    config = NETWORKS[network]
  useEffect(() => {
    if (
      kind !== 'x402' ||
      !initialRuntimeId ||
      !origin ||
      origin !== process.env.NEXT_PUBLIC_ARCADE_PAYMENTS_URL
    )
      return
    const controller = new AbortController()
    fetch(`${origin}/.well-known/x402`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return
        return response.json()
      })
      .then((value) => {
        const rail = value?.services?.find(
          (entry: { network: string }) => entry.network === config.x402Network,
        )
        if (rail?.payTo && !controller.signal.aborted) setRecipient(rail.payTo)
      })
      .catch(() => {})
    return () => controller.abort()
  }, [kind, initialRuntimeId, origin, config.x402Network])
  async function refresh() {
    setGrants(await api<Grant[]>(`wallets/agent/${agentId}/payment-sessions`))
  }
  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed')
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    let cancelled = false
    fetch('/api/auth/session')
      .then((r) => r.json())
      .then(async (session) => {
        if (cancelled) return
        setSignedIn(!!session.user)
        if (!session.user) return
        const result = await api<Agent[] | { data: Agent[] }>('agents')
        if (cancelled) return
        const list = Array.isArray(result) ? result : result.data
        setAgents(list)
        setAgentId(
          list.find((agent) => agent.agentId === initialAgentId)?.agentId ??
            list[0]?.agentId ??
            '',
        )
      })
      .catch((e) => {
        if (!cancelled) setError(e.message)
      })
    return () => {
      cancelled = true
    }
  }, [initialAgentId])
  useEffect(() => {
    if (!agentId) return
    let cancelled = false
    setWallets([])
    setGrants([])
    setAttempts([])
    setSelectedGrant('')
    Promise.all([
      api<Wallet[]>(`wallets/agent/${agentId}`),
      api<Grant[]>(`wallets/agent/${agentId}/payment-sessions`),
    ])
      .then(([list, grants]) => {
        if (cancelled) return
        setWallets(list)
        setWalletId(
          list.find((w) => w.isActive && w.walletType === 'eoa')?.id ?? '',
        )
        setGrants(grants)
      })
      .catch((e) => {
        if (!cancelled) setError(e.message)
      })
    return () => {
      cancelled = true
    }
  }, [agentId])
  useEffect(() => {
    if (!walletId) return
    let cancelled = false
    setBalance('')
    api<{ usdc: string }>(
      `wallets/${walletId}/balance?chainId=${config.chain.id}`,
    )
      .then((r) => {
        if (!cancelled) setBalance(r.usdc)
      })
      .catch(() => {
        if (!cancelled) setBalance('Unavailable — fund/activate this network')
      })
    return () => {
      cancelled = true
    }
  }, [walletId, config.chain.id])
  useEffect(() => {
    if (table?.economy.mode === 'escrow' && table.pool && table.deployment) {
      setKind('arcade')
      setRecipient(table.deployment.contract)
      setNetwork(table.economy.network as PaymentNetwork)
    }
  }, [table?.id])
  async function createGrant() {
    const policy = {
      network: config.x402Network,
      asset: config.asset,
      payTo: kind === 'arcade' ? table?.deployment?.contract : recipient,
      origin: new URL(origin).origin,
      maxPaymentUnits: usdcUnits(perPayment).toString(),
      ...(kind === 'arcade'
        ? {
            arcade: {
              poolId: table?.pool,
              matchId: table?.id,
              seatId: hashArcadeId(seat),
              allowedOperations: Object.entries(operations)
                .filter(([, on]) => on)
                .map(([name]) => name),
            },
          }
        : {}),
    }
    const created = await api<Grant>(
      `wallets/agent/${agentId}/payment-sessions`,
      {
        walletId,
        runtimeSessionId: runtime,
        policy,
        budgetUnits: usdcUnits(budget).toString(),
        expiresAt: new Date(Date.now() + Number(minutes) * 60000).toISOString(),
      },
    )
    setSelectedGrant(created.id)
    setNotice(
      'Spending grant created. The agent can spend only within these limits.',
    )
    await refresh()
  }
  async function inspect(id: string) {
    setSelectedGrant(id)
    const selected = grants.find((g) => g.id === id)
    if (selected) {
      setWalletId(selected.wallet_id)
      const rail = Object.values(NETWORKS).find(
        (n) =>
          selected.policy.network === n.x402Network ||
          selected.policy.network === `eip155:${n.chain.id}`,
      )
      if (rail) setNetwork(rail.id)
    }
    setAttempts(
      await api<Attempt[]>(
        `wallets/agent/${agentId}/payment-sessions/${id}/attempts`,
      ),
    )
  }
  async function paidAnalysis() {
    const active = grants.find((g) => g.id === selectedGrant)
    if (!active || active.policy.arcade)
      throw new Error('Select an x402 service grant first')
    const rail = Object.values(NETWORKS).find(
      (n) => n.x402Network === active.policy.network,
    )
    if (!rail) throw new Error('Unknown payment rail')
    const player =
      table?.recipients.findIndex(
        (a) => a.toLowerCase() === wallet?.address.toLowerCase(),
      ) ?? -1
    const hand =
      table?.state && player >= 0
        ? table.state.hands[player === 0 ? 'sea_player_1' : 'sea_player_2']
        : [0, 8]
    const visibleCards = table?.state
      ? Object.values(table.state.hands).flat()
      : [0, 8, 12, 13]
    const result = await api<{ status: number; body: unknown }>(
      `wallets/agent/${agentId}/x402-fetch`,
      {
        url: `${active.policy.origin}/v1/analysis/${rail.id}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hand, visibleCards }),
        paymentSessionId: active.id,
        runtimeSessionId: active.runtime_session_id,
        idempotencyKey: crypto.randomUUID(),
      },
    )
    await inspect(active.id)
    await refresh()
    if (result.status >= 400) throw new Error(JSON.stringify(result.body))
    setNotice(`Paid analysis completed: ${JSON.stringify(result.body)}`)
  }
  const grant = grants.find((g) => g.id === selectedGrant)
  async function deposit() {
    if (!grant) throw new Error('Select an active Arcade grant first')
    await api(`wallets/agent/${agentId}/arcade/deposit`, {
      paymentSessionId: grant.id,
      runtimeSessionId: grant.runtime_session_id,
      idempotencyKey: crypto.randomUUID(),
      operation: 'stake',
    })
    await inspect(grant.id)
    await refresh()
    setNotice('Agent stake confirmed.')
  }
  async function play() {
    if (!grant || !table || grant.policy.arcade?.matchId !== table.id)
      throw new Error('Select this match’s active grant')
    const observed = await api<{ status: number; body: Observation }>(
      `wallets/agent/${agentId}/arcade/observation`,
      {
        paymentSessionId: grant.id,
        runtimeSessionId: grant.runtime_session_id,
      },
    )
    if (observed.status >= 400) throw new Error(JSON.stringify(observed.body))
    const observation = observed.body
    if (!observation.legalActions.length) {
      setNotice('Waiting for an available action.')
      return
    }
    const response = await fetch('/api/arcade/v1/commons/live-decisions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId, observation }),
    })
    const decision = await response.json()
    if (!response.ok)
      throw new Error(decision.detail ?? 'Agent decision failed')
    const result = await api<{ status: number; body: unknown }>(
      `wallets/agent/${agentId}/arcade/action`,
      {
        paymentSessionId: grant.id,
        runtimeSessionId: grant.runtime_session_id,
        actionId: crypto.randomUUID(),
        sequence: observation.stateSequence,
        payload: decision.action,
      },
    )
    if (result.status >= 400) throw new Error(JSON.stringify(result.body))
    setNotice(
      `Agent played ${JSON.stringify(decision.action)}. ${decision.reason ?? ''}`,
    )
  }
  useEffect(() => {
    if (
      !agentRunning ||
      busy ||
      table?.stage !== 'playing' ||
      !grant ||
      grant.revoked_at
    )
      return
    const player = table.recipients.findIndex(
      (a) => a.toLowerCase() === wallet?.address.toLowerCase(),
    )
    if (
      table.state &&
      table.state.turn !==
        (player === 0 ? 'sea_player_1' : player === 1 ? 'sea_player_2' : '')
    )
      return
    const turnKey = `${table.id}:${table.sequence}:${selectedGrant}`
    if (attemptedTurn.current === turnKey) return
    attemptedTurn.current = turnKey
    setBusy(true)
    play()
      .catch((e) => {
        setError(e.message)
        setAgentRunning(false)
      })
      .finally(() => setBusy(false))
  }, [agentRunning, table?.sequence, busy, selectedGrant, walletId])
  return (
    <section className="launch-card payment-panel payment-panel-body">
      <h2>Agent wallets & spending</h2>
      <p>
        Give an Agent Commons agent a budget for this session. Payments remain
        off until you create a grant.
      </p>
      {!signedIn ? (
        <a
          className="primary"
          href={`/api/auth/login?next=${encodeURIComponent(returnTo)}`}
        >
          Sign in with Agent Commons
        </a>
      ) : (
        <>
          <div className="field">
            <span className="field-label">Agent</span>
            <AgentSelect
              agents={agents}
              value={agentId}
              onChange={setAgentId}
              disabled={busy}
            />
            {!agents.length && (
              <p className="field-hint">
                You have no Commons agents yet.{' '}
                <a href="https://www.agentcommons.io" className="inline-link">
                  Create one in Commons
                </a>{' '}
                to give it a wallet here.
              </p>
            )}
          </div>

          {/* The agent's payment wallet is chosen for it — the first active EOA
              — so this reports which wallet will pay rather than offering a
              choice. It was previously a <select> whose only enabled option was
              already selected. */}
          {agentId &&
            (wallet ? (
              <div className="wallet-summary">
                <div className="wallet-summary-head">
                  <Wallet2 size={16} aria-hidden />
                  <span>Payment wallet</span>
                  <strong className="wallet-balance">
                    {balance ? `${balance} USDC` : 'Loading…'}
                  </strong>
                </div>
                <code>{wallet.address}</code>
                <p className="field-hint">
                  On {config.chain.name}. This is the wallet every grant below
                  spends from.
                </p>
                {onWalletSelected && (
                  <button
                    type="button"
                    className="secondary compact"
                    onClick={() => onWalletSelected(wallet.address)}
                  >
                    Use as other player
                  </button>
                )}
              </div>
            ) : (
              <p className="field-hint" role="status">
                {wallets.length
                  ? 'This agent has no active wallet that can make payments. Activate one in Commons.'
                  : 'Looking up this agent’s wallet…'}
              </p>
            ))}
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void run(createGrant)
            }}
            className="grant-form"
          >
            {/* What the money is for. Everything below reshapes around this,
                so it leads. */}
            <div className="field">
              <span className="field-label">What is this budget for?</span>
              <Select
                value={kind}
                onValueChange={(next) => setKind(next as typeof kind)}
                ariaLabel="Grant purpose"
              >
                <SelectOption
                  value="x402"
                  title="Paid services"
                  hint="Let the agent pay x402 services as it works"
                />
                <SelectOption
                  value="arcade"
                  disabled={!table?.pool}
                  title="This match"
                  hint={
                    table?.pool
                      ? 'Stake and play in the current match'
                      : 'Only available from a match with a prize pool'
                  }
                />
              </Select>
            </div>

            <div className="field">
              <span className="field-label">
                {kind === 'arcade' ? 'Match escrow' : 'Who gets paid'}
              </span>
              <input
                required
                aria-label={kind === 'arcade' ? 'Match escrow' : 'Recipient'}
                value={
                  kind === 'arcade'
                    ? (table?.deployment?.contract ?? '')
                    : recipient
                }
                readOnly={kind === 'arcade'}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder={
                  network === 'hedera-testnet' && kind === 'x402'
                    ? '0.0.…'
                    : '0x…'
                }
              />
              <p className="field-hint">
                {kind === 'arcade'
                  ? 'Filled in from the match. Funds are held in escrow until it settles.'
                  : 'The wallet address of the service the agent is allowed to pay.'}
              </p>
            </div>

            <div className="grant-limits">
              <label>
                Total budget
                <input
                  required
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  inputMode="decimal"
                />
                <small>USDC in total</small>
              </label>
              <label>
                Per-payment cap
                <input
                  required
                  value={perPayment}
                  onChange={(e) => setPerPayment(e.target.value)}
                  inputMode="decimal"
                />
                <small>Max for any one payment</small>
              </label>
              <label>
                Expires in
                <input
                  required
                  type="number"
                  min="1"
                  max="1440"
                  value={minutes}
                  onChange={(e) => setMinutes(e.target.value)}
                />
                <small>Minutes, then it stops</small>
              </label>
            </div>

            {kind === 'arcade' && (
              <div className="field">
                <span className="field-label">Seat and permitted actions</span>
                <Select value={seat} onValueChange={setSeat} ariaLabel="Seat">
                  <SelectOption value="sea_player_1" title="Player 1" />
                  <SelectOption value="sea_player_2" title="Player 2" />
                </Select>
                <div className="grant-operations">
                  {(['stake', 'bounty', 'bet'] as const).map((op) => (
                    <label key={op}>
                      <input
                        type="checkbox"
                        checked={operations[op]}
                        onChange={(e) =>
                          setOperations({
                            ...operations,
                            [op]: e.target.checked,
                          })
                        }
                      />
                      {op}
                    </label>
                  ))}
                </div>
                <p className="field-hint">
                  Bound to match {table?.id}. The agent may only do what is
                  ticked here.
                </p>
              </div>
            )}

            {/* Network, runtime session and service origin all have working
                defaults, so they are folded away — but only once they are
                actually filled. A required field inside a closed <details>
                cannot be focused, so the browser would refuse to submit with
                no visible explanation. */}
            <details
              className="grant-advanced"
              open={showAdvanced}
              onToggle={(e) => setShowAdvanced(e.currentTarget.open)}
            >
              <summary>Technical settings</summary>
              <div className="field">
                <span className="field-label">Network</span>
                <Select
                  value={network}
                  onValueChange={(next) => setNetwork(next as PaymentNetwork)}
                  disabled={kind === 'arcade'}
                  ariaLabel="Payment network"
                >
                  {Object.values(NETWORKS)
                    .filter((n) => n.testnet)
                    .map((n) => (
                      <SelectOption
                        key={n.id}
                        value={n.id}
                        title={n.chain.name}
                      />
                    ))}
                </Select>
                <p className="field-hint">
                  {kind === 'arcade'
                    ? 'Set by the match.'
                    : 'Which chain the payments settle on.'}
                </p>
              </div>
              <label>
                Runtime session ID
                <input
                  required
                  value={runtime}
                  onChange={(e) => setRuntime(e.target.value)}
                  placeholder="Choose a session or enter an external runtime ID"
                  list="wallet-runtime-sessions"
                />
                <datalist id="wallet-runtime-sessions">
                  {runtimeSessions.map((s) => (
                    <option key={s.sessionId} value={s.sessionId}>
                      {s.title ?? s.sessionId}
                    </option>
                  ))}
                </datalist>
                <small>The agent run this budget belongs to.</small>
              </label>
              <label>
                Service origin
                <input
                  required
                  type="url"
                  value={origin}
                  onChange={(e) => setOrigin(e.target.value)}
                  placeholder="https://payments.example.com"
                />
                <small>Only this origin may charge the grant.</small>
              </label>
            </details>

            <p className="field-hint">
              Budget covers USDC payments; onchain deposits also use network
              gas. Uncertain attempts stay reserved until they reconcile.
            </p>
            <button
              className="primary"
              disabled={busy || !walletId || !agentId}
            >
              Create spending grant
            </button>
          </form>
          <div>
            <h3>Session grants</h3>
            {!grants.length && (
              <p>
                No grants. This agent has no payment permission from this panel.
              </p>
            )}
            {grants.map((g) => (
              <div key={g.id} className="grant-row">
                <strong>{g.runtime_session_id}</strong>
                <p>
                  {format(g.reserved_units)} / {format(g.budget_units)} USDC
                  reserved ·{' '}
                  {g.revoked_at
                    ? 'Revoked'
                    : new Date(g.expires_at).getTime() < Date.now()
                      ? 'Expired'
                      : `Expires ${new Date(g.expires_at).toLocaleString()}`}
                </p>
                <p className="wrap-anywhere">
                  {g.policy.network} · {g.policy.origin} → {g.policy.payTo}
                </p>
                <button
                  disabled={busy}
                  onClick={() => run(() => inspect(g.id))}
                >
                  {selectedGrant === g.id
                    ? 'Selected · inspect attempts'
                    : 'Select / inspect'}
                </button>
                {!g.revoked_at && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await api(
                          `wallets/agent/${agentId}/payment-sessions/${g.id}`,
                          undefined,
                          'DELETE',
                        )
                        await refresh()
                      })
                    }
                  >
                    Revoke
                  </button>
                )}
              </div>
            ))}
          </div>
          {grant && !grant.policy.arcade && !grant.revoked_at && (
            <button disabled={busy} onClick={() => run(paidAnalysis)}>
              Pay for test card analysis with x402
            </button>
          )}
          {table &&
            grant?.policy.arcade?.matchId === table.id &&
            !grant.revoked_at && (
              <div className="actions">
                <button disabled={busy} onClick={() => run(deposit)}>
                  Have agent stake
                </button>
                <button
                  disabled={busy || table.stage !== 'playing'}
                  onClick={() => run(play)}
                >
                  Ask agent to play next move
                </button>
                <button
                  disabled={table.stage !== 'playing'}
                  onClick={() => setAgentRunning((value) => !value)}
                >
                  {agentRunning ? 'Stop agent' : 'Let agent play'}
                </button>
              </div>
            )}
          {!!attempts.length && (
            <div>
              <h3>Payment attempts</h3>
              <p>
                Uncertain payments keep their budget reserved until reconciled;
                revocation stops new payment attempts. Already signed
                authorizations may still settle before expiry.
              </p>
              {attempts.map((a) => (
                <p key={a.id} className="wrap-anywhere">
                  {a.state} · {format(a.amount_units)} USDC · {a.resource}
                  {a.settlement?.transaction && (
                    <>
                      <br />
                      <a
                        href={`${config.explorer}/tx/${a.settlement.transaction}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View transaction receipt
                      </a>
                    </>
                  )}
                </p>
              ))}
            </div>
          )}
        </>
      )}
      {busy && <p role="status">Working…</p>}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
