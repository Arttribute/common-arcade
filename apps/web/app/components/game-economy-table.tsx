'use client'
import { hostPaidSession } from '../../lib/paid-session'
import { PaidSeatJoin } from './paid-seat-join'
import { PaymentSummary } from './payment-disclosure'
import './payments.css'
import { ExternalLink } from 'lucide-react'
import type { Observation, JsonValue } from '@common-arcade/protocol'
import { useEffect, useRef, useState } from 'react'
import {
  createPublicClient,
  formatUnits,
  createWalletClient,
  custom,
  http,
  type Address,
  type EIP1193Provider,
  type Hex,
} from 'viem'
import {
  NETWORKS,
  economyConfigSchema,
  approvalCall,
  escrowCall,
  createViemAdapter,
  hashArcadeId,
  usdcUnits,
  transactionExplorerUrl,
  type SettlementAccounting,
  type EconomyConfig,
  type EscrowDeployment,
} from '@common-arcade/economy'
import { AgentWalletPanel } from './agent-wallet-panel'
import { PaidRealtimeGame } from './paid-realtime-game'
import { PaidSessionResult } from './paid-session-result'
import { Select, SelectOption } from './ui/select'
import { EconomySettings } from './economy-settings'
const service =
  process.env.NEXT_PUBLIC_ARCADE_PAYMENTS_URL ??
  (process.env.NODE_ENV === 'development' ? 'http://localhost:4021' : '')
