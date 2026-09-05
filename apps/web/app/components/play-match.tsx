'use client'

import { browserControlClient } from '../../lib/api'
import { RealtimeClient } from '@common-arcade/realtime-client'
import type {
  MatchDescriptor,
  Observation,
  RealtimeEnvelope,
} from '@common-arcade/protocol'
import { useEffect, useRef, useState } from 'react'

const apiUrl = process.env.NEXT_PUBLIC_ARCADE_API_URL ?? 'http://localhost:4100'

interface BoardState {
  board: Array<string | null>
  currentSeatId: string
  winnerSeatId: string | null
  draw: boolean
}

export function PlayMatch({
  matchId,
  initialActor,
}: {
  matchId: string
  initialActor: string
}) {
  const [actorId] = useState(initialActor)
  const [match, setMatch] = useState<MatchDescriptor>()
  const [observation, setObservation] = useState<Observation>()
  const [publicBoard, setPublicBoard] = useState<BoardState>()
  const [lease, setLease] = useState<string>()
  const [connection, setConnection] = useState('idle')
  const [lastResult, setLastResult] = useState<string>()
  const [error, setError] = useState<string>()
  const clientRef = useRef<RealtimeClient | undefined>(undefined)
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
      setPublicBoard(
        (message.payload as unknown as Observation)
          .visibleState as unknown as BoardState,
      )
    }
    if (message.type === 'snapshot') {
      const payload = message.payload as unknown as {
        publicState?: BoardState
        match?: MatchDescriptor
      }
      if (payload.publicState !== undefined) setPublicBoard(payload.publicState)
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

  function play(cell: number) {
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
      targetTurn: observation.turn,
      payload: { type: 'place', cell },
    })
  }

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
        <span className="panel-label">ROSTER</span>
        <p style={{ fontSize: 11, color: '#78716c' }}>
          Sign in with Commons to claim a seat, or watch as a spectator.
        </p>
        <div className="seat-list">
          {match?.seats.map((seat, index) => (
            <article key={seat.id}>
              <strong>Player {index + 1}</strong>
              <small>
                {seat.status} · {seat.actorId ?? 'unclaimed'}
              </small>
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
          onClick={() => connect('spectate')}
        >
          Spectate
        </button>
      </aside>

      <section className="game-stage">
        <div className="stage-meta">
          <span>{match?.status ?? 'loading'}</span>
          <span>{connection}</span>
        </div>
        <div
          className="tic-grid"
          aria-label="Game board"
          style={{
            gridTemplateColumns: `repeat(${Math.sqrt(publicBoard?.board.length ?? 9)}, 1fr)`,
          }}
        >
          {Array.from({ length: publicBoard?.board.length ?? 9 }, (_, cell) => (
            <button
              key={cell}
              disabled={!legalCells.has(cell)}
              onClick={() => play(cell)}
              aria-label={`Cell ${cell + 1}`}
            >
              {publicBoard?.board[cell] ?? ''}
            </button>
          ))}
        </div>
        <strong className="game-outcome">
          {publicBoard?.winnerSeatId
            ? `Winner: ${publicBoard.winnerSeatId}`
            : publicBoard?.draw
              ? 'Draw'
              : publicBoard?.currentSeatId
                ? `Turn: ${publicBoard.currentSeatId}`
                : 'Connect to watch or play'}
        </strong>
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
