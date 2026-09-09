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
  const [actorId] = useState(initialActor)
  const [match, setMatch] = useState<MatchDescriptor>()
  const [observation, setObservation] = useState<Observation>()
  const [publicState, setPublicState] = useState<JsonValue>()
  const [lease, setLease] = useState<string>()
  const [connection, setConnection] = useState('idle')
  const [lastResult, setLastResult] = useState<string>()
  const [error, setError] = useState<string>()
  const [agents, setAgents] = useState<{ agentId: string; name: string }[]>([])
  const [selectedAgent, setSelectedAgent] = useState('')
  const [activeAgent, setActiveAgent] = useState<string>()
  const agentPending = useRef(false)
  const latestObservation = useRef<Observation | undefined>(undefined)
  const connectionGeneration = useRef(0)
  const [copied, setCopied] = useState(false)
  const clientRef = useRef<RealtimeClient | undefined>(undefined)
  const presentationRef = useRef<HTMLIFrameElement | null>(null)
  const actionSequence = useRef(0)

  useEffect(() => {
    void arcade<{ agents: { agentId: string; name: string }[] }>(
      'commons/agents',
    )
      .then((result) => {
        if (Array.isArray(result.agents)) setAgents(result.agents)
      })
      .catch(() => {})
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

  async function connect(
    mode: 'control' | 'spectate',
    seatId?: string,
    agentId?: string,
  ) {
    setError(undefined)
    setLease(undefined)
    setObservation(undefined)
    latestObservation.current = undefined
    connectionGeneration.current += 1
    setActiveAgent(agentId)
    try {
      const controllerId = agentId
        ? `commons-agent-${agentId}`
        : `browser-${actorId}`
      const control = browserControlClient()
      if (mode === 'control' && seatId !== undefined) {
        setMatch(
          await control.claimSeat({
            matchId,
            seatId,
            controllerId,
            controllerKind: agentId ? 'agent' : 'human',
          }),
        )
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
      match?.status !== 'running' ||
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

  latestObservation.current = observation
  useEffect(() => {
    if (
      !activeAgent ||
      !lease ||
      connection !== 'connected' ||
      match?.status !== 'running'
    )
      return
    const generation = connectionGeneration.current
    const timer = window.setInterval(() => {
      const current = latestObservation.current
      if (agentPending.current || !current?.legalActions.length) return
      agentPending.current = true
      void arcade<{
        action: JsonValue
        reason?: string
        basedOnStateSequence: number
      }>('commons/live-decisions', {
        agentId: activeAgent,
        observation: current,
      })
        .then((decision) => {
          const latest = latestObservation.current
          if (
            connectionGeneration.current !== generation ||
            !latest ||
            (latest.turn !== undefined &&
              latest.stateSequence !== decision.basedOnStateSequence)
          )
            return
          clientRef.current?.submitAction({
            actionId: `act_${crypto.randomUUID().replaceAll('-', '')}`,
            matchId,
            seatId: current.seatId,
            controlLease: lease,
            clientSequence: ++actionSequence.current,
            basedOnStateSequence: current.stateSequence,
            ...(current.turn === undefined ? {} : { targetTurn: current.turn }),
            payload: decision.action,
          })
          setLastResult(decision.reason)
        })
        .catch((cause) => {
          setError(cause instanceof Error ? cause.message : String(cause))
          setActiveAgent(undefined)
        })
        .finally(() => {
          agentPending.current = false
        })
    }, 1000)
    return () => window.clearInterval(timer)
  }, [activeAgent, lease, connection, matchId, match?.status])

  useEffect(() => {
    const receivePresentationAction = (event: MessageEvent) => {
      if (
        event.source !== presentationRef.current?.contentWindow ||
        event.data?.type !== 'arcade.action'
      )
        return
      if (!activeAgent) submit(event.data.action as JsonValue)
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

  async function abandon() {
    try {
      setMatch(await browserControlClient().abandonMatch(matchId))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

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
        {agents.length > 0 ? (
          <label>
            Commons agent
            <select
              value={selectedAgent}
              onChange={(event) => setSelectedAgent(event.target.value)}
            >
              <option value="">Choose an agent</option>
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
              <strong>
                {seat.role} {index + 1}
              </strong>
              <small>
                {seat.status} · {seat.actorId ?? 'unclaimed'}
                {seat.controllerKind ? ` · ${seat.controllerKind}` : ''}
              </small>
              <button
                disabled={connection === 'connected'}
                onClick={() => connect('control', seat.id)}
              >
                Claim & control
              </button>
              {selectedAgent ? (
                <button
                  disabled={connection === 'connected'}
                  onClick={() =>
                    void connect('control', seat.id, selectedAgent)
                  }
                >
                  Play with agent
                </button>
              ) : null}
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
        <button className="secondary compact" onClick={() => void abandon()}>
          End match
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
        {match?.releaseId ? (
          <iframe
            ref={presentationRef}
            className="live-game-frame"
            src={`/api/arcade/v1/studio/releases/${encodeURIComponent(match.releaseId)}/preview`}
            title="Live authoritative game"
            sandbox="allow-scripts"
            onLoad={renderPresentation}
          />
        ) : (
          <p role="status">
            {error ? 'The game could not be loaded.' : 'Loading game…'}
          </p>
        )}
        {observation?.legalActions.length ? (
          <div className="live-action-strip" aria-label="Available actions">
            {observation.legalActions.slice(0, 12).map((action, index) => (
              <button
                key={index}
                disabled={Boolean(activeAgent) || !lease}
                onClick={() => submit(action)}
              >
                {actionLabel(action, index)}
              </button>
            ))}
          </div>
        ) : null}
        <strong className="game-outcome">
          {match?.result !== undefined
            ? `Result: ${JSON.stringify(match.result)}`
            : connection === 'connected' && publicState !== undefined
              ? 'Live game connected'
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
