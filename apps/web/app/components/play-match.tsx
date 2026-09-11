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
import {
  Check,
  RotateCcw,
  Share2,
  User,
  Bot,
  Circle,
  Maximize2,
  Minimize2,
} from 'lucide-react'

import { LiveControls, actionLabel } from './live-controls'
import { ExternalSeatAgent } from './external-seat-agent'
import { LivePaymentPanel } from './live-payment-panel'
import { AgentSelect } from './agent-select'

function resultLabel(
  result: JsonValue,
  seats: MatchDescriptor['seats'],
): string {
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    if (typeof result.message === 'string') return result.message
    const winner = result.winner ?? result.winnerSeatId
    if (typeof winner === 'string')
      return `Winner: ${seats.find((seat) => seat.id === winner)?.label ?? winner}`
    if (result.draw === true || result.winner === null) return 'Draw'
  }
  return typeof result === 'string' ? result : JSON.stringify(result)
}

export function PlayMatch({
  matchId,
  initialActor,
}: {
  matchId: string
  initialActor: string
}) {
  const stageRef = useRef<HTMLElement>(null)
  const [fullscreen, setFullscreen] = useState(false)
  useEffect(() => {
    const changed = () =>
      setFullscreen(document.fullscreenElement === stageRef.current)
    document.addEventListener('fullscreenchange', changed)
    return () => document.removeEventListener('fullscreenchange', changed)
  }, [])
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await stageRef.current?.requestFullscreen()
    } catch {
      setError('Fullscreen is unavailable in this browser.')
    }
  }
  const [actorId] = useState(initialActor)
  const [viewer, setViewer] = useState<{ id: string; name: string } | null>(
    null,
  )
  const [controlledSeat, setControlledSeat] = useState<string>()
  const [connectingSeat, setConnectingSeat] = useState<string>()
  const [connecting, setConnecting] = useState(false)
  const [rosterOnline, setRosterOnline] = useState(true)
  const [match, setMatch] = useState<MatchDescriptor>()
  // Signed in and holding a seat in this match — gates the destructive session
  // controls away from spectators.
  const seatedHere = Boolean(
    viewer && match?.seats.some((seat) => seat.actorId === viewer.id),
  )
  const [observation, setObservation] = useState<Observation>()
  const [publicState, setPublicState] = useState<JsonValue>()
  const [lease, setLease] = useState<string>()
  const [connection, setConnection] = useState('idle')
  const [lastResult, setLastResult] = useState<string>()
  const [error, setError] = useState<string>()
  const [agents, setAgents] = useState<{ agentId: string; name: string }[]>([])
  const [selectedAgent, setSelectedAgent] = useState('')
  const [activeAgent, setActiveAgent] = useState<string>()
  const [externalSetup, setExternalSetup] = useState<{
    seatId: string
    controllerId: string
  }>()
  const [controlFeedback, setControlFeedback] = useState('')
  const [inputMode, setInputMode] = useState<'standard' | 'game'>('standard')
  const submittedActions = useRef(new Map<string, string>())
  const presentationIntent = useRef<string | undefined>(undefined)
  const presentationRelease = useRef<JsonValue | undefined>(undefined)
  const [agentPaused, setAgentPaused] = useState(false)
  const [agentStatus, setAgentStatus] = useState('')
  const agentFailures = useRef(0)
  const agentRetryAt = useRef(0)
  const latestMatch = useRef<MatchDescriptor | undefined>(undefined)
  const agentPending = useRef(false)
  const latestObservation = useRef<Observation | undefined>(undefined)
  const connectionGeneration = useRef(0)
  const [copied, setCopied] = useState(false)
  const coachedSeats = useRef(new Set<string>())
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
          agentId: controllerId.replace(/^(?:commons-agent-|agent:)/, ''),
        },
      )
      coachedSeats.current.add(seatId)
      if (controlledSeat === seatId) {
        setAgentPaused(true)
        setAgentStatus('Coached strategy is running on the match worker')
        if (match?.lobby?.spectating !== 'disabled') await connect('spectate')
      }
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
  const terminal = Boolean(
    match &&
    ['completed', 'canceled', 'expired', 'failed', 'invalidated'].includes(
      match.status,
    ),
  )
  const ended = terminal && match?.series?.status !== 'awaiting-restart'
  const localControllerKind = activeAgent ? 'agent' : 'human'

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
        actionId?: string
        disposition?: string
        detail?: string
      }
      setLastResult(
        `${payload.disposition ?? 'unknown'}${payload.detail ? ` · ${payload.detail}` : ''}`,
      )
      const label = payload.actionId
        ? submittedActions.current.get(payload.actionId)
        : undefined
      if (payload.actionId) submittedActions.current.delete(payload.actionId)
      if (
        payload.disposition !== 'accepted' &&
        payload.disposition !== 'duplicate'
      )
        presentationIntent.current = undefined
      if (label)
        setControlFeedback(
          payload.disposition === 'accepted'
            ? `${label} applied. The game is up to date.`
            : `${label} was not applied: ${payload.detail ?? payload.disposition ?? 'try again'}`,
        )
    }
    if (message.type === 'error') {
      const payload = message.payload as { detail?: string; code?: string }
      if (payload.code === 'CONTROL_REVOKED') {
        setLease(undefined)
        setControlledSeat(undefined)
        setObservation(undefined)
        setActiveAgent(undefined)
        setControlFeedback('Control of this seat has changed.')
      }
      setError(payload.detail ?? 'Realtime protocol error')
    }
  }

  async function connect(
    mode: 'control' | 'spectate',
    seatId?: string,
    agentId?: string,
  ) {
    setError(undefined)
    if (mode === 'control') setExternalSetup(undefined)
    clientRef.current?.close()
    clientRef.current = undefined
    setConnection('idle')
    submittedActions.current.clear()
    presentationIntent.current = undefined
    presentationRelease.current = undefined
    setControlFeedback('')
    setLease(undefined)
    setControlledSeat(undefined)
    setConnecting(true)
    setConnectingSeat(seatId)
    setObservation(undefined)
    latestObservation.current = undefined
    const generation = ++connectionGeneration.current
    if (seatId) coachedSeats.current.delete(seatId)
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
        const seat = match?.seats.find((candidate) => candidate.id === seatId)
        const input = {
          matchId,
          seatId,
          controllerId,
          controllerKind: agentId ? ('agent' as const) : ('human' as const),
        }
        setMatch(
          seat?.actorId === viewer?.id &&
            seat?.controllerId &&
            seat.controllerId !== controllerId
            ? await control.changeSeatController({
                ...input,
                expectedControllerId: seat.controllerId,
              })
            : await control.claimSeat(input),
        )
      }
      if (
        mode === 'control' &&
        seatId &&
        agentId &&
        match?.lobby?.spectating !== 'disabled' &&
        ['realtime', 'hybrid'].includes(match?.mode ?? '')
      ) {
        await arcade(
          `matches/${matchId}/seats/${encodeURIComponent(seatId)}/autoplay`,
          { controllerId },
        )
        coachedSeats.current.add(seatId)
        setAgentPaused(true)
        setActiveAgent(undefined)
        setAgentStatus(
          'Arcade realtime policy is playing on the match worker. Use coaching to change its strategy.',
        )
        mode = 'spectate'
        seatId = undefined
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
    if (connection !== 'connected' || activeAgent) return
    actionSequence.current += 1
    const actionId = `act_${crypto.randomUUID().replaceAll('-', '')}`
    const label = actionLabel(payload)
    if (submittedActions.current.size >= 100) submittedActions.current.clear()
    submittedActions.current.set(actionId, label)
    setControlFeedback(`${label} sent…`)
    clientRef.current?.submitAction({
      actionId,
      matchId,
      seatId,
      controlLease: lease,
      clientSequence: actionSequence.current,
      basedOnStateSequence: observation.stateSequence,
      ...(observation.turn === undefined
        ? {}
        : { targetTurn: observation.turn }),
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
            coachedSeats.current.has(current.seatId) ||
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
        activeAgent ||
        inputMode !== 'game'
      )
        return
      if (event.data?.type === 'arcade.release-input') {
        if (presentationRelease.current !== undefined)
          submit(presentationRelease.current)
        presentationIntent.current = undefined
        presentationRelease.current = undefined
        return
      }
      if (event.data?.type !== 'arcade.action') return
      const action = event.data.action as JsonValue
      const id =
        action && typeof action === 'object' && !Array.isArray(action)
          ? action.id
          : undefined
      const legal = observation?.legalActions ?? []
      const advertised = legal.find(
        (candidate) =>
          JSON.stringify(candidate) === JSON.stringify(action) ||
          (typeof id === 'string' &&
            candidate &&
            typeof candidate === 'object' &&
            !Array.isArray(candidate) &&
            candidate.id === id),
      )
      const control =
        advertised &&
        typeof advertised === 'object' &&
        !Array.isArray(advertised)
          ? (advertised.control as
              { mode?: string; releaseActionId?: string } | undefined)
          : undefined
      const release =
        control?.mode === 'hold'
          ? legal.find(
              (candidate) =>
                candidate &&
                typeof candidate === 'object' &&
                !Array.isArray(candidate) &&
                candidate.id === control.releaseActionId,
            )
          : undefined
      const isRelease =
        typeof id === 'string' &&
        legal.some(
          (candidate) =>
            candidate &&
            typeof candidate === 'object' &&
            !Array.isArray(candidate) &&
            (candidate.control as { releaseActionId?: string } | undefined)
              ?.releaseActionId === id,
        )
      if (release !== undefined || isRelease) {
        const intent = JSON.stringify(action)
        if (presentationIntent.current === intent) return
        presentationIntent.current = intent
        presentationRelease.current = release
      } else {
        presentationIntent.current = undefined
        presentationRelease.current = undefined
      }
      submit(action)
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
        mode: controlledSeat ? 'control' : 'spectate',
        controllerKind: controlledSeat ? localControllerKind : undefined,
        inputEnabled: Boolean(
          lease &&
          !activeAgent &&
          inputMode === 'game' &&
          match?.status === 'running',
        ),
      },
      '*',
    )
  }

  useEffect(renderPresentation, [
    match,
    observation,
    publicState,
    controlledSeat,
    lease,
    activeAgent,
    inputMode,
  ])

  async function leaveSeat(seatId: string) {
    const seat = match?.seats.find((candidate) => candidate.id === seatId)
    if (!seat?.controllerId) return
    setConnecting(true)
    setError(undefined)
    ++connectionGeneration.current
    clientRef.current?.close()
    clientRef.current = undefined
    setConnection('idle')
    setControlledSeat(undefined)
    setObservation(undefined)
    setActiveAgent(undefined)
    setLease(undefined)
    try {
      setMatch(
        await browserControlClient().releaseSeat({
          matchId,
          seatId,
          expectedControllerId: seat.controllerId,
        }),
      )
      setExternalSetup(undefined)
      if (match?.lobby?.spectating !== 'disabled') await connect('spectate')
      else {
        setConnection('idle')
        setControlledSeat(undefined)
        setObservation(undefined)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setConnecting(false)
    }
  }

  async function reserveExternal(seatId: string) {
    const seat = match?.seats.find((candidate) => candidate.id === seatId)
    if (!seat) return
    setConnecting(true)
    setError(undefined)
    ++connectionGeneration.current
    clientRef.current?.close()
    clientRef.current = undefined
    setConnection('idle')
    setControlledSeat(undefined)
    setObservation(undefined)
    setActiveAgent(undefined)
    setLease(undefined)
    try {
      const controllerId = `external-${crypto.randomUUID()}`
      const input = {
        matchId,
        seatId,
        controllerId,
        controllerKind: 'agent' as const,
      }
      const control = browserControlClient()
      setMatch(
        seat.actorId === viewer?.id && seat.controllerId
          ? await control.changeSeatController({
              ...input,
              expectedControllerId: seat.controllerId,
            })
          : await control.claimSeat(input),
      )
      setExternalSetup({ seatId, controllerId })
      if (match?.lobby?.spectating !== 'disabled') await connect('spectate')
      else {
        setConnection('idle')
        setControlledSeat(undefined)
        setObservation(undefined)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setConnecting(false)
    }
  }

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
            {terminal
              ? ended
                ? 'Session ended'
                : 'Round complete'
              : connection === 'connected'
                ? '● Live seat updates'
                : rosterOnline
                  ? 'Seat availability refreshes automatically'
                  : 'Reconnecting — availability may be out of date'}
          </span>
        </p>
        {match && (
          <LivePaymentPanel
            releaseId={match.releaseId}
            matchId={matchId}
            agentId={
              activeAgent ||
              match.seats
                .find(
                  (seat) =>
                    seat.controllerKind === 'agent' &&
                    seat.controllerId?.startsWith('commons-agent-'),
                )
                ?.controllerId?.replace(/^commons-agent-/, '') ||
              selectedAgent ||
              undefined
            }
          />
        )}
        <p className="match-rule-note">
          {match?.visibility === 'public'
            ? 'Public · listed on Live'
            : match?.visibility === 'private'
              ? 'Private · in Your sessions'
              : 'Unlisted · link only · in Your sessions'}
        </p>
        {!viewer && !terminal ? (
          <a
            className="seat-sign-in"
            href={`/api/auth/login?next=/play/${encodeURIComponent(matchId)}`}
          >
            Sign in to take a seat
          </a>
        ) : null}
        {agents.length > 0 ? (
          <div className="field">
            <span className="field-label">Commons agent</span>
            <AgentSelect
              agents={agents}
              value={selectedAgent}
              onChange={setSelectedAgent}
              allowNone
            />
          </div>
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
            {agentPaused && !coachedSeats.current.has(controlledSeat ?? '') ? (
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
                    {terminal
                      ? 'Played in this session'
                      : controlling
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
                (!controlling || localControllerKind === 'agent') &&
                (joinable || own) &&
                match.lobby?.allowedControllers.includes('human') ? (
                  <button
                    disabled={disabled}
                    onClick={() => void connect('control', seat.id)}
                  >
                    {connectingSeat === seat.id
                      ? 'Connecting…'
                      : own
                        ? humanController
                          ? 'Reconnect as human'
                          : 'Play myself'
                        : `Take seat ${index + 1}`}
                  </button>
                ) : null}
                {viewer &&
                selectedAgent &&
                (!controlling || !agentController) &&
                (joinable || own) &&
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
                {viewer &&
                !terminal &&
                (joinable || own) &&
                match.lobby?.allowedControllers.includes('agent') ? (
                  <button
                    className="secondary"
                    disabled={disabled}
                    onClick={() => {
                      if (own && seat.controllerId?.startsWith('external-'))
                        setExternalSetup({
                          seatId: seat.id,
                          controllerId: seat.controllerId,
                        })
                      else void reserveExternal(seat.id)
                    }}
                  >
                    Connect external agent
                  </button>
                ) : null}
                {own && agent && !terminal && seat.controllerId ? (
                  <div>
                    <textarea
                      aria-label={`Coach ${seat.label ?? `Player ${index + 1}`}`}
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
                {own && !terminal ? (
                  <button
                    className="secondary"
                    disabled={connecting}
                    onClick={() => void leaveSeat(seat.id)}
                  >
                    Leave seat
                  </button>
                ) : null}
              </article>
            )
          })}
        </div>
        {/* The two session controls share a row with one gap, and the
            destructive one is separated and tinted rather than sitting flush
            against Watch live. Ending a session ends it for everyone, so it is
            not offered to spectators or signed-out visitors — the descriptor
            carries no owner identity, so holding a seat here is the closest
            signal the client has. Narrowing it to the host proper would need an
            owner field on the match descriptor. */}
        <div className="match-panel-actions">
          <button
            className="secondary compact"
            disabled={
              terminal ||
              connecting ||
              (connection === 'connected' && !controlledSeat) ||
              match?.lobby?.spectating === 'disabled'
            }
            onClick={() =>
              controlledSeat
                ? void leaveSeat(controlledSeat)
                : void connect('spectate')
            }
          >
            {terminal
              ? 'Session ended'
              : match?.lobby?.spectating === 'disabled'
                ? 'Spectating disabled'
                : connection === 'connected' && !controlledSeat
                  ? 'Watching live'
                  : controlledSeat
                    ? 'Leave seat and watch'
                    : 'Watch live'}
          </button>
          {!terminal && seatedHere ? (
            <button className="danger compact" onClick={() => void abandon()}>
              End session
            </button>
          ) : null}
        </div>
        {externalSetup && !terminal ? (
          <ExternalSeatAgent
            matchId={matchId}
            {...externalSetup}
            connected={
              match?.seats.find((seat) => seat.id === externalSetup.seatId)
                ?.status === 'connected'
            }
            onClose={() => setExternalSetup(undefined)}
          />
        ) : null}
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

      <section className="game-stage" ref={stageRef}>
        <div className="stage-meta">
          <button
            className="fullscreen-toggle"
            aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            onClick={() => void toggleFullscreen()}
          >
            {fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            {fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          </button>
          <span>{match?.status ?? 'loading'}</span>
          <span>
            Round {match?.series?.currentRound ?? 1}/
            {match?.series?.maximumRounds ?? 1} · {connection}
          </span>
        </div>
        {terminal ? (
          <div className="session-ended" role="status" aria-live="assertive">
            <span className="eyebrow">
              {ended ? 'SESSION ENDED' : 'ROUND COMPLETE'}
            </span>
            <h2>
              {ended ? 'This live session has ended' : 'This round is complete'}
            </h2>
            <p>
              {match?.status === 'canceled'
                ? 'The host ended this session.'
                : match?.status === 'expired'
                  ? 'This session expired.'
                  : ['failed', 'invalidated'].includes(match?.status ?? '')
                    ? 'The session stopped before it could finish.'
                    : ended
                      ? 'The final result is in. Play has stopped for everyone.'
                      : 'Waiting for the next round. Play is paused for everyone.'}
            </p>
            {match?.result !== undefined ? (
              <div className="session-outcome">
                <strong>Final result</strong>
                <p>{resultLabel(match.result, match.seats)}</p>
              </div>
            ) : null}
            <p>You are no longer sending game actions.</p>
            <div className="session-next">
              <a href="/live">Find another live session</a>
              <a href="/">Browse games</a>
            </div>
          </div>
        ) : match?.releaseId ? (
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
        {!terminal && observation && !activeAgent ? (
          <LiveControls
            inputMode={inputMode}
            onInputMode={(mode) => {
              if (presentationRelease.current !== undefined)
                submit(presentationRelease.current)
              presentationIntent.current = undefined
              presentationRelease.current = undefined
              setInputMode(mode)
              if (mode === 'game') presentationRef.current?.focus()
            }}
            observation={observation}
            disabled={
              !lease ||
              connection !== 'connected' ||
              match?.status !== 'running'
            }
            feedback={controlFeedback}
            onAction={submit}
          />
        ) : null}
        {!terminal ? (
          <strong className="game-outcome">
            {match?.result !== undefined
              ? `Result: ${JSON.stringify(match.result)}`
              : connection === 'connected' && publicState !== undefined
                ? 'Live game connected'
                : 'Connect to watch or play'}
          </strong>
        ) : null}
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
        <details>
          <summary>Session details</summary>
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
        </details>
        {connection === 'disconnected' && !terminal ? (
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
