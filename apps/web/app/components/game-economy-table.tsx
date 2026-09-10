'use client'
import type { Observation, JsonValue } from '@common-arcade/protocol'
import { useEffect, useRef, useState } from 'react'
import {
  createPublicClient,
  erc20Abi,
  http,
  type Address,
  type Hex,
} from 'viem'
import {
  NETWORKS,
  economyConfigSchema,
  approvalCall,
  escrowCall,
  hashArcadeId,
  usdcUnits,
  type EconomyConfig,
  type EscrowDeployment,
} from '@common-arcade/economy'
import { AgentWalletPanel } from './agent-wallet-panel'
import { EconomySettings } from './economy-settings'
import { useArcadeWallet, WalletConnectionButton } from './arcade-wallet'
import { useWalletTransaction } from './use-wallet-transaction'
import { WalletActionStatus } from './wallet-action-status'
import { walletError } from './wallet-transaction'
const service =
  process.env.NEXT_PUBLIC_ARCADE_PAYMENTS_URL ??
  (process.env.NODE_ENV === 'development' ? 'http://localhost:4021' : '')
interface Table {
  id: string
  stage: string
  game?: string
  releaseId?: string
  revenue?: {
    creator: Address
    creatorShareBps: number
    royalties: { recipient: Address; bps: number }[]
  }
  events?: unknown[]
  economy: EconomyConfig
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
  replay?: unknown
}
type PaymentOperation =
  'stake' | 'bounty' | 'bet' | 'withdraw' | 'refund' | 'claimBet' | 'void'
