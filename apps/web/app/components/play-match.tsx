'use client'

import { arcade, browserControlClient } from '../../lib/api'
import { RealtimeClient } from '@common-arcade/realtime-client'
import type {
  JsonValue,
  MatchDescriptor,
  Observation,
  RealtimeEnvelope,
} from '@common-arcade/protocol'
import { useEffect, useRef, useState } from 'react'
import { Check, RotateCcw, Share2 } from 'lucide-react'

const apiUrl = process.env.NEXT_PUBLIC_ARCADE_API_URL ?? 'http://localhost:4100'

interface BoardState {
  board: Array<string | null>
  currentSeatId: string
  winnerSeatId: string | null
  draw: boolean
}

function isBoardState(value: JsonValue | undefined): value is JsonValue & {
  board: JsonValue[]
} {
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Array.isArray(value.board),
  )
}

function actionLabel(action: JsonValue, index: number): string {
  if (action && typeof action === 'object' && !Array.isArray(action)) {
    if (typeof action.label === 'string') return action.label
    if (typeof action.type === 'string') return action.type
  }
  const encoded = JSON.stringify(action)
  return encoded.length <= 80 ? encoded : `Action ${index + 1}`
}

export function PlayMatch({
  matchId,
  initialActor,
}: {
  matchId: string
  initialActor: string
}) {
  const [actorId, setActorId] = useState(initialActor)
  const [agents, setAgents] = useState<{ agentId: string; name: string }[]>([])
  const [selectedAgent, setSelectedAgent] = useState('')
  useEffect(() => {
    let active = true
    void fetch('/api/auth/session')
      .then((r) => r.json())
      .then(async (session) => {
        if (!active || !session.user?.id) return
        setActorId(session.user.id)
        const result = await arcade<{
          agents:
            | { agentId: string; name: string }[]
            | { agents: { agentId: string; name: string }[] }
        }>('commons/agents')
        if (active)
          setAgents(
            Array.isArray(result.agents)
              ? result.agents
              : (result.agents.agents ?? []),
          )
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])
  async function assignAgent(seatId: string) {
    try {
      const result = await browserControlClient().claimSeat({
        matchId,
        seatId,
        controllerId: selectedAgent,
        controllerKind: 'agent',
      })
      setMatch(result)
      setCoachingStatus((v) => ({
        ...v,
        [seatId]: 'Agent assigned. Send coaching to start its strategy.',
      }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  const [match, setMatch] = useState<MatchDescriptor>()
  const [observation, setObservation] = useState<Observation>()
  const [publicState, setPublicState] = useState<JsonValue>()
  const [lease, setLease] = useState<string>()
  const [connection, setConnection] = useState('idle')
  const [lastResult, setLastResult] = useState<string>()
  const [error, setError] = useState<string>()
  const [copied, setCopied] = useState(false)
  const [coaching, setCoaching] = useState<Record<string, string>>({})
  const [coachingStatus, setCoachingStatus] = useState<Record<string, string>>(
    {},
  )
  const [coachingBusy, setCoachingBusy] = useState<Record<string, boolean>>({})
  async function coach(seatId: string, controllerId: string) {
    setCoachingBusy((v) => ({ ...v, [seatId]: true }))
    setCoachingStatus((v) => ({
      ...v,
      [seatId]: 'Agent is processing your coaching…',
    }))
    try {
      const applied = await arcade<{ strategy: string; strategyEpoch: number }>(
        `matches/${matchId}/seats/${encodeURIComponent(seatId)}/coach`,
        {
          prompt: coaching[seatId],
          agentId: controllerId.replace(/^agent:/, ''),
        },
      )
      setCoachingStatus((v) => ({
        ...v,
        [seatId]: `Strategy ${applied.strategyEpoch} active: ${applied.strategy}`,
      }))
    } catch (cause) {
      setCoachingStatus((v) => ({
        ...v,
        [seatId]: cause instanceof Error ? cause.message : String(cause),
      }))
    } finally {
      setCoachingBusy((v) => ({ ...v, [seatId]: false }))
    }
  }
  const clientRef = useRef<RealtimeClient | undefined>(undefined)
  const presentationRef = useRef<HTMLIFrameElement | null>(null)
  const actionSequence = useRef(0)

  useEffect(() => {
    const client = browserControlClient()
    void client
      .getMatch(matchId)
      .then(setMatch)
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => clientRef.current?.close()
  }, [matchId])

  function receive(message: RealtimeEnvelope) {
    if (message.type === 'control.granted') {
      const payload = message.payload as { controlLease?: unknown }
      if (typeof payload.controlLease === 'string')
        setLease(payload.controlLease)
    }
    if (message.type === 'observation.full') {
      setObservation(message.payload as unknown as Observation)
      setPublicState((message.payload as unknown as Observation).visibleState)
    }
    if (message.type === 'snapshot') {
      const payload = message.payload as unknown as {
        publicState?: JsonValue
        match?: MatchDescriptor
      }
      if (payload.publicState !== undefined) setPublicState(payload.publicState)
      if (payload.match !== undefined) setMatch(payload.match)
    }
    if (message.type === 'match.transition')
      setMatch(message.payload as unknown as MatchDescriptor)
    if (message.type === 'action.result') {
      const payload = message.payload as {
        disposition?: string
        detail?: string
      }
      setLastResult(
        `${payload.disposition ?? 'unknown'}${payload.detail ? ` · ${payload.detail}` : ''}`,
      )
    }
    if (message.type === 'error') {
      const payload = message.payload as { detail?: string }
      setError(payload.detail ?? 'Realtime protocol error')
    }
  }

  async function connect(mode: 'control' | 'spectate', seatId?: string) {
    setError(undefined)
    try {
      const controllerId = `browser-${actorId}`
      const control = browserControlClient()
      if (mode === 'control' && seatId !== undefined) {
        setMatch(await control.claimSeat({ matchId, seatId, controllerId }))
      }
      const session = await control.createSession({
        matchId,
        mode,
        ...(seatId === undefined ? {} : { seatId, controllerId }),
      })
      const realtime = new RealtimeClient({
        url: `${session.realtimeUrl}?match=${encodeURIComponent(matchId)}`,
        matchId,
      })
      realtime.onMessage(receive)
      realtime.onStateChange(setConnection)
      clientRef.current?.close()
      clientRef.current = realtime
      await realtime.connect(session.ticket)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  function submit(payload: JsonValue) {
    const seatId = observation?.seatId
    if (
      seatId === undefined ||
      lease === undefined ||
      observation === undefined
    )
      return
    actionSequence.current += 1
    clientRef.current?.submitAction({
      actionId: `act_${crypto.randomUUID().replaceAll('-', '')}`,
      matchId,
      seatId,
      controlLease: lease,
      clientSequence: actionSequence.current,
      basedOnStateSequence: observation.stateSequence,
      ...(observation.turn === undefined
        ? {}
        : { targetTurn: observation.turn }),
      ...(observation.tick === undefined
        ? {}
        : { targetTick: observation.tick + 1 }),
      payload,
    })
  }

  useEffect(() => {
    const receivePresentationAction = (event: MessageEvent) => {
      if (
        event.source !== presentationRef.current?.contentWindow ||
        event.data?.type !== 'arcade.action'
      )
        return
      submit(event.data.action as JsonValue)
    }
    window.addEventListener('message', receivePresentationAction)
    return () =>
      window.removeEventListener('message', receivePresentationAction)
  })

  function renderPresentation() {
    presentationRef.current?.contentWindow?.postMessage(
      {
        type: 'arcade.authoritative-state',
        state: observation?.visibleState ?? publicState ?? null,
        observation,
        match,
      },
      '*',
    )
  }

  useEffect(renderPresentation, [match, observation, publicState])

  async function restart() {
    setError(undefined)
    try {
      const next = await browserControlClient().restartRound(matchId)
      setMatch(next)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  async function share() {
    await navigator.clipboard.writeText(window.location.href)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1400)
  }

  const boardState = isBoardState(observation?.visibleState ?? publicState)
    ? ((observation?.visibleState ?? publicState) as unknown as BoardState)
    : undefined
  const legalCells = new Set(
    (observation?.legalActions ?? []).map((action) =>
      typeof action === 'object' && action !== null && 'cell' in action
        ? Number(action.cell)
        : -1,
    ),
  )

  return (
    <div className="match-shell">
      <aside className="match-panel">
        <div className="match-panel-title">
          <span className="panel-label">ROSTER</span>
          <button className="icon-copy" onClick={() => void share()}>
            {copied ? <Check size={12} /> : <Share2 size={12} />}
            {copied ? 'Copied' : 'Share'}
          </button>
        </div>
        <p style={{ fontSize: 11, color: '#78716c' }}>
          Sign in with Commons to claim a seat, or watch as a spectator.
        </p>
        {agents.length ? (
          <label>
            Agent
            <select
              value={selectedAgent}
              onChange={(event) => setSelectedAgent(event.target.value)}
            >
              <option value="">Select your agent</option>
              {agents.map((agent) => (
                <option key={agent.agentId} value={agent.agentId}>
                  {agent.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <div className="seat-list">
          {match?.seats.map((seat, index) => (
            <article key={seat.id}>
              <strong>Player {index + 1}</strong>
              <small>
                {seat.status} · {seat.actorId ?? 'unclaimed'}
                {seat.controllerKind ? ` · ${seat.controllerKind}` : ''}
              </small>
              {seat.status === 'open' &&
              selectedAgent &&
              match.lobby?.allowedControllers.includes('agent') ? (
                <button onClick={() => void assignAgent(seat.id)}>
                  Assign agent
                </button>
              ) : null}
              {seat.controllerKind === 'agent' &&
              seat.actorId === actorId &&
              seat.controllerId ? (
                <div>
                  <textarea
                    aria-label={`Coach Player ${index + 1}`}
                    placeholder="Tell your agent how to change its play…"
                    maxLength={2000}
                    value={coaching[seat.id] ?? ''}
                    onChange={(event) =>
                      setCoaching((v) => ({
                        ...v,
                        [seat.id]: event.target.value,
                      }))
                    }
                  />
                  <button
                    disabled={
                      coachingBusy[seat.id] || !coaching[seat.id]?.trim()
                    }
                    onClick={() => void coach(seat.id, seat.controllerId!)}
                  >
                    Coach agent
                  </button>
                  <p role="status">{coachingStatus[seat.id]}</p>
                </div>
              ) : null}
              <button
                disabled={connection === 'connected'}
                onClick={() => connect('control', seat.id)}
              >
                Claim & control
              </button>
            </article>
          ))}
        </div>
        <button
          className="secondary compact"
          disabled={match?.lobby?.spectating === 'disabled'}
          onClick={() => connect('spectate')}
        >
          {match?.lobby?.spectating === 'disabled'
            ? 'Spectating disabled'
            : 'Watch live'}
        </button>
        <p className="match-rule-note">
          {match?.lobby?.joinPolicy === 'invite-only'
            ? 'Invite-only lobby'
            : 'Open lobby'}{' '}
          · humans{' '}
          {match?.lobby?.allowedControllers.includes('human') ? 'on' : 'off'} ·
          agents{' '}
          {match?.lobby?.allowedControllers.includes('agent') ? 'on' : 'off'}
        </p>
      </aside>

      <section className="game-stage">
        <div className="stage-meta">
          <span>{match?.status ?? 'loading'}</span>
          <span>
            Round {match?.series?.currentRound ?? 1}/
            {match?.series?.maximumRounds ?? 1} · {connection}
          </span>
        </div>
        {match?.releaseId && !boardState ? (
          <iframe
            ref={presentationRef}
            className="live-game-frame"
            src={`/api/arcade/v1/studio/releases/${encodeURIComponent(match.releaseId)}/preview`}
            title="Live authoritative game"
            sandbox="allow-scripts"
            onLoad={renderPresentation}
          />
        ) : (
          <div
            className="tic-grid"
            aria-label="Game board"
            style={{
              gridTemplateColumns: `repeat(${Math.sqrt(boardState?.board.length ?? 9)}, 1fr)`,
            }}
          >
            {Array.from(
              { length: boardState?.board.length ?? 9 },
              (_, cell) => (
                <button
                  key={cell}
                  disabled={!legalCells.has(cell)}
                  onClick={() => submit({ type: 'place', cell })}
                  aria-label={`Cell ${cell + 1}`}
                >
                  {boardState?.board[cell] ?? ''}
                </button>
              ),
            )}
          </div>
        )}
        {!boardState && observation?.legalActions.length ? (
          <div className="live-action-strip" aria-label="Available actions">
            {observation.legalActions.slice(0, 12).map((action, index) => (
              <button key={index} onClick={() => submit(action)}>
                {actionLabel(action, index)}
              </button>
            ))}
          </div>
        ) : null}
        <strong className="game-outcome">
          {boardState?.winnerSeatId
            ? `Winner: ${boardState.winnerSeatId}`
            : boardState?.draw
              ? 'Draw'
              : boardState?.currentSeatId
                ? `Turn: ${boardState.currentSeatId}`
                : 'Connect to watch or play'}
        </strong>
        {match?.series?.status === 'awaiting-restart' ? (
          <button className="round-restart" onClick={() => void restart()}>
            <RotateCcw size={13} />
            {match.series.restartPolicy === 'unanimous'
              ? 'Vote for next round'
              : 'Start next round'}
          </button>
        ) : null}
        {match?.series?.status === 'complete' ? (
          <p className="series-complete">Series complete</p>
        ) : null}
      </section>

      <aside className="match-panel inspector">
        <span className="panel-label">AGENT / PROTOCOL</span>
        <dl>
          <dt>Match</dt>
          <dd>{matchId}</dd>
          <dt>State sequence</dt>
          <dd>{observation?.stateSequence ?? match?.stateSequence ?? 0}</dd>
          <dt>Event sequence</dt>
          <dd>{observation?.eventSequence ?? match?.eventSequence ?? 0}</dd>
          <dt>Last action</dt>
          <dd>{lastResult ?? '—'}</dd>
          <dt>Series score</dt>
          <dd>
            {Object.entries(match?.series?.scores ?? {})
              .map(([seat, score]) => `${seat.slice(-5)}: ${score}`)
              .join(' · ') || 'No wins yet'}
          </dd>
          <dt>Restart rule</dt>
          <dd>{match?.series?.restartPolicy ?? 'owner'}</dd>
        </dl>
        {connection === 'disconnected' ? (
          <button
            className="secondary compact"
            onClick={() => void clientRef.current?.resume()}
          >
            Resume session
          </button>
        ) : null}
        {error === undefined ? null : <p className="error-text">{error}</p>}
      </aside>
    </div>
  )
}
