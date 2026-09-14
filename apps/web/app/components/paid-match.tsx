'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Eye, Maximize2, Radio, Share2, Square } from 'lucide-react'
import { createPublicClient, http, type Address } from 'viem'
import {
  NETWORKS,
  escrowCall,
  hashArcadeId,
  usdcUnits,
  type SettlementAccounting,
  type EconomyConfig,
} from '@common-arcade/economy'
import type { JsonValue } from '@common-arcade/protocol'
import { gameSessionKey, signGameCommand } from '../../lib/game-session-key'
import { connectedPaymentWallet } from '../../lib/browser-wallets'
import { paymentService } from '../../lib/paid-session'
import { agentWalletApi, type PaidLobby } from '../../lib/agent-game-payment'
import { submitSeatPayment } from '../../lib/seat-payment'
import { enterSeat, type SeatEntry } from '../../lib/seat-entry'
import { AgentSelect } from './agent-select'
import { PaidSeatJoin } from './paid-seat-join'
import { PaidRealtimeGame } from './paid-realtime-game'
import { SpectatorBet } from './spectator-bet'
import { PaidSessionResult } from './paid-session-result'
import { useBrowserWallet } from './browser-wallet-picker'
import './payments.css'
import './live-results.css'

interface Table extends Omit<PaidLobby, 'economy'> {
  economy: EconomyConfig
  stage: string
  releaseId?: string
  published?: boolean
  game?: string
  mode?: string
  host?: Address
  sequence: number
  runtimeError?: string
  openSeats?: boolean
  autoplay?: string[]
  result?: JsonValue
  accounting?: SettlementAccounting
  fundingDeadline: number
  settlementDeadline: number
  startWhenReady?: boolean
  readyAt?: number
  state?: JsonValue
  entry?: SeatEntry
}
async function request<T>(path: string, body?: unknown): Promise<T> {
  if (!paymentService) throw new Error('Live paid sessions are unavailable')
  const response = await fetch(`${paymentService}/v1/economy/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const result = await response.json()
  if (!response.ok)
    throw new Error(result.error ?? 'Could not update this session')
  return result
}

/** The same live layout as PlayMatch. Money is an action on a seat, never a route gate. */
export function PaidMatch({ matchId }: { matchId: string }) {
  const [table, setTable] = useState<Table>()
  const latest = useRef<Table>(undefined)
  const [state, setState] = useState<JsonValue>()
  const [account, setAccount] = useState<Address>()
  const [controlAddress, setControlAddress] = useState<string>()
  const [joinedWallet, setJoinedWallet] = useState<string>()
  const [agents, setAgents] = useState<{ agentId: string; name: string }[]>([])
  const [agentId, setAgentId] = useState('')
  const [expandedSeat, setExpandedSeat] = useState(0)
  const [signedIn, setSignedIn] = useState(false)
  const [online, setOnline] = useState(false)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [pendingCards, setPendingCards] = useState<string[]>([])
  const [copied, setCopied] = useState(false)
  const [legacyReady, setLegacyReady] = useState(false)
  const legacyTicket = useRef<{ token: string }>(undefined)
  const stage = useRef<HTMLElement>(null)
  const { provider } = useBrowserWallet()
  function cardBusy(card: string, pending: boolean) {
    setPendingCards((cards) =>
      pending
        ? [...new Set([...cards, card])]
        : cards.filter((id) => id !== card),
    )
  }
  const agent = agents.find((a) => a.agentId === agentId)
  const refresh = useCallback(async () => {
    const next = await request<Table>(`matches/${matchId}`)
    latest.current = next
    setTable(next)
  }, [matchId])
  useEffect(() => {
    void refresh().catch((e) => setMessage(e.message))
    void fetch('/api/auth/session')
      .then((r) => r.json())
      .then(async (session) => {
        setSignedIn(!!session.user)
        if (!session.user) return
        const response = await agentWalletApi<
          | { agentId: string; name: string }[]
          | { data: { agentId: string; name: string }[] }
        >('agents')
        const list = Array.isArray(response) ? response : response.data
        setAgents(list)
        setAgentId(list[0]?.agentId ?? '')
      })
      .catch(() => {})
    const key = gameSessionKey(matchId, false)
    if (key) setControlAddress(key.address)
    setJoinedWallet(
      sessionStorage.getItem(`arcade:joined:${matchId}`) ?? undefined,
    )
  }, [matchId, refresh])
  useEffect(() => {
    let active = true
    const changed = (accounts: string[]) => {
      if (active) {
        setAccount(accounts[0] as Address | undefined)
        legacyTicket.current = undefined
        setLegacyReady(false)
      }
    }
    setAccount(undefined)
    void provider
      ?.request({ method: 'eth_accounts' })
      .then((accounts) => changed(accounts as string[]))
      .catch(() => {})
    provider?.on?.('accountsChanged', changed)
    return () => {
      active = false
      provider?.removeListener?.('accountsChanged', changed)
    }
  }, [provider])
  useEffect(() => {
    if (!paymentService) return
    let stopped = false
    let socket: WebSocket
    let retry: ReturnType<typeof setTimeout>
    const open = () => {
      socket = new WebSocket(
        `${paymentService.replace(/^http/, 'ws')}/v1/economy/live?matchId=${encodeURIComponent(matchId)}`,
      )
      socket.onopen = () => setOnline(true)
      socket.onmessage = (event) => {
        try {
          const value = JSON.parse(event.data)
          if (value.type === 'presentation') setState(value.state)
          else if (value.id === matchId) {
            latest.current = value
            setTable(value)
          }
        } catch {
          /* A later authoritative snapshot repairs a malformed update. */
        }
      }
      socket.onclose = () => {
        setOnline(false)
        if (!stopped) retry = setTimeout(open, 2000)
      }
    }
    open()
    // Reconcile onchain funding only; gameplay runs entirely on its worker clock.
    const timer = setInterval(() => {
      if (latest.current?.stage === 'funding') void refresh().catch(() => {})
    }, 4000)
    return () => {
      stopped = true
      clearTimeout(retry)
      clearInterval(timer)
      socket?.close()
    }
  }, [matchId, refresh])
  async function walletAuth(operation: string) {
    const current = latest.current!
    const wallet = await connectedPaymentWallet(
      current.economy.mode === 'escrow' ? current.economy.network : undefined,
    )
    const expiresAt = Date.now() + 60000
    setAccount(wallet.account.address)
    return {
      address: wallet.account.address,
      expiresAt,
      signature: await wallet.signMessage({
        message: JSON.stringify({
          domain: paymentService,
          matchId,
          operation,
          body: {},
          expiresAt,
        }),
      }),
    }
  }
  async function pay(
    operation:
      'stake' | 'bet' | 'bounty' | 'refund' | 'withdraw' | 'claimBet' | 'void',
    seat: number,
    amount: string,
    progress: (s: string) => void,
  ) {
    const current = latest.current!
    if (
      !current.deployment ||
      !current.pool ||
      current.economy.mode !== 'escrow'
    )
      throw new Error('This game has no payment pool')
    const wallet = await connectedPaymentWallet(current.economy.network)
    setAccount(wallet.account.address)
    const key = gameSessionKey(matchId)!
    if (operation === 'stake' && current.entry) {
      // One signature, no network fee: the game service relays the signed entry.
      await enterSeat({
        matchId,
        entry: current.entry,
        deployment: current.deployment,
        stakeUnits: current.economy.stakeUnits,
        wallet,
        seat,
        controller: key.address,
        onProgress: progress,
      })
      setControlAddress(key.address)
      setJoinedWallet(wallet.account.address.toLowerCase())
      sessionStorage.setItem(
        `arcade:joined:${matchId}`,
        wallet.account.address.toLowerCase(),
      )
      await refresh().catch(() =>
        progress('Seat confirmed. Reconnecting to the game…'),
      )
      return
    }
    const units =
      operation === 'stake'
        ? BigInt(current.economy.stakeUnits)
        : operation === 'bet' || operation === 'bounty'
          ? usdcUnits(amount)
          : 0n
    await submitSeatPayment({
      deployment: current.deployment,
      wallet,
      reader: createPublicClient({
        chain: NETWORKS[current.economy.network].chain,
        transport: http(),
      }),
      call: escrowCall(current.deployment, operation, current.pool, {
        seat: hashArcadeId(`sea_player_${seat + 1}`),
        amount: units,
        beneficiary: wallet.account.address,
        ...(operation === 'stake' ? { controller: key.address } : {}),
      }),
      amount: units,
      onProgress: progress,
    })
    if (operation === 'stake' && current.deployment.seatControllers) {
      setControlAddress(key.address)
      setJoinedWallet(wallet.account.address.toLowerCase())
      sessionStorage.setItem(
        `arcade:joined:${matchId}`,
        wallet.account.address.toLowerCase(),
      )
    }
    await refresh().catch(() =>
      progress('Payment confirmed. Reconnecting to the game…'),
    )
  }
  async function run(work: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    setMessage('')
    try {
      await work()
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : 'Could not complete this action',
      )
    } finally {
      setBusy(false)
    }
  }
  const yours =
    table?.recipients.findIndex(
      (a) => a.toLowerCase() === account?.toLowerCase(),
    ) ?? -1
  const host =
    table?.host?.toLowerCase() === controlAddress?.toLowerCase() ||
    table?.host?.toLowerCase() === account?.toLowerCase()
  const ended =
    table?.stage === 'settled' || table?.stage === 'settlement-pending'
  const expired =
    !!table &&
    Date.now() >=
      (table.stage === 'funding'
        ? table.fundingDeadline
        : table.settlementDeadline) *
        1000
  const refundable =
    table?.accounting?.status === 'refundable' ||
    (table?.result &&
      typeof table.result === 'object' &&
      !Array.isArray(table.result) &&
      table.result.outcome === 'canceled') ||
    !ended
  const joinedHere =
    !!table?.deployment?.seatControllers &&
    !!controlAddress &&
    !!account &&
    joinedWallet === account.toLowerCase()
  return (
    <div className="match-shell">
      <aside
        className="match-panel live-player-panel"
        aria-label="Players and session options"
        tabIndex={0}
      >
        <div className="match-panel-title">
          <strong aria-live="polite">
            {table?.funded?.filter(Boolean).length ?? 0} /{' '}
            {table?.recipients.length ?? 2} seats taken
          </strong>
          <button
            className="icon-copy"
            onClick={() =>
              void navigator.clipboard
                .writeText(window.location.href)
                .then(() => setCopied(true))
            }
          >
            {copied ? <Check size={16} /> : <Share2 size={16} />}
            {copied ? 'Copied' : 'Share'}
          </button>
        </div>
        <p className="roster-summary">
          <span>
            <Radio size={16} />{' '}
            {online ? 'Live seat updates' : 'Reconnecting live updates…'}
          </span>
        </p>
        <p className="match-rule-note">
          Unlisted · share the link to invite players
        </p>
        {table?.stage === 'funding' && table.startWhenReady && (
          <p className="match-rule-note">
            {table.readyAt
              ? 'Both seats are ready. Starting shortly…'
              : 'Starts automatically when both seats are ready.'}
          </p>
        )}
        {agents.length > 0 && (
          <div className="field">
            <span className="field-label">Commons agent</span>
            <AgentSelect
              agents={agents}
              value={agentId}
              onChange={setAgentId}
              disabled={pendingCards.length > 0}
              allowNone
            />
          </div>
        )}
        {!signedIn && (
          <a
            className="seat-sign-in"
            href={`/api/auth/login?next=${encodeURIComponent(`/play/${matchId}?paid=1`)}`}
          >
            Sign in to assign your agent
          </a>
        )}
        <div className="seat-list">
          {table?.economy.mode === 'escrow' &&
            table.recipients.map((_, seat) => (
              <PaidSeatJoin
                key={`${seat}:${agentId}`}
                table={table as PaidLobby}
                seat={seat}
                account={account}
                agent={agent}
                expanded={expandedSeat === seat}
                onExpand={() =>
                  setExpandedSeat(expandedSeat === seat ? -1 : seat)
                }
                agentPlaying={table.autoplay?.includes(String(seat))}
                onBusyChange={(pending) => cardBusy(`seat:${seat}`, pending)}
                playing={table.stage !== 'funding'}
                canResume={
                  table.stage === 'funding' || table.stage === 'playing'
                }
                onRefresh={refresh}
                onJoin={async (seat, progress) => {
                  await pay('stake', seat, '', progress)
                }}
              />
            ))}
          {table?.stage === 'funding' &&
            table.economy.mode === 'escrow' &&
            (table.economy.spectatorBets || table.economy.bounties) && (
              <SpectatorBet
                table={table as PaidLobby}
                agent={agent}
                onBusyChange={(pending) => cardBusy('spectator', pending)}
                onRefresh={refresh}
                onBet={pay}
              />
            )}
        </div>
        {table?.autoplay?.length ? (
          <p className="match-rule-note" role="status">
            {table.autoplay.length} agent{table.autoplay.length > 1 ? 's' : ''}{' '}
            ready · plays automatically
          </p>
        ) : null}
        <div className="match-panel-actions is-pinned">
          <button className="secondary compact" disabled>
            <Eye size={16} />
            {yours >= 0 ? `Playing · Seat ${yours + 1}` : 'Watching live'}
          </button>
          {host && table?.stage === 'funding' && (
            <button
              className="primary compact"
              disabled={busy || !table.funded?.every(Boolean)}
              onClick={() =>
                void run(async () => {
                  const auth =
                    table.host?.toLowerCase() === controlAddress?.toLowerCase()
                      ? await signGameCommand(
                          paymentService,
                          matchId,
                          'start',
                          {},
                        )
                      : await walletAuth('start')
                  const next = await request<Table>(
                    `matches/${matchId}/start`,
                    auth,
                  )
                  latest.current = next
                  setTable(next)
                })
              }
            >
              Start game
            </button>
          )}
          {host && table?.stage === 'funding' && (
            <button
              className="danger compact"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const auth =
                    table.host?.toLowerCase() === controlAddress?.toLowerCase()
                      ? await signGameCommand(
                          paymentService,
                          matchId,
                          'cancel',
                          {},
                        )
                      : await walletAuth('cancel')
                  const next = await request<Table>(
                    `matches/${matchId}/cancel`,
                    auth,
                  )
                  latest.current = next
                  setTable(next)
                })
              }
            >
              <Square size={16} /> End session
            </button>
          )}
          {table?.stage === 'playing' &&
            yours >= 0 &&
            !joinedHere &&
            !legacyReady && (
              <button
                className="secondary compact"
                onClick={() =>
                  void run(async () => {
                    const session = await request<{ token: string }>(
                      `matches/${matchId}/realtime-session`,
                      await walletAuth('realtime-session'),
                    )
                    legacyTicket.current = session
                    setLegacyReady(true)
                  })
                }
              >
                Resume my controls
              </button>
            )}
          {table?.economy.mode === 'escrow' && (ended || expired) && (
            <>
              <button
                className="secondary compact"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    if (expired && !ended) await pay('void', 0, '', setMessage)
                    await pay(
                      refundable ? 'refund' : 'withdraw',
                      0,
                      '',
                      setMessage,
                    )
                    setMessage('Claim confirmed.')
                  })
                }
              >
                {refundable ? 'Claim refund' : 'Claim winnings'}
              </button>
              {table.economy.spectatorBets && (
                <button
                  className="secondary compact"
                  disabled={busy}
                  onClick={() =>
                    void run(() => pay('claimBet', 0, '', setMessage))
                  }
                >
                  Claim spectator payout
                </button>
              )}
            </>
          )}
        </div>
        {message && (
          <p role="status" className="seat-payment-message">
            {message}
          </p>
        )}
      </aside>
      <section className="game-stage" ref={stage}>
        <div className="stage-meta">
          <span className="stage-state">
            {ended
              ? 'Session ended'
              : table?.stage === 'playing'
                ? 'Live'
                : 'Waiting for players'}
          </span>
          <span className="stage-dot" />
          {table?.game}
          <button
            className="fullscreen-toggle"
            onClick={() =>
              void (document.fullscreenElement
                ? document.exitFullscreen()
                : stage.current?.requestFullscreen())
            }
          >
            <Maximize2 size={16} /> Fullscreen
          </button>
        </div>
        {table?.releaseId ? (
          <PaidRealtimeGame
            service={paymentService}
            table={table}
            account={account}
            publicState={state}
            controllerReady={(joinedHere && yours >= 0) || legacyReady}
            authorize={async () => {
              if (legacyTicket.current) {
                const ticket = legacyTicket.current
                legacyTicket.current = undefined
                return ticket
              }
              return request<{ token: string }>(
                `matches/${matchId}/realtime-session`,
                joinedHere
                  ? await signGameCommand(
                      paymentService,
                      matchId,
                      'realtime-session',
                      {},
                    )
                  : await walletAuth('realtime-session'),
              )
            }}
          />
        ) : (
          <p role="status">{message || 'Opening game…'}</p>
        )}
        {ended && table && <PaidSessionResult {...table} />}
      </section>
      <aside className="match-panel inspector">
        <details className="live-disclosure">
          <summary>Session details</summary>
          <p>{matchId}</p>
          <p>
            Entry is paid only when a player takes a seat. Spectating is free.
          </p>
          {table?.economy.mode === 'escrow' && (
            <p>
              {NETWORKS[table.economy.network].chain.name} · test USDC ·{' '}
              {table.economy.feeBps / 100}% success fee
            </p>
          )}
        </details>
      </aside>
    </div>
  )
}