const paymentLabels: Record<PaymentOperation, string> = {
  stake: 'Stake USDC',
  bounty: 'Fund bounty',
  bet: 'Place spectator bet',
  withdraw: 'Claim earnings',
  refund: 'Claim refund',
  claimBet: 'Claim spectator payout',
  void: 'Void expired match',
}
interface PaymentReview {
  operation: PaymentOperation
  beneficiary: Address
  account: Address
  amount: string
  backSeat: string
  matchId: string
}
export function GameEconomyTable({ releaseId }: { releaseId?: string } = {}) {
  const connection = useArcadeWallet()
  const account = connection.address
  const transaction = useWalletTransaction()
  const [review, setReview] = useState<PaymentReview>()
  const [observation, setObservation] = useState<Observation>()
  const [other, setOther] = useState(''),
    [economy, setEconomy] = useState<EconomyConfig>({ mode: 'free' }),
    [table, setTable] = useState<Table>(),
    [matchInput, setMatchInput] = useState(''),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [networks, setNetworks] = useState<string[]>([]),
    [amount, setAmount] = useState('1'),
    [backSeat, setBackSeat] = useState('sea_player_1'),
    [live, setLive] = useState(false)
  const creation = useRef<unknown>(null)
  const working = useRef(false)
  useEffect(() => {
    setObservation(undefined)
    setReview(undefined)
  }, [account, table?.id])
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
    if (working.current) return
    working.current = true
    setBusy(true)
    setMessage('')
    try {
      await fn()
    } catch (e) {
      setMessage(walletError(e))
    } finally {
      working.current = false
      setBusy(false)
    }
  }
  async function connect() {
    if (!connection.address)
      throw new Error(
        'Connect your wallet first, then choose this action again',
      )
    return connection.address
  }
  async function auth(id: string, operation: string, body: unknown) {
    const address = account ?? (await connect()),
      expiresAt = Date.now() + 60000
    const wallet = await connection.client()
    if (wallet.account?.address.toLowerCase() !== address.toLowerCase())
      throw new Error('Your wallet changed. Try the action again')
    setMessage(
      'Approve the game message in your wallet. This signature does not transfer funds or charge gas.',
    )
    const signature = await wallet.signMessage({
      account: address,
      message: JSON.stringify({
        domain: service,
        matchId: id,
        operation,
        body,
        expiresAt,
      }),
    })
    setMessage('Game message signed. Waiting for the table…')
    return { address, expiresAt, signature }
  }
  useEffect(() => {
    if (!service) return
    request('/v1/economy/config')
      .then((r) => setNetworks(r.networks))
      .catch(() =>
        setMessage(
          'Game tables are temporarily unavailable. Please try again later.',
        ),
      )
    const id = new URL(window.location.href).searchParams.get('matchId')
    if (id)
      request(`/v1/economy/matches/${encodeURIComponent(id)}`)
        .then(setTable)
        .catch((e) => setMessage(e.message))
  }, [])
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
  async function create() {
    const address = account ?? (await connect())
    const proposed = {
      recipients: [address, other],
      economy: economyConfigSchema.parse(economy),
      ...(releaseId ? { releaseId } : {}),
    }
    const previous = creation.current as {
      recipients: Address[]
      economy: EconomyConfig
      releaseId?: string
    } | null
    if (
      !previous ||
      JSON.stringify([
        previous.recipients,
        previous.economy,
        previous.releaseId,
      ]) !==
        JSON.stringify([
          proposed.recipients,
          proposed.economy,
          proposed.releaseId,
        ])
    )
      creation.current = {
        id: crypto.randomUUID(),
        ...(releaseId ? { releaseId } : {}),
        recipients: [address, other],
        economy: economyConfigSchema.parse(economy),
      }
    const body = creation.current as { id: string }
    const next = await request('/v1/economy/matches', {
      body,
      auth: await auth(`mat_${body.id}`, 'create', body),
    })
    setTable(next)
    creation.current = null
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
  async function transact(operation: PaymentOperation, beneficiary?: Address) {
    if (!table?.deployment || !table.pool || table.economy.mode !== 'escrow')
      return
    const address = await connect()
    if (transaction.pending)
      throw new Error(
        'Check the pending transaction before starting another payment',
      )
    const deposit = ['stake', 'bounty', 'bet'].includes(operation)
    const units =
      operation === 'stake'
        ? BigInt(table.economy.stakeUnits)
        : deposit
          ? usdcUnits(amount)
          : 0n
    if (deposit && units <= 0n) throw new Error('Enter a positive USDC amount')
    setReview({
      operation,
      beneficiary: beneficiary ?? address,
      account: address,
      amount: units.toString(),
      backSeat,
      matchId: table.id,
    })
  }
  async function confirmPayment(input: PaymentReview) {
    if (
      !table?.deployment ||
      !table.pool ||
      table.economy.mode !== 'escrow' ||
      table.id !== input.matchId
    )
      throw new Error('The table changed. Review the payment again')
    const config = NETWORKS[table.economy.network]
    if (
      table.deployment.chainId !== config.chain.id ||
      table.deployment.token.toLowerCase() !== config.token.toLowerCase()
    )
      throw new Error('The table payment network does not match its deployment')
    const wallet = await connection.client(config.chain)
    const address = wallet.account?.address
    if (!address || address.toLowerCase() !== input.account.toLowerCase())
      throw new Error('Your wallet changed. Review the payment again')
    const reader = createPublicClient({
      chain: config.chain,
      transport: http(),
    })
    const seat = table.recipients.findIndex(
      (a) => a.toLowerCase() === address.toLowerCase(),
    )
    if (input.operation === 'stake' && seat < 0)
      throw new Error('This wallet is not a player at this table')
    const units = BigInt(input.amount)
    if (['stake', 'bounty', 'bet'].includes(input.operation)) {
      const balance = await reader.readContract({
        address: config.token,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [address],
      })
      if (balance < units)
        throw new Error(
          'Not enough USDC in this wallet on the selected network',
        )
      const allowance = await reader.readContract({
        address: config.token,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [address, table.deployment.contract],
      })
      if (allowance < units)
        await transaction.submit(
          table.deployment,
          wallet,
          approvalCall(table.deployment, units),
          'USDC allowance',
        )
    }
    // Recheck the active wallet after the separate token approval.
    const activeWallet = await connection.client(config.chain)
    if (activeWallet.account?.address.toLowerCase() !== address.toLowerCase())
      throw new Error(
        'Your wallet changed after approval. Review the payment again',
      )
    const hash = await transaction.submit(
      table.deployment,
      activeWallet,
      escrowCall(table.deployment, input.operation, table.pool, {
        seat: hashArcadeId(
          input.operation === 'bet'
            ? input.backSeat
            : seat === 0
              ? 'sea_player_1'
              : 'sea_player_2',
        ),
        amount: units,
        beneficiary: input.beneficiary,
      }),
      paymentLabels[input.operation],
    )
    setReview(undefined)
    setMessage(`Confirmed: ${paymentLabels[input.operation]}.`)
    setTable((current) =>
      current
        ? {
            ...current,
            transactions: [...new Set([...current.transactions, hash])],
          }
        : current,
    )
  }
  const seat =
      table?.recipients.findIndex(
        (a) => a.toLowerCase() === account?.toLowerCase(),
      ) ?? -1,
    myTurn =
      !!table?.state &&
      table.state.turn ===
        (seat === 0 ? 'sea_player_1' : seat === 1 ? 'sea_player_2' : '')
  if (!service)
    return (
      <p role="status">
        Testnet game tables are not available yet. You can still play games in
        the arcade.
      </p>
    )
  return (
    <div style={{ display: 'grid', gap: 24, maxWidth: 960, marginTop: 28 }}>
      <div>
        <WalletConnectionButton disabled={busy} />
        <span role="status" style={{ marginLeft: 16 }}>
          {busy
            ? 'Request in progress…'
            : table
              ? live
                ? 'Live table connected'
                : 'Reconnecting…'
              : ''}
        </span>
      </div>
      {message && (
        <p role="status" style={{ overflowWrap: 'anywhere' }}>
          {message}
        </p>
      )}
      <p className="studio-help">
        Connect a wallet to play or make payments. Game moves request a message
        signature with no gas fee. Deposits and claims require a transaction.
        Watching is free.
      </p>
      <WalletActionStatus
        pending={transaction.pending}
        status={transaction.status}
        check={transaction.check}
        disabled={busy}
      />
      {review && table?.economy.mode === 'escrow' && (
        <section
          className="wallet-review"
          aria-label="Review wallet transaction"
        >
          <h3>{paymentLabels[review.operation]}</h3>
          <p>
            {NETWORKS[table.economy.network].chain.name} · Wallet{' '}
            {review.account.slice(0, 8)}…{review.account.slice(-6)}
          </p>
          {BigInt(review.amount) > 0n ? (
            <>
              <p>
                <strong>{Number(review.amount) / 1e6} USDC</strong> to the match
                escrow.
              </p>
              <p className="studio-help">
                Your wallet may ask twice: authorize this exact USDC amount,
                then confirm the deposit. An allowance approval alone does not
                fund the match. Network fees apply.
              </p>
            </>
          ) : (
            <p className="studio-help">
              {review.operation === 'void'
                ? 'This transaction voids an expired match so contributions can be refunded.'
                : `Available funds go to ${review.beneficiary}.`}{' '}
              Your wallet will show the network fee before you confirm.
            </p>
          )}
          <div className="actions">
            <button
              type="button"
              className="primary"
              disabled={busy || !!transaction.pending}
              onClick={() => run(() => confirmPayment(review))}
            >
              Continue in wallet
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => setReview(undefined)}
            >
              Cancel
            </button>
          </div>
        </section>
      )}
      {!table ? (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void run(create)
            }}
            style={{ display: 'grid', gap: 20 }}
          >
            <label>
              Other player or agent wallet{' '}
              <input
                required
                pattern="0x[0-9a-fA-F]{40}"
                value={other}
                onChange={(e) => setOther(e.target.value)}
                placeholder="0x…"
                style={{ width: '100%' }}
              />
            </label>
            <EconomySettings
              value={economy}
              onChange={setEconomy}
              enabledNetworks={networks}
            />
            <button
              className="primary"
              disabled={
                busy ||
                (economy.mode === 'escrow' &&
                  !networks.includes(economy.network))
              }
            >
              Create table
            </button>
          </form>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void run(async () => {
                setTable(
                  await request(
                    `/v1/economy/matches/${encodeURIComponent(matchInput)}`,
                  ),
                )
              })
            }}
          >
            <label>
              Watch or join an existing table{' '}
              <input
                required
                value={matchInput}
                onChange={(e) => setMatchInput(e.target.value)}
                placeholder="mat_…"
              />
            </label>
            <button className="secondary" disabled={busy}>
              Open table
            </button>
          </form>
        </>
      ) : (
        <>
          <div>
            <strong>{table.stage.replaceAll('-', ' ')}</strong> ·{' '}
            {table.economy.mode === 'free'
              ? 'Free play'
              : `${NETWORKS[table.economy.network].chain.name} · ${Number(table.economy.stakeUnits) / 1e6} USDC per seat`}
            <p>
              <a href={`?matchId=${table.id}`}>
                Share this table with players and spectators
              </a>
            </p>
            <small>{table.trust}</small>
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
                    Testnet game tables are not available yet. You can still
                    play games in the arcade.
                  </p>
                )
              return (
                <section
                  key={id}
                  style={{
                    padding: 24,
                    border: '1px solid var(--border, #444)',
                    borderRadius: 16,
                    background: 'rgba(15,90,65,.16)',
                  }}
                >
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
                      margin: '24px 0',
                      minHeight: 90,
                    }}
                  >
                    {table.state?.hands[id]?.map((card) => (
                      <span
                        key={card}
                        style={{
                          padding: 14,
                          borderRadius: 8,
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
                      (releaseId
                        ? 'Use your private observation below'
                        : 'Waiting for funding lock')}
                  </div>
                  <strong>
                    {table.state ? `Total: ${table.state.totals[id]}` : ''}
                  </strong>
                </section>
              )
            })}
          </div>
          {table.stage === 'funding' && (
            <div className="actions">
              {table.economy.mode === 'escrow' &&
                seat >= 0 &&
                BigInt(table.economy.stakeUnits) > 0n && (
                  <button
                    disabled={busy}
                    className="primary"
                    onClick={() => run(() => transact('stake'))}
                  >
                    Stake USDC
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
                  {releaseId
                    ? 'Lock funding and start'
                    : 'Lock funding and deal'}
                </button>
              )}
            </div>
          )}
          {!releaseId && table.stage === 'playing' && (
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
          {releaseId && (
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
                    style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
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
                <summary>Public game events</summary>
                <pre
                  style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
                >
                  {JSON.stringify(table.events, null, 2)}
                </pre>
              </details>
            </section>
          )}
          {table.revenue && (
            <section>
              <h3>Creator earnings</h3>
              <p>
                {table.revenue.creatorShareBps / 100}% of the 2.5% success fee
                supports this release’s creators.
              </p>
              {[
                table.revenue.creator,
                ...table.revenue.royalties.map((r) => r.recipient),
              ].map((recipient) => (
                <button
                  key={recipient}
                  disabled={busy || table.stage !== 'settled'}
                  onClick={() => run(() => transact('withdraw', recipient))}
                >
                  Claim earnings for {recipient.slice(0, 10)}…
                </button>
              ))}
            </section>
          )}
          {table.economy.mode === 'escrow' && (
            <details>
              <summary>Bounties, spectator bets and claims</summary>
              <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
                <label>
                  USDC amount{' '}
                  <input
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    inputMode="decimal"
                  />
                </label>
                <label>
                  Back player{' '}
                  <select
                    value={backSeat}
                    onChange={(e) => setBackSeat(e.target.value)}
                  >
                    <option value="sea_player_1">Player 1</option>
                    <option value="sea_player_2">Player 2</option>
                  </select>
                </label>
                <div className="actions">
                  {table.economy.bounties && (
                    <button
                      disabled={busy || table.stage !== 'funding'}
                      onClick={() => run(() => transact('bounty'))}
                    >
                      Fund bounty
                    </button>
                  )}
                  {table.economy.spectatorBets && (
                    <button
                      disabled={busy || table.stage !== 'funding'}
                      onClick={() => run(() => transact('bet'))}
                    >
                      Place bet
                    </button>
                  )}
                  <button
                    disabled={busy}
                    onClick={() => run(() => transact('withdraw'))}
                  >
                    Claim prize
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => run(() => transact('claimBet'))}
                  >
                    Claim spectator payout
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => run(() => transact('refund'))}
                  >
                    Claim refund
                  </button>
                  {table.recipients.map((recipient, index) => (
                    <button
                      key={`refund-${recipient}`}
                      disabled={busy}
                      onClick={() => run(() => transact('refund', recipient))}
                    >
                      Refund player {index + 1}
                    </button>
                  ))}
                  <button
                    disabled={busy}
                    onClick={() => run(() => transact('void'))}
                  >
                    Void expired match
                  </button>
                  {table.recipients.map((recipient, index) => (
                    <button
                      key={recipient}
                      disabled={busy || table.stage !== 'settled'}
                      onClick={() => run(() => transact('withdraw', recipient))}
                    >
                      Claim prize for player {index + 1}
                    </button>
                  ))}
                </div>
              </div>
            </details>
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
          <details>
            <summary>Payment and replay evidence</summary>
            <p style={{ overflowWrap: 'anywhere' }}>
              Shuffle commitment: {table.commitment}
            </p>
            {table.transactions.map((hash) => (
              <p key={hash} style={{ overflowWrap: 'anywhere' }}>
                {table.economy.mode === 'escrow' ? (
                  <a
                    target="_blank"
                    rel="noreferrer"
                    href={`${NETWORKS[table.economy.network].explorer}/tx/${hash}`}
                  >
                    {hash}
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
        </>
      )}
      <details open={table?.economy.mode === 'escrow'}>
        <summary>Use a Commons agent · wallets & spending grants</summary>
        <AgentWalletPanel table={table} onWalletSelected={setOther} />
      </details>
    </div>
  )
}
