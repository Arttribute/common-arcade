'use client'
import type { Observation, JsonValue } from '@common-arcade/protocol'
import { useEffect, useRef, useState } from 'react'
import {
  createPublicClient,
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
  type EconomyConfig,
  type EscrowDeployment,
} from '@common-arcade/economy'
import { AgentWalletPanel } from './agent-wallet-panel'
import { EconomySettings } from './economy-settings'
const service =
  process.env.NEXT_PUBLIC_ARCADE_PAYMENTS_URL ?? 'http://localhost:4021'
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
function provider() {
  const value = (window as unknown as { ethereum?: EIP1193Provider }).ethereum
  if (!value)
    throw new Error(
      'Connect an EVM wallet extension to play. Spectating needs no wallet.',
    )
  return value
}
export function GameEconomyTable({ releaseId }: { releaseId?: string } = {}) {
  const [observation, setObservation] = useState<Observation>()
  const [account, setAccount] = useState<Address>(),
    [other, setOther] = useState(''),
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
    request('/v1/economy/config')
      .then((r) => setNetworks(r.networks))
      .catch(() =>
        setMessage(
          'Payment playground service is not running. Start it to create or watch a table.',
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
  async function transact(
    operation:
      'stake' | 'bounty' | 'bet' | 'withdraw' | 'refund' | 'claimBet' | 'void',
    beneficiary?: Address,
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
    if (operation === 'stake' && seat < 0)
      throw new Error('This wallet is not a player at this table')
    const units =
      operation === 'stake'
        ? BigInt(table.economy.stakeUnits)
        : usdcUnits(amount)
    if (['stake', 'bounty', 'bet'].includes(operation))
      await adapter.submit(approvalCall(table.deployment, units))
    const hash = await adapter.submit(
      escrowCall(table.deployment, operation, table.pool, {
        seat: hashArcadeId(
          operation === 'bet'
            ? backSeat
            : seat === 0
              ? 'sea_player_1'
              : 'sea_player_2',
        ),
        amount: units,
        beneficiary: beneficiary ?? address,
      }),
    )
    setMessage(`Confirmed ${operation}: ${hash}`)
  }
  const seat =
      table?.recipients.findIndex(
        (a) => a.toLowerCase() === account?.toLowerCase(),
      ) ?? -1,
    myTurn =
      !!table?.state &&
      table.state.turn ===
        (seat === 0 ? 'sea_player_1' : seat === 1 ? 'sea_player_2' : '')
  return (
    <div style={{ display: 'grid', gap: 24, maxWidth: 960, marginTop: 28 }}>
      <div>
        <button
          className="secondary"
          disabled={busy}
          onClick={() =>
            run(async () => {
              await connect()
            })
          }
        >
          {account
            ? `${account.slice(0, 8)}…${account.slice(-6)}`
            : 'Connect wallet'}
        </button>
        <span role="status" style={{ marginLeft: 16 }}>
          {busy
            ? 'Waiting for confirmation…'
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
                    Approve and stake USDC
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
                  Send earnings to {recipient.slice(0, 10)}…
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
                      Send prize to player {index + 1}
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
