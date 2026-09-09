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
import { Check, RotateCcw, Share2, User, Bot, Circle } from 'lucide-react'

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
  const [viewer, setViewer] = useState<{ id: string; name: string } | null>(
    null,
  )
  const [controlledSeat, setControlledSeat] = useState<string>()
  const [connectingSeat, setConnectingSeat] = useState<string>()
  const [connecting, setConnecting] = useState(false)
  const [rosterOnline, setRosterOnline] = useState(true)
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
  const [agentPaused, setAgentPaused] = useState(false)
  const [agentStatus, setAgentStatus] = useState('')
  const agentFailures = useRef(0)
  const agentRetryAt = useRef(0)
  const latestMatch = useRef<MatchDescriptor | undefined>(undefined)
  const agentPending = useRef(false)
  const latestObservation = useRef<Observation | undefined>(undefined)
  const connectionGeneration = useRef(0)
  const [copied, setCopied] = useState(false)
  const clientRef = useRef<RealtimeClient | undefined>(undefined)
  const presentationRef = useRef<HTMLIFrameElement | null>(null)
  const actionSequence = useRef(0)

  useEffect(() => {
    let alive = true
    let pending = false
    let initialized = false
    const abort = new AbortController()
    void fetch('/api/auth/session', { signal: abort.signal })
      .then((r) => r.json())
      .then((session) => {
        if (alive) setViewer(session.user)
      })
      .catch(() => {})
    void arcade<{ agents: { agentId: string; name: string }[] }>(
      'commons/agents',
    )
      .then((result) => {
        if (alive && Array.isArray(result.agents)) setAgents(result.agents)
      })
      .catch(() => {})
    const hasStream = () => clientRef.current?.state === 'connected'
    const refresh = async () => {
      if (pending || hasStream()) return
      pending = true
      try {
        const next = await browserControlClient().getMatch(
          matchId,
          abort.signal,
        )
        if (!alive) return
        setRosterOnline(true)
        if (!hasStream()) setMatch(next)
        if (!initialized) {
          initialized = true
          if (next.lobby?.spectating !== 'disabled') void connect('spectate')
        }
      } catch (cause) {
        if (alive) {
          setRosterOnline(false)
          setError(cause instanceof Error ? cause.message : String(cause))
        }
      } finally {
        pending = false
      }
    }
    void refresh()
    // Only lobby metadata is polled when no realtime stream is available.
    const timer = window.setInterval(() => void refresh(), 3000)
    return () => {
      alive = false
      abort.abort()
      window.clearInterval(timer)
      connectionGeneration.current += 1
      clientRef.current?.close()
    }
  }, [matchId])

  function receive(message: RealtimeEnvelope) {
    if (message.type === 'control.granted') {
      const payload = message.payload as {
        controlLease?: unknown
        seatId?: string
      }
      setControlledSeat(payload.seatId)
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
    setControlledSeat(undefined)
    setConnecting(true)
    setConnectingSeat(seatId)
    setObservation(undefined)
    latestObservation.current = undefined
    const generation = ++connectionGeneration.current
    setActiveAgent(agentId)
    setAgentPaused(false)
    setAgentStatus(agentId ? 'Waiting for the game to start' : '')
    agentFailures.current = 0
    agentRetryAt.current = 0
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
      if (generation !== connectionGeneration.current) return
      const realtime = new RealtimeClient({
        url: `${session.realtimeUrl}?match=${encodeURIComponent(matchId)}`,
        matchId,
      })
      realtime.onMessage((message) => {
        if (generation === connectionGeneration.current) receive(message)
      })
      realtime.onStateChange((state) => {
        if (generation === connectionGeneration.current) setConnection(state)
      })
      clientRef.current?.close()
      clientRef.current = realtime
      await realtime.connect(session.ticket)
      if (generation === connectionGeneration.current) setRosterOnline(true)
    } catch (cause) {
      if (generation === connectionGeneration.current) {
        setError(cause instanceof Error ? cause.message : String(cause))
        // A claim can race another player. Refresh the authoritative roster.
        void browserControlClient()
          .getMatch(matchId)
          .then((next) => {
            if (generation === connectionGeneration.current) setMatch(next)
          })
          .catch(() => {})
      }
    } finally {
      if (generation === connectionGeneration.current) {
        setConnecting(false)
        setConnectingSeat(undefined)
      }
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
  latestMatch.current = match
  useEffect(() => {
    if (
      !activeAgent ||
      agentPaused ||
      !lease ||
      connection !== 'connected' ||
      match?.status !== 'running'
    )
      return
    const generation = connectionGeneration.current
    const timer = window.setInterval(() => {
      const current = latestObservation.current
      if (
        agentPending.current ||
        !current?.legalActions.length ||
        Date.now() < agentRetryAt.current
      )
        return
      setAgentStatus('Agent is choosing an action…')
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
            latestMatch.current?.status !== 'running' ||
            (latest.turn !== undefined &&
              latest.stateSequence !== decision.basedOnStateSequence)
          )
            return
          if (
            !latest.legalActions.some(
              (action) =>
                JSON.stringify(action) === JSON.stringify(decision.action),
            )
          ) {
            setAgentStatus('The game changed; choosing a fresh action…')
            return
          }
          agentFailures.current = 0
          setAgentStatus('Agent is playing')
          setError(undefined)
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
          if (connectionGeneration.current !== generation) return
          agentFailures.current += 1
          const detail = cause instanceof Error ? cause.message : String(cause)
          if (agentFailures.current >= 3) {
            setAgentPaused(true)
            setAgentStatus(`Agent paused: ${detail}`)
          } else {
            agentRetryAt.current = Date.now() + 2000 * agentFailures.current
            setAgentStatus(
              `Decision interrupted; retrying (${agentFailures.current}/3)…`,
            )
          }
        })
        .finally(() => {
          agentPending.current = false
        })
    }, 1000)
    return () => window.clearInterval(timer)
  }, [activeAgent, agentPaused, lease, connection, matchId, match?.status])

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
        <p className="roster-summary" aria-live="polite">
          <strong>
            {match?.seats.filter((seat) => seat.status !== 'open').length ?? 0}{' '}
            / {match?.seats.length ?? 0} seats taken
          </strong>
          <span>
            {connection === 'connected'
              ? '● Live seat updates'
              : rosterOnline
                ? 'Seat availability refreshes automatically'
                : 'Reconnecting — availability may be out of date'}
          </span>
        </p>
        <p className="match-rule-note">
          {match?.visibility === 'public'
            ? 'Public · listed on Live'
            : match?.visibility === 'private'
              ? 'Private · in Your sessions'
              : 'Unlisted · link only · in Your sessions'}
        </p>
        {!viewer ? (
          <a
            className="seat-sign-in"
            href={`/api/auth/login?next=/play/${encodeURIComponent(matchId)}`}
          >
            Sign in to take a seat
          </a>
        ) : null}
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
        {activeAgent ? (
          <div className="agent-live-status" role="status">
            <strong>
              {agents.find((agent) => agent.agentId === activeAgent)?.name ??
                'Commons agent'}
            </strong>
            <p>
              {match?.status === 'running'
                ? agentStatus
                : match?.status === 'lobby'
                  ? 'Waiting for the game to start'
                  : 'Agent stopped — the round has ended'}
            </p>
            {agentPaused ? (
              <button
                onClick={() => {
                  agentFailures.current = 0
                  agentRetryAt.current = 0
                  setAgentPaused(false)
                  setAgentStatus('Retrying agent decision…')
                }}
              >
                Retry agent
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="seat-list">
          {match?.seats.map((seat, index) => {
            const own = seat.actorId === viewer?.id && Boolean(viewer)
            const controlling =
              controlledSeat === seat.id && connection === 'connected'
            const humanController = seat.controllerId === `browser-${actorId}`
            const agentController =
              selectedAgent &&
              seat.controllerId === `commons-agent-${selectedAgent}`
            const agent = agents.find(
              (candidate) =>
                seat.controllerId === `commons-agent-${candidate.agentId}`,
            )
            const open = seat.status === 'open'
            const terminal = [
              'completed',
              'canceled',
              'expired',
              'failed',
              'invalidated',
            ].includes(match.status)
            const joinable = seat.joinable ?? (open && match.status === 'lobby')
            const disabled =
              connecting ||
              terminal ||
              Boolean(
                controlledSeat &&
                controlledSeat !== seat.id &&
                connection === 'connected',
              )
            return (
              <article
                key={seat.id}
                className={`roster-seat ${open ? 'is-open' : 'is-taken'} ${controlling ? 'is-yours' : ''}`}
                data-seat-id={seat.id}
              >
                <div className="roster-seat-heading">
                  <strong>
                    {seat.label ?? `${seat.role} · Seat ${index + 1}`}
                  </strong>
                  <span
                    className={`seat-status ${open ? 'is-open' : 'is-taken'}`}
                  >
                    {open ? 'Open' : 'Taken'}
                  </span>
                </div>
                {seat.team ? <small>Team {seat.team}</small> : null}
                <div className="seat-occupant">
                  {seat.controllerKind === 'agent' ? (
                    <Bot size={15} />
                  ) : open ? (
                    <Circle size={15} />
                  ) : (
                    <User size={15} />
                  )}
                  <span>
                    {open
                      ? 'Available seat'
                      : (agent?.name ??
                        (own
                          ? `${viewer!.name} (you)`
                          : seat.controllerKind === 'agent'
                            ? 'Agent player'
                            : 'Human player'))}
                  </span>
                </div>
                {!open ? (
                  <small className="seat-connection">
                    {controlling
                      ? 'You are controlling this seat'
                      : seat.status === 'connected'
                        ? 'Connected'
                        : seat.status === 'disconnected'
                          ? 'Disconnected · seat reserved'
                          : 'Claimed · waiting to connect'}
                  </small>
                ) : null}
                <details className="seat-identity">
                  <summary>Seat details</summary>
                  <dl>
                    <dt>Seat ID</dt>
                    <dd>{seat.id}</dd>
                    {seat.actorId ? (
                      <>
                        <dt>Account</dt>
                        <dd>{seat.actorId}</dd>
                      </>
                    ) : null}
                    {seat.controllerId ? (
                      <>
                        <dt>Controller</dt>
                        <dd>{seat.controllerId}</dd>
                      </>
                    ) : null}
                  </dl>
                </details>
                {viewer &&
                !controlling &&
                (joinable || (own && humanController)) &&
                match.lobby?.allowedControllers.includes('human') ? (
                  <button
                    disabled={disabled}
                    onClick={() => void connect('control', seat.id)}
                  >
                    {connectingSeat === seat.id
                      ? 'Connecting…'
                      : own && humanController
                        ? 'Reconnect to seat'
                        : `Take seat ${index + 1}`}
                  </button>
                ) : null}
                {viewer &&
                selectedAgent &&
                !controlling &&
                (joinable || (own && agentController)) &&
                match.lobby?.allowedControllers.includes('agent') ? (
                  <button
                    disabled={disabled}
                    onClick={() =>
                      void connect('control', seat.id, selectedAgent)
                    }
                  >
                    {connectingSeat === seat.id
                      ? 'Connecting…'
                      : `Assign ${agents.find((agent) => agent.agentId === selectedAgent)?.name ?? 'agent'}`}
                  </button>
                ) : null}
              </article>
            )
          })}
        </div>
        <button
          className="secondary compact"
          disabled={
            connecting ||
            (connection === 'connected' && !controlledSeat) ||
            match?.lobby?.spectating === 'disabled'
          }
          onClick={() => void connect('spectate')}
        >
          {match?.lobby?.spectating === 'disabled'
            ? 'Spectating disabled'
            : connection === 'connected' && !controlledSeat
              ? 'Watching live'
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