interface Table {
  id: string
  stage: string
  game?: string
  releaseId?: string
  published?: boolean
  mode?: string
  runtimeError?: string
  revenue?: {
    creator: Address
    creatorShareBps: number
    royalties: { recipient: Address; bps: number }[]
  }
  events?: unknown[]
  economy: EconomyConfig
  payments?: {
    hash: Hex
    payer: Address
    kind: number
    seat: Hex
    amount: string
  }[]
  host?: Address
  openSeats?: boolean
  funded?: boolean[]
  recipients: Address[]
  pool?: Hex
  deployment?: EscrowDeployment
  sequence: number
  state: {
    hands: Record<string, number[]>
    totals: Record<string, number>
    turn: string | null
  } | null
  commitment: Hex
  transactions: Hex[]
  trust: string
  result?: JsonValue
  accounting?: SettlementAccounting
  fundingDeadline?: number
  settlementDeadline?: number
  replay?: unknown
}
function provider() {
  const value = (window as unknown as { ethereum?: EIP1193Provider }).ethereum
  if (!value)
    throw new Error(
      'Connect an EVM wallet extension to play. Spectating needs no wallet.',
    )
  return value
}
export function GameEconomyTable({
  releaseId,
  matchId,
  initialEconomy,
}: {
  releaseId?: string
  matchId?: string
  initialEconomy?: EconomyConfig
} = {}) {
  const [localReceipts, setLocalReceipts] = useState<
    { operation: string; hash: Hex }[]
  >([])
  const [observation, setObservation] = useState<Observation>()
  const [other, setOther] = useState('')
  const [account, setAccount] = useState<Address>(),
    [economy, setEconomy] = useState<EconomyConfig>(
      initialEconomy ?? { mode: 'free' },
    ),
    [table, setTable] = useState<Table>(),
    [matchInput, setMatchInput] = useState(''),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [networks, setNetworks] = useState<string[]>([]),
    [amount, setAmount] = useState('1'),
    [backSeat, setBackSeat] = useState('sea_player_1'),
    [live, setLive] = useState(false)
  const [entryMode, setEntryMode] = useState<'host' | 'join'>('host')
  const creation = useRef<unknown>(null)
  const [loadingSession, setLoadingSession] = useState(!!matchId)
  const published = !!releaseId || !!table?.published
  async function request(path: string, body?: unknown) {
    const r = await fetch(service + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const result = await r.json()
    if (!r.ok) throw new Error(result.error ?? `Request failed (${r.status})`)
    return result
  }
  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setMessage('')
    try {
      await fn()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Request failed')
    } finally {
      setBusy(false)
    }
  }
  async function connect() {
    const wallet = createWalletClient({ transport: custom(provider()) })
    const [address] = await wallet.requestAddresses()
    setAccount(address)
    return address!
  }
  async function auth(id: string, operation: string, body: unknown) {
    const address = account ?? (await connect()),
      expiresAt = Date.now() + 60000
    const wallet = createWalletClient({
      transport: custom(provider()),
      account: address,
    })
    const signature = await wallet.signMessage({
      message: JSON.stringify({
        domain: service,
        matchId: id,
        operation,
        body,
        expiresAt,
      }),
    })
    return { address, expiresAt, signature }
  }
  useEffect(() => {
    if (!service) return
    request('/v1/economy/config')
      .then((r) => setNetworks(r.openSeatNetworks ?? []))
      .catch(() =>
        setMessage(
          'Live sessions are temporarily unavailable. Please try again later.',
        ),
      )
    const id =
      matchId ?? new URL(window.location.href).searchParams.get('matchId')
    if (id)
      request(`/v1/economy/matches/${encodeURIComponent(id)}`)
        .then(setTable)
        .catch((e) => setMessage(e.message))
        .finally(() => setLoadingSession(false))
  }, [matchId])
  useEffect(() => {
    if (!table?.id) return
    let stopped = false,
      timer: ReturnType<typeof setTimeout> | undefined,
      socket: WebSocket | undefined
    const open = () => {
      socket = new WebSocket(
        `${service.replace(/^http/, 'ws')}/v1/economy/live?matchId=${encodeURIComponent(table.id)}`,
      )
      socket.onopen = () => setLive(true)
      socket.onmessage = (event) => {
        try {
          const next = JSON.parse(event.data) as Table
          setTable((current) =>
            !current || next.sequence >= current.sequence ? next : current,
          )
        } catch {
          setMessage('Invalid live update')
        }
      }
      socket.onclose = () => {
        setLive(false)
        if (!stopped) timer = setTimeout(open, 2000)
      }
    }
    open()
    return () => {
      stopped = true
      clearTimeout(timer)
      socket?.close()
    }
  }, [table?.id])
  useEffect(() => {
    if (!table?.openSeats || table.stage !== 'funding') return
    let cancelled = false
    const refresh = async () => {
      try {
        const next = await request(`/v1/economy/matches/${table.id}`)
        if (!cancelled)
          setTable((current) => (current?.stage === 'funding' ? next : current))
      } catch {
        /* Keep the last confirmed lobby during temporary network failures. */
      }
      if (!cancelled) timer = setTimeout(refresh, 4000)
    }
    let timer = setTimeout(refresh, 4000)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [table?.id, table?.stage, table?.openSeats])
  useEffect(() => {
    const ethereum = (
      window as unknown as {
        ethereum?: {
          on?: (event: string, listener: (accounts: string[]) => void) => void
          removeListener?: (
            event: string,
            listener: (accounts: string[]) => void,
          ) => void
        }
      }
    ).ethereum
    const changed = (accounts: string[]) => {
      setAccount(accounts[0] as Address | undefined)
      setObservation(undefined)
    }
    try {
      void provider()
        .request({ method: 'eth_accounts' })
        .then((value) => changed(value as string[]))
        .catch(() => {})
    } catch {}
    ethereum?.on?.('accountsChanged', changed)
    return () => ethereum?.removeListener?.('accountsChanged', changed)
  }, [])
  async function create() {
    if (economy.mode === 'free') {
      const address = account ?? (await connect())
      const body = {
        id: crypto.randomUUID(),
        ...(releaseId ? { releaseId } : {}),
        recipients: [address, other],
        economy,
      }
      const next = await request('/v1/economy/matches', {
        body,
        auth: await auth(`mat_${body.id}`, 'create', body),
      })
      setTable(next)
      window.history.replaceState(null, '', `?matchId=${next.id}`)
      return
    }
    const proposed = {
      economy: economyConfigSchema.parse(economy),
      ...(releaseId ? { releaseId } : {}),
    }
    const previous = creation.current as {
      id: string
      economy: EconomyConfig
      releaseId?: string
    } | null
    if (
      !previous ||
      JSON.stringify([previous.economy, previous.releaseId]) !==
        JSON.stringify([proposed.economy, proposed.releaseId])
    )
      creation.current = { id: crypto.randomUUID(), ...proposed }
    const next = await hostPaidSession(
      creation.current as Parameters<typeof hostPaidSession>[0],
    )
    setTable(next)
    creation.current = null
    window.history.replaceState(null, '', `?matchId=${next.id}`)
  }
  async function openTable() {
    const input = matchInput.trim()
    let id = input
    try {
      id =
        new URL(input, window.location.origin).searchParams.get('matchId') ??
        input
    } catch {
      // A plain session ID is also accepted.
    }
    if (!/^mat_[A-Za-z0-9_-]{1,190}$/.test(id))
      throw new Error('Paste a session invitation link or a valid session ID.')
    const next = await request(`/v1/economy/matches/${encodeURIComponent(id)}`)
    setTable(next)
    window.history.replaceState(null, '', `?matchId=${next.id}`)
  }
  async function observe() {
    if (table)
      setObservation(
        await request(
          `/v1/economy/matches/${table.id}/observation`,
          await auth(table.id, 'observation', {}),
        ),
      )
  }
  async function submitPayload(payload: JsonValue) {
    if (!table || observation?.stateSequence !== table.sequence)
      throw new Error('Refresh your observation before acting')
    const body = {
      actionId: crypto.randomUUID(),
      sequence: table.sequence,
      payload,
    }
    setTable(
      await request(`/v1/economy/matches/${table.id}/actions`, {
        body,
        auth: await auth(table.id, 'action', body),
      }),
    )
    setObservation(undefined)
  }
  async function action(type: 'hit' | 'stand') {
    if (!table) return
    const body = {
      actionId: crypto.randomUUID(),
      sequence: table.sequence,
      type,
    }
    setTable(
      await request(`/v1/economy/matches/${table.id}/actions`, {
        body,
        auth: await auth(table.id, 'action', body),
      }),
    )
  }
  async function transact(
    operation:
      'stake' | 'bounty' | 'bet' | 'withdraw' | 'refund' | 'claimBet' | 'void',
    beneficiary?: Address,
    joinSeat?: number,
  ) {
    if (!table?.deployment || !table.pool || table.economy.mode !== 'escrow')
      return
    const address = account ?? (await connect()),
      config = NETWORKS[table.economy.network],
      wallet = createWalletClient({
        account: address,
        chain: config.chain,
        transport: custom(provider()),
      })
    try {
      await wallet.switchChain({ id: config.chain.id })
    } catch (error) {
      if ((error as { code?: number }).code === 4902)
        await wallet.addChain({ chain: config.chain })
      else throw error
    }
    const adapter = createViemAdapter(
        table.deployment,
        wallet,
        createPublicClient({ chain: config.chain, transport: http() }),
      ),
      seat = table.recipients.findIndex(
        (a) => a.toLowerCase() === address.toLowerCase(),
      )
    if (
      operation === 'stake' &&
      seat < 0 &&
      !(table.openSeats && joinSeat !== undefined)
    )
      throw new Error('This wallet is not a player at this session')
    const units =
      operation === 'stake'
        ? BigInt(table.economy.stakeUnits)
        : operation === 'bounty' || operation === 'bet'
          ? usdcUnits(amount)
          : 0n
    if (['stake', 'bounty', 'bet'].includes(operation) && units > 0n)
      await adapter.submit(approvalCall(table.deployment, units))
    const hash = await adapter.submit(
      escrowCall(table.deployment, operation, table.pool, {
        seat: hashArcadeId(
          operation === 'bet'
            ? backSeat
            : (joinSeat ?? seat) === 0
              ? 'sea_player_1'
              : 'sea_player_2',
        ),
        amount: units,
        beneficiary: beneficiary ?? address,
      }),
    )
    setLocalReceipts((receipts) => [...receipts, { operation, hash }])
    setMessage(
      operation === 'stake'
        ? 'Entry stake confirmed. The host can start once both players are ready.'
        : `${operation === 'withdraw' ? 'Withdrawal' : operation === 'bounty' ? 'Prize contribution' : operation === 'bet' ? 'Spectator bet' : operation === 'void' ? 'Cancellation' : 'Claim'} confirmed. View the receipt below.`,
    )
    setTable(await request(`/v1/economy/matches/${table.id}`))
  }
  const seat =
      table?.recipients.findIndex(
        (a) => a.toLowerCase() === account?.toLowerCase(),
      ) ?? -1,
    myTurn =
      !!table?.state &&
      table.state.turn ===
        (seat === 0 ? 'sea_player_1' : seat === 1 ? 'sea_player_2' : '')
  if (loadingSession) return <p role="status">Opening live session…</p>
  if (matchId && !table)
    return (
      <p role="alert">
        {message || 'Could not open this session. Reload to try again.'}
      </p>
    )
  if (!service)
    return (
      <p role="status">
        Testnet live sessions are not available yet. You can still play games in
        the arcade.
      </p>
    )
  const ended =
    table?.stage === 'settled' || table?.stage === 'settlement-pending'
  const connectButton = (
    <button
      className={account ? 'secondary' : 'primary'}
      disabled={busy}
      onClick={() =>
        run(async () => {
          await connect()
        })
      }
    >
      {account
        ? `${account.slice(0, 8)}…${account.slice(-6)}`
        : ended
          ? 'Connect wallet to claim'
          : 'Connect wallet'}
    </button>
  )
  return (
    <div className="game-economy-table">
      {message && (
        <p role="status" className="wrap-anywhere">
          {message}
        </p>
      )}
      {busy && <p role="status">Waiting for confirmation…</p>}
      {!table ? (
        <>
          <div
            className="payment-entry-tabs"
            role="group"
            aria-label="Choose how to play"
          >
            <button
              className={entryMode === 'host' ? 'primary' : 'secondary'}
              aria-pressed={entryMode === 'host'}
              onClick={() => setEntryMode('host')}
            >
              Host a session
            </button>
            <button
              className={entryMode === 'join' ? 'primary' : 'secondary'}
              aria-pressed={entryMode === 'join'}
              onClick={() => setEntryMode('join')}
            >
              Join a session
            </button>
          </div>
          {entryMode === 'join' ? (
            <>
              <form
                className="payment-join-form"
                onSubmit={(e) => {
                  e.preventDefault()
                  void run(openTable)
                }}
              >
                <label>
                  Session ID or invitation{' '}
                  <input
                    required
                    value={matchInput}
                    onChange={(e) => setMatchInput(e.target.value)}
                    placeholder="Paste a session link or ID"
                  />
                </label>
                <button className="secondary" disabled={busy}>
                  Open session
                </button>
              </form>
            </>
          ) : !account ? (
            <section className="payment-connect-step">
              <h2>Connect to get started</h2>
              <p>
                {economy.mode === 'escrow'
                  ? `${formatUnits(BigInt(economy.stakeUnits), 6)} test USDC per player · ${NETWORKS[economy.network].chain.name}`
                  : 'Choose payment options after connecting.'}
              </p>
              {connectButton}
              <small>Connecting does not charge your wallet.</small>
            </section>
          ) : (
            <>
              <div className="payment-wallet-connection">{connectButton}</div>
              <form
                className="payment-setup-form"
                onInvalidCapture={(event) => {
                  let ancestor = (event.target as HTMLElement).parentElement
                  while (ancestor && ancestor !== event.currentTarget) {
                    if (ancestor instanceof HTMLDetailsElement)
                      ancestor.open = true
                    ancestor = ancestor.parentElement
                  }
                }}
                onSubmit={(e) => {
                  e.preventDefault()
                  void run(create)
                }}
              >
                <p>
                  Create your session, then share the link. Players join and pay
                  for their own seats.
                </p>
                {economy.mode === 'free' && (
                  <label>
                    Other player wallet
                    <input
                      required
                      pattern="0x[0-9a-fA-F]{40}"
                      value={other}
                      onChange={(event) => setOther(event.target.value)}
                      placeholder="0x…"
                    />
                  </label>
                )}
                {initialEconomy ? (
                  <>
                    <div className="payment-terms-summary">
                      <strong>
                        {economy.mode === 'free'
                          ? 'Free entry'
                          : `${formatUnits(BigInt(economy.stakeUnits), 6)} test USDC per player`}
                      </strong>
                      <p>
                        {economy.mode === 'escrow'
                          ? `${NETWORKS[economy.network].chain.name} · ${economy.feeBps / 100}% success fee`
                          : 'No prize pool'}
                      </p>
                    </div>
                    <details className="payment-disclosure">
                      <PaymentSummary>
                        Review or change payment options
                      </PaymentSummary>
                      <EconomySettings
                        value={economy}
                        onChange={setEconomy}
                        enabledNetworks={networks}
                      />
                    </details>
                  </>
                ) : (
                  <EconomySettings
                    value={economy}
                    onChange={setEconomy}
                    enabledNetworks={networks}
                  />
                )}
                <button
                  className="primary"
                  disabled={
                    busy ||
                    (economy.mode === 'escrow' &&
                      !networks.includes(economy.network))
                  }
                >
                  Host a live session
                </button>
              </form>
            </>
          )}
        </>
      ) : (
        <>
          {ended ? (
            <PaidSessionResult
              stage={table.stage}
              result={table.result}
              accounting={table.accounting}
              economy={table.economy}
              recipients={table.recipients}
              showBreakdown={false}
            />
          ) : (
            <div className="payment-table-heading">
              <h2>{table.game ?? 'Live session'}</h2>
              <p>
                {table.economy.mode === 'escrow'
                  ? `${formatUnits(BigInt(table.economy.stakeUnits), 6)} test USDC per player · ${NETWORKS[table.economy.network].chain.name}`
                  : 'Free entry'}
              </p>
              {table.stage === 'funding' && (
                <p>
                  {account
                    ? 'Choose a seat for yourself or your agent.'
                    : 'Join a seat for yourself or your agent. Spectating is free.'}
                </p>
              )}
            </div>
          )}
          {(!ended ||
            (table.stage === 'settled' && table.economy.mode === 'escrow')) && (
            <div className="payment-wallet-connection">{connectButton}</div>
          )}
          {table.economy.mode === 'escrow' &&
            (!!table.payments?.length || !!localReceipts.length) && (
              <div
                className="payment-confirmations"
                aria-label="Confirmed payments"
              >
                {[
                  ...(table.payments ?? []).map((p) => ({
                    hash: p.hash,
                    operation:
                      p.kind === 0
                        ? 'Seat entry'
                        : p.kind === 1
                          ? 'Prize contribution'
                          : 'Spectator bet',
                  })),
                  ...localReceipts.filter(
                    (receipt) =>
                      !table.payments?.some(
                        (payment) => payment.hash === receipt.hash,
                      ),
                  ),
                ].map((receipt) => (
                  <p key={receipt.hash}>
                    {receipt.operation} confirmed ·{' '}
                    <a
                      target="_blank"
                      rel="noreferrer"
                      href={transactionExplorerUrl(
                        table.economy.mode === 'escrow'
                          ? table.economy.network
                          : '',
                        receipt.hash,
                      )}
                    >
                      View transaction <ExternalLink size={14} aria-hidden />
                    </a>
                  </p>
                ))}
              </div>
            )}
          {table.stage === 'funding' &&
            table.openSeats &&
            table.economy.mode === 'escrow' && (
              <>
                <div className="actions">
                  <button
                    className="secondary"
                    onClick={() =>
                      run(async () => {
                        await navigator.clipboard.writeText(
                          window.location.href,
                        )
                        setMessage('Invitation link copied')
                      })
                    }
                  >
                    Copy invitation link
                  </button>
                </div>
                <PaidSeatJoin
                  table={
                    table as Table & {
                      economy: Extract<EconomyConfig, { mode: 'escrow' }>
                    }
                  }
                  account={account}
                  busy={busy}
                  onJoin={(index) =>
                    run(() => transact('stake', undefined, index))
                  }
                  onJoined={() =>
                    run(async () =>
                      setTable(
                        await request(`/v1/economy/matches/${table.id}`),
                      ),
                    )
                  }
                />
                {account?.toLowerCase() === table.host?.toLowerCase() && (
                  <button
                    className="primary"
                    disabled={busy || !table.funded?.every(Boolean)}
                    onClick={() =>
                      run(async () => {
                        setTable(
                          await request(
                            `/v1/economy/matches/${table.id}/start`,
                            await auth(table.id, 'start', {}),
                          ),
                        )
                      })
                    }
                  >
                    Start game
                  </button>
                )}
              </>
            )}
          {table.stage === 'funding' && !table.openSeats && account && (
            <div className="payment-funding">
              {table.economy.mode === 'escrow' && (
                <p>
                  Fund each player’s entry, then start. Your wallet will request
                  a token allowance followed by the entry deposit. Network fees
                  are separate.
                </p>
              )}
              <div className="actions">
                {table.economy.mode === 'escrow' &&
                  seat >= 0 &&
                  BigInt(table.economy.stakeUnits) > 0n && (
                    <button
                      disabled={busy}
                      className="primary"
                      onClick={() => run(() => transact('stake'))}
                    >
                      Fund my entry ·{' '}
                      {table.economy.mode === 'escrow'
                        ? formatUnits(BigInt(table.economy.stakeUnits), 6)
                        : '0'}{' '}
                      test USDC
                    </button>
                  )}
                {seat === 0 && (
                  <button
                    disabled={busy}
                    className="secondary"
                    onClick={() =>
                      run(async () => {
                        setTable(
                          await request(
                            `/v1/economy/matches/${table.id}/start`,
                            await auth(table.id, 'start', {}),
                          ),
                        )
                      })
                    }
                  >
                    {published
                      ? 'Lock funding and start'
                      : 'Lock funding and deal'}
                  </button>
                )}
              </div>
            </div>
          )}
          {!published && table.stage === 'playing' && (
            <div className="actions">
              <button
                className="primary"
                disabled={busy || !myTurn}
                onClick={() => run(() => action('hit'))}
              >
                Hit
              </button>
              <button
                className="secondary"
                disabled={busy || !myTurn}
                onClick={() => run(() => action('stand'))}
              >
                Stand
              </button>
            </div>
          )}
          {table.mode === 'realtime' && table.stage === 'playing' && (
            <PaidRealtimeGame
              service={service}
              table={table}
              account={account}
              authorize={async () =>
                request(
                  `/v1/economy/matches/${table.id}/realtime-session`,
                  await auth(table.id, 'realtime-session', {}),
                )
              }
            />
          )}
          {published &&
            table.mode !== 'realtime' &&
            table.stage === 'playing' && (
              <section>
                <h2>{table.game}</h2>
                {table.stage === 'playing' && seat >= 0 && (
                  <button disabled={busy} onClick={() => run(observe)}>
                    Read my observation and legal actions
                  </button>
                )}
                {observation && (
                  <>
                    <pre
                      style={{
                        whiteSpace: 'pre-wrap',
                        overflowWrap: 'anywhere',
                      }}
                    >
                      {JSON.stringify(observation.visibleState, null, 2)}
                    </pre>
                    {observation.legalActions.map((payload, index) => (
                      <button
                        key={index}
                        disabled={
                          busy || observation.stateSequence !== table.sequence
                        }
                        onClick={() => run(() => submitPayload(payload))}
                      >
                        {JSON.stringify(payload)}
                      </button>
                    ))}
                  </>
                )}
                <details>
                  <PaymentSummary>Public game events</PaymentSummary>
                  <pre
                    style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
                  >
                    {JSON.stringify(table.events, null, 2)}
                  </pre>
                </details>
              </section>
            )}
          {table.economy.mode === 'escrow' && (
            <>
              {table.stage === 'settled' && account && (
                <section className="payment-claims">
                  <h3>Claim funds</h3>
                  <p>
                    {NETWORKS[table.economy.network].chain.name} · test USDC.
                    {table.accounting?.status === 'refundable'
                      ? ' Refunds return to the wallet that contributed.'
                      : ' Withdraw your available escrow balance, including any earnings from other sessions.'}
                  </p>
                  <div className="actions">
                    {table.accounting?.status !== 'refundable' && (
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={() => run(() => transact('withdraw'))}
                      >
                        Withdraw my available balance
                      </button>
                    )}
                    {table.accounting?.status === 'refundable' && (
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={() => run(() => transact('refund'))}
                      >
                        Refund my contribution
                      </button>
                    )}
                    {table.economy.spectatorBets && (
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => run(() => transact('claimBet'))}
                      >
                        Claim my spectator payout
                      </button>
                    )}
                  </div>
                  {!!table.accounting?.allocations.length && (
                    <details>
                      <PaymentSummary>
                        Send a recipient’s available balance
                      </PaymentSummary>
                      <div className="actions">
                        {table.accounting.allocations.map(
                          (allocation, index) => (
                            <button
                              key={index}
                              disabled={busy}
                              onClick={() =>
                                run(() =>
                                  transact(
                                    'withdraw',
                                    allocation.recipient as Address,
                                  ),
                                )
                              }
                            >
                              {allocation.role} ·{' '}
                              {allocation.recipient.slice(0, 8)}…
                            </button>
                          ),
                        )}
                      </div>
                    </details>
                  )}
                </section>
              )}
              {table.stage === 'funding' &&
                (table.economy.bounties || table.economy.spectatorBets) && (
                  <section className="payment-disclosure">
                    <h3>Back a player or add to the prize</h3>
                    <p>
                      Contributions close when the host starts. Use test USDC on{' '}
                      {NETWORKS[table.economy.network].chain.name}.
                    </p>
                    <label>
                      Amount (test USDC)
                      <input
                        value={amount}
                        onChange={(event) => setAmount(event.target.value)}
                        inputMode="decimal"
                      />
                    </label>
                    {table.economy.bounties && (
                      <div className="payment-support-option">
                        <h3>Add to the prize pool</h3>
                        <p>
                          Your contribution rewards the winner after the success
                          fee.
                        </p>
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={() => run(() => transact('bounty'))}
                        >
                          Contribute {amount} test USDC
                        </button>
                      </div>
                    )}
                    {table.economy.spectatorBets && (
                      <div className="payment-support-option">
                        <h3>Back a player</h3>
                        <p>
                          You can lose your contribution. A{' '}
                          {table.economy.feeBps / 100}% fee applies to spectator
                          profits.
                        </p>
                        <Select
                          value={backSeat}
                          onValueChange={setBackSeat}
                          ariaLabel="Player to back"
                        >
                          <SelectOption
                            value="sea_player_1"
                            title="Player 1"
                            disabled={!!table.openSeats && !table.funded?.[0]}
                          />
                          <SelectOption
                            value="sea_player_2"
                            title="Player 2"
                            disabled={!!table.openSeats && !table.funded?.[1]}
                          />
                        </Select>
                        <button
                          className="secondary"
                          disabled={
                            busy ||
                            (!!table.openSeats &&
                              !table.funded?.[
                                backSeat === 'sea_player_1' ? 0 : 1
                              ])
                          }
                          onClick={() => run(() => transact('bet'))}
                        >
                          Bet {amount} test USDC
                        </button>
                      </div>
                    )}
                  </section>
                )}
            </>
          )}
          {table.stage === 'settlement-pending' && (
            <button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  setTable(
                    await request(`/v1/economy/matches/${table.id}/settle`, {}),
                  )
                })
              }
            >
              Retry settlement
            </button>
          )}
          <details className="payment-disclosure payment-session-details">
            <PaymentSummary>Session & payment details</PaymentSummary>
            <div className="payment-details-body">
              <div>
                <strong>{table.game ?? 'Live session'}</strong> ·{' '}
                {table.economy.mode === 'free'
                  ? 'Free play'
                  : `${NETWORKS[table.economy.network].chain.name} · ${formatUnits(BigInt(table.economy.stakeUnits), 6)} test USDC per seat`}
                <p>
                  <a href={`?matchId=${table.id}`}>
                    Share this session with players and spectators
                  </a>
                </p>
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))',
                  gap: 20,
                }}
              >
                {table.recipients.map((recipient, i) => {
                  const id = i === 0 ? 'sea_player_1' : 'sea_player_2'
                  if (!service)
                    return (
                      <p role="status">
                        Testnet live sessions are not available yet. You can
                        still play games in the arcade.
                      </p>
                    )
                  return (
                    <section key={id} className="paid-player-card">
                      <h2>
                        Player {i + 1}
                        {seat === i ? ' · You' : ''}
                      </h2>
                      <small>
                        {recipient.slice(0, 10)}…{recipient.slice(-6)}
                      </small>
                      <div
                        style={{
                          display: 'flex',
                          gap: 8,
                          margin: table.state ? '24px 0' : '12px 0',
                          minHeight: table.state ? 90 : undefined,
                        }}
                      >
                        {table.state?.hands[id]?.map((card) => (
                          <span
                            key={card}
                            style={{
                              padding: 14,
                              borderRadius: 'var(--radius-md)',
                              background: '#faf6ec',
                              color: card >= 26 ? '#bd3446' : '#13241d',
                              fontSize: 24,
                            }}
                          >
                            {
                              [
                                'A',
                                '2',
                                '3',
                                '4',
                                '5',
                                '6',
                                '7',
                                '8',
                                '9',
                                '10',
                                'J',
                                'Q',
                                'K',
                              ][card % 13]
                            }
                            {['♠', '♣', '♥', '♦'][Math.floor(card / 13)]}
                          </span>
                        )) ??
                          (table.stage === 'funding'
                            ? 'Waiting for entry funding'
                            : table.stage === 'playing'
                              ? 'Use your private observation to play'
                              : 'Session complete')}
                      </div>
                      <strong>
                        {table.state ? `Total: ${table.state.totals[id]}` : ''}
                      </strong>
                    </section>
                  )
                })}
              </div>
              {ended && (
                <PaidSessionResult
                  stage={table.stage}
                  result={table.result}
                  accounting={table.accounting}
                  economy={table.economy}
                  recipients={table.recipients}
                  breakdownOnly
                />
              )}
              {published && ended && (
                <details>
                  <PaymentSummary>Public game events</PaymentSummary>
                  <pre className="payment-event-data">
                    {JSON.stringify(table.events, null, 2)}
                  </pre>
                </details>
              )}
              <details>
                <PaymentSummary>Onchain receipts & replay</PaymentSummary>
                {table.economy.mode === 'escrow' && (
                  <p>
                    <a href="/docs/guides/live-matches#optional-paid-matches">
                      How match payments work
                    </a>
                  </p>
                )}
                <p style={{ overflowWrap: 'anywhere' }}>
                  Shuffle commitment: {table.commitment}
                </p>
                {[
                  ...table.transactions.map((hash) => ({
                    hash,
                    operation: 'Match transaction',
                  })),
                  ...localReceipts,
                ].map(({ hash, operation }) => (
                  <p key={hash} style={{ overflowWrap: 'anywhere' }}>
                    {table.economy.mode === 'escrow' ? (
                      <a
                        target="_blank"
                        rel="noreferrer"
                        href={transactionExplorerUrl(
                          table.economy.network,
                          hash,
                        )}
                        className="payment-receipt-link"
                      >
                        {operation} · {hash.slice(0, 10)}…{hash.slice(-8)}
                        <ExternalLink size={14} aria-hidden />
                      </a>
                    ) : (
                      hash
                    )}
                  </p>
                ))}
                {!!table.replay && (
                  <button
                    onClick={() => {
                      const url = URL.createObjectURL(
                        new Blob([JSON.stringify(table.replay, null, 2)], {
                          type: 'application/json',
                        }),
                      )
                      const a = document.createElement('a')
                      a.href = url
                      a.download = `${table.id}.json`
                      a.click()
                      URL.revokeObjectURL(url)
                    }}
                  >
                    Download completed replay
                  </button>
                )}
              </details>
              <p className="field-hint">{table.trust}</p>
              {table.economy.mode === 'escrow' && (
                <>
                  <details className="payment-disclosure">
                    <PaymentSummary>
                      Expired session or missing refund?
                    </PaymentSummary>
                    <p>
                      If funding or play runs past its deadline, cancel the
                      expired session, then claim your contribution. Refunds
                      always return to the contributing wallet.
                    </p>
                    <div className="actions">
                      <button
                        disabled={busy || table.stage === 'settled'}
                        onClick={() => run(() => transact('void'))}
                      >
                        Cancel expired session
                      </button>
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={() => run(() => transact('refund'))}
                      >
                        Claim my refund
                      </button>
                    </div>
                  </details>
                </>
              )}
              {ended && (
                <details>
                  <PaymentSummary>Agent payment history</PaymentSummary>
                  <AgentWalletPanel table={table} />
                </details>
              )}
              <small role="status">
                {live ? 'Live session connected' : 'Reconnecting…'}
              </small>
            </div>
          </details>
          {!ended && (!table.openSeats || table.stage !== 'funding') && (
            <>
              <details className="payment-disclosure">
                <PaymentSummary>Play with a Commons agent</PaymentSummary>
                <AgentWalletPanel table={table} />
              </details>{' '}
            </>
          )}
        </>
      )}
    </div>
  )
}
