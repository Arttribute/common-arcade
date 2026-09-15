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
  ArrowRight,
  Eye,
  LogIn,
  LogOut,
  MessageSquare,
  Plug,
  Radio,
  Square,
  Check,
  ChevronDown,
  RotateCcw,
  Pause,
  Play,
  Share2,
  User,
  Bot,
  Circle,
  Maximize2,
  Minimize2,
} from 'lucide-react'

import { LiveControls, actionLabel } from './live-controls'
import { ExternalSeatAgent } from './external-seat-agent'
import { AgentSelect } from './agent-select'
import { LiveResultCard } from './live-result-card'
import './live-results.css'

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
  // Only seated players may vote; ending a session belongs to its host.
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
  const latestMatch = useRef<MatchDescriptor | undefined>(undefined)
  const latestObservation = useRef<Observation | undefined>(undefined)
  const connectionGeneration = useRef(0)
  const [copied, setCopied] = useState(false)
  // Engaged agent play: this page runs the agent's review loop. The agent keeps
  // or replaces a strategy script that the match worker executes at game speed.
  const [engaged, setEngaged] = useState<{ seatId: string; agentId: string }>()
  const [strategyPaused, setStrategyPaused] = useState(false)
  const [strategyStatus, setStrategyStatus] = useState<StrategyStatus>()
  const pendingNotes = useRef<Record<string, string>>({})
  const wakeStrategyLoop = useRef<(() => void) | undefined>(undefined)
  const resumedEngagement = useRef(false)
  const [coaching, setCoaching] = useState<Record<string, string>>({})
  const [coachingStatus, setCoachingStatus] = useState<Record<string, string>>(
    {},
  )
  const [coachingBusy, setCoachingBusy] = useState<Record<string, boolean>>({})
  async function coach(seatId: string, controllerId: string) {
    const note = coaching[seatId]?.trim()
    if (!note) return
    const agentId = controllerId.replace(/^(?:commons-agent-|agent:)/, '')
    if (engaged?.seatId === seatId && !strategyPaused) {
      // The running loop folds coaching into its next review, right away.
      pendingNotes.current[seatId] = note
      setCoaching((v) => ({ ...v, [seatId]: '' }))
      setCoachingStatus((v) => ({
        ...v,
        [seatId]: 'Your agent will use this coaching in its next review.',
      }))
      wakeStrategyLoop.current?.()
      return
    }
    setCoachingBusy((v) => ({ ...v, [seatId]: true }))
    setCoachingStatus((v) => ({
      ...v,
      [seatId]: 'Agent is reviewing its strategy with your coaching…',
    }))
    try {
      const applied = await arcade<{ strategy: string; strategyEpoch: number }>(
        `matches/${matchId}/seats/${encodeURIComponent(seatId)}/coach`,
        { prompt: note, agentId },
      )
      setCoaching((v) => ({ ...v, [seatId]: '' }))
      setCoachingStatus((v) => ({
        ...v,
        [seatId]: `Strategy ${applied.strategyEpoch} active: ${applied.strategy}`,
      }))
      if (!engaged) {
        setStrategyPaused(false)
        setEngaged({ seatId, agentId })
      }
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
    // Taking a seat yourself ends this page's agent loop for that seat.
    if (mode === 'control' && seatId && !agentId && engaged?.seatId === seatId)
      setEngaged(undefined)
    setActiveAgent(undefined)
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
      if (mode === 'control' && seatId && agentId) {
        // Agents do not hold a browser control lease. The match worker runs
        // their strategy; this page keeps the agent reviewing it.
        setStrategyPaused(false)
        setStrategyStatus(undefined)
        setEngaged({ seatId, agentId })
        if (match?.lobby?.spectating === 'disabled') return
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
    if (!engaged || strategyPaused) return
    const { seatId, agentId } = engaged
    let alive = true
    let wake: (() => void) | undefined
    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        const done = () => {
          window.clearTimeout(timer)
          wake = undefined
          resolve()
        }
        const timer = window.setTimeout(done, Math.max(0, ms))
        wake = done
      })
    wakeStrategyLoop.current = () => wake?.()
    const update = (next: Partial<StrategyStatus>) =>
      setStrategyStatus((current) => ({
        phase: 'reviewing',
        message: '',
        ...current,
        ...next,
      }))
    void (async () => {
      let sessionId: string | undefined
      let reviews = 0
      let failures = 0
      while (alive) {
        const current = latestMatch.current
        if (current && ENDED_STATUSES.includes(current.status)) {
          if (current.series?.status === 'awaiting-restart') {
            update({ phase: 'waiting', message: 'Waiting for the next round' })
            await sleep(3000)
            continue
          }
          update({ phase: 'stopped', message: 'The match has ended' })
          return
        }
        const note = pendingNotes.current[seatId]
        update({
          phase: 'reviewing',
          message: note
            ? 'Reviewing its strategy with your coaching…'
            : 'Reviewing the game and its strategy…',
        })
        try {
          const result = await arcade<StrategyReviewResult>(
            `matches/${matchId}/seats/${encodeURIComponent(seatId)}/strategy/review`,
            {
              agentId,
              ...(note ? { note } : {}),
              ...(sessionId ? { sessionId } : {}),
            },
          )
          if (!alive) return
          failures = 0
          if (note && pendingNotes.current[seatId] === note) {
            delete pendingNotes.current[seatId]
            setCoachingStatus((v) => ({
              ...v,
              [seatId]: 'Coaching applied in the latest review.',
            }))
          }
          if (result.sessionId !== sessionId) reviews = 0
          sessionId = result.sessionId
          reviews += result.status === 'waiting' ? 0 : 1
          if (reviews >= (result.reviewsPerSession ?? 8)) {
            sessionId = undefined
            reviews = 0
          }
          const nextReviewInMs = result.nextReviewInMs ?? 8000
          update({
            phase: result.status === 'waiting' ? 'waiting' : 'playing',
            message:
              result.status === 'waiting'
                ? 'Waiting for its next decision point'
                : result.decision === 'keep'
                  ? 'Kept its strategy'
                  : `Switched to strategy ${result.strategyEpoch}`,
            strategy: result.strategy,
            strategyEpoch: result.strategyEpoch,
            ...(result.reason ? { reason: result.reason } : {}),
            ...(result.performance ? { performance: result.performance } : {}),
            nextReviewAt: nextReviewInMs
              ? Date.now() + nextReviewInMs
              : undefined,
          })
          setError(undefined)
          await sleep(nextReviewInMs)
        } catch (cause) {
          if (!alive) return
          const detail = cause instanceof Error ? cause.message : String(cause)
          if (/superseded/i.test(detail)) {
            await sleep(500)
            continue
          }
          // Between series rounds the match is briefly inactive; the loop
          // re-checks the match status at the top and stops only if it ended.
          if (/no longer active/i.test(detail)) {
            await sleep(3000)
            continue
          }
          if (
            /owner of this agent seat|does not control this seat/i.test(detail)
          ) {
            update({ phase: 'stopped', message: detail })
            return
          }
          failures += 1
          if (failures >= 3) {
            update({ phase: 'paused', message: `Agent paused: ${detail}` })
            setStrategyPaused(true)
            return
          }
          update({
            phase: 'retrying',
            message: `Review interrupted; retrying (${failures}/3)…`,
          })
          await sleep(2000 * failures)
        }
      }
    })()
    return () => {
      alive = false
      wakeStrategyLoop.current = undefined
      wake?.()
    }
  }, [engaged?.seatId, engaged?.agentId, strategyPaused, matchId])

  // After a reload, keep reviewing for an agent you already seated here.
  useEffect(() => {
    if (resumedEngagement.current || engaged || !viewer || !match) return
    if (
      ENDED_STATUSES.includes(match.status) &&
      match.series?.status !== 'awaiting-restart'
    )
      return
    const seat = match.seats.find(
      (candidate) =>
        candidate.actorId === viewer.id &&
        candidate.controllerKind === 'agent' &&
        agents.some(
          (agent) =>
            candidate.controllerId === `commons-agent-${agent.agentId}`,
        ),
    )
    if (!seat?.controllerId) return
    resumedEngagement.current = true
    setEngaged({
      seatId: seat.id,
      agentId: seat.controllerId.replace(/^commons-agent-/, ''),
    })
  }, [viewer, match, agents, engaged])

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
    if (engaged?.seatId === seatId) setEngaged(undefined)
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

  // Exactly one seat is expanded: the one this viewer is in, or — if they have
  // none — the first seat they could still take. Every other seat stays a
  // single summary row, so a full roster does not bury the stage.
  const expandedSeatId =
    match?.seats.find(
      (seat) =>
        seat.id === controlledSeat || (viewer && seat.actorId === viewer.id),
    )?.id ??
    match?.seats.find(
      (seat) =>
        seat.joinable ?? (seat.status === 'open' && match.status === 'lobby'),
    )?.id

  async function share() {
    await navigator.clipboard.writeText(window.location.href)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1400)
  }

  return (
    <div className="match-shell">
      <aside
        className="match-panel live-player-panel"
        aria-label="Players and session options"
        tabIndex={0}
      >
        <div className="match-panel-title">
          <strong aria-live="polite">
            {match?.seats.filter((seat) => seat.status !== 'open').length ?? 0}{' '}
            / {match?.seats.length ?? 0} seats taken
          </strong>
          <button className="icon-copy" onClick={() => void share()}>
            {copied ? <Check size={16} /> : <Share2 size={16} />}
            {copied ? 'Copied' : 'Share'}
          </button>
        </div>
        <p className="roster-summary" aria-live="polite">
          <span>
            {terminal ? (
              ended ? (
                'Session ended'
              ) : (
                'Round complete'
              )
            ) : connection === 'connected' ? (
              <>
                <Radio size={16} aria-hidden />
                Live seat updates
              </>
            ) : rosterOnline ? (
              'Seat availability refreshes automatically'
            ) : (
              'Reconnecting — availability may be out of date'
            )}
          </span>
        </p>
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
            <LogIn size={16} aria-hidden />
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
        {engaged ? (
          <div className="agent-live-status" role="status">
            <strong>
              {agents.find((agent) => agent.agentId === engaged.agentId)
                ?.name ?? 'Commons agent'}
            </strong>
            <p>
              {strategyPaused
                ? strategyStatus?.phase === 'paused'
                  ? strategyStatus.message
                  : 'Paused. Its strategy stops running within a minute.'
                : (strategyStatus?.message ?? 'Starting its first review…')}
            </p>
            {strategyStatus?.strategyEpoch ? (
              <p>
                <small>Strategy {strategyStatus.strategyEpoch}</small>{' '}
                {strategyStatus.strategy}
              </p>
            ) : null}
            {strategyStatus?.reason ? (
              <p>
                <small>Why</small> {strategyStatus.reason}
              </p>
            ) : null}
            {strategyStatus?.performance?.decisions ? (
              <p>
                <small>Since last review</small>{' '}
                {performanceSummary(strategyStatus.performance)}
              </p>
            ) : null}
            <button
              className="secondary compact"
              onClick={() => {
                if (strategyPaused) setStrategyStatus(undefined)
                setStrategyPaused((paused) => !paused)
              }}
            >
              {strategyPaused ? (
                <Play size={16} aria-hidden />
              ) : (
                <Pause size={16} aria-hidden />
              )}
              {strategyPaused ? 'Resume agent' : 'Pause agent'}
            </button>
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
              <details
                key={seat.id}
                open={seat.id === expandedSeatId}
                className={`roster-seat ${open ? 'is-open' : 'is-taken'} ${controlling ? 'is-yours' : ''}`}
                data-seat-id={seat.id}
              >
                <summary className="roster-seat-heading">
                  <strong>
                    {seat.label ?? `${seat.role} · Seat ${index + 1}`}
                  </strong>
                  <span
                    className={`seat-status ${open ? 'is-open' : 'is-taken'}`}
                  >
                    {open ? 'Open' : 'Taken'}
                  </span>
                  <ChevronDown
                    size={16}
                    className="roster-seat-chevron"
                    aria-hidden
                  />
                </summary>
                <div className="roster-seat-body">
                  {seat.team ? <small>Team {seat.team}</small> : null}
                  <div className="seat-occupant">
                    {seat.controllerKind === 'agent' ? (
                      <Bot size={16} />
                    ) : open ? (
                      <Circle size={16} />
                    ) : (
                      <User size={16} />
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
                  <details className="seat-identity live-disclosure">
                    <summary>
                      <span>Seat details</span>
                      <ChevronDown size={16} aria-hidden />
                    </summary>
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
                      <User size={16} aria-hidden />
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
                      <Bot size={16} aria-hidden />
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
                      <Plug size={16} aria-hidden />
                      Connect external agent
                    </button>
                  ) : null}
                  {own && agent && !terminal && seat.controllerId ? (
                    <div className="seat-coaching">
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
                        <MessageSquare size={16} aria-hidden />
                        {engaged?.seatId === seat.id && !strategyPaused
                          ? 'Send to next review'
                          : 'Coach agent'}
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
                      <LogOut size={16} aria-hidden />
                      Leave seat
                    </button>
                  ) : null}
                </div>
              </details>
            )
          })}
        </div>
        {/* Only the host may end the session; the backend enforces ownership.
            Pinned to the foot of the panel so it is reachable without
            scrolling past however many seats the game has. */}
        <div className="match-panel-actions is-pinned">
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
            <Eye size={16} aria-hidden />
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
          {!terminal && viewer && match?.ownerId === viewer.id ? (
            <button className="danger compact" onClick={() => void abandon()}>
              <Square size={16} aria-hidden />
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
          <span className="stage-state">
            {terminal
              ? ended
                ? 'Session ended'
                : 'Round complete'
              : match?.status === 'running'
                ? 'Live'
                : match?.status === 'lobby'
                  ? 'Waiting for players'
                  : 'Loading'}
          </span>
          <span className="stage-dot" aria-hidden />
          <span>
            Round {match?.series?.currentRound ?? 1}/
            {match?.series?.maximumRounds ?? 1}
          </span>
          {!terminal ? (
            <>
              <span className="stage-dot" aria-hidden />
              <span>
                {match?.result !== undefined
                  ? `Result: ${JSON.stringify(match.result)}`
                  : connection === 'connected' && publicState !== undefined
                    ? 'Live game connected'
                    : connection !== 'idle'
                      ? connection
                      : 'Connect to watch or play'}
              </span>
            </>
          ) : null}
          <button
            className="fullscreen-toggle"
            aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            onClick={() => void toggleFullscreen()}
          >
            {fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            {fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          </button>
        </div>
        <div className={`live-stage-view${terminal ? ' is-finished' : ''}`}>
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
          {terminal && match ? (
            <LiveResultCard
              key={`${match.status}:${match.series?.currentRound ?? 1}`}
              match={match}
              ended={ended}
              restart={
                !ended &&
                (match.series?.restartPolicy === 'unanimous'
                  ? seatedHere
                  : match.ownerId === viewer?.id)
                  ? {
                      label:
                        match.series?.restartPolicy === 'unanimous'
                          ? 'Vote for next round'
                          : 'Start next round',
                      run: () => void restart(),
                    }
                  : undefined
              }
            />
          ) : null}
        </div>
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
      </section>

      <aside className="match-panel inspector">
        <details className="live-disclosure">
          <summary>
            <span>Session details</span>
            <ChevronDown size={16} aria-hidden />
          </summary>
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
            <RotateCcw size={16} aria-hidden />
            Resume session
          </button>
        ) : null}
        {error === undefined ? null : <p className="error-text">{error}</p>}
      </aside>
    </div>
  )
}

const ENDED_STATUSES = [
  'completed',
  'canceled',
  'expired',
  'failed',
  'invalidated',
]

type StrategyPerformance = {
  windowMs?: number
  decisions?: number
  rejectedActions?: number
  reward?: { total: number; positive: number; negative: number }
}

type StrategyStatus = {
  phase: 'reviewing' | 'playing' | 'waiting' | 'retrying' | 'paused' | 'stopped'
  message: string
  strategy?: string
  strategyEpoch?: number
  reason?: string
  performance?: StrategyPerformance
  nextReviewAt?: number
}

type StrategyReviewResult = {
  status: 'applied' | 'kept' | 'waiting'
  decision?: 'keep' | 'replace'
  strategy: string
  strategyEpoch: number
  reason?: string
  sessionId?: string
  reviewsPerSession?: number
  nextReviewInMs?: number
  performance?: StrategyPerformance
}

function performanceSummary(performance: StrategyPerformance): string {
  return [
    `${performance.decisions} decisions`,
    performance.reward
      ? `reward ${performance.reward.total >= 0 ? '+' : ''}${performance.reward.total}`
      : undefined,
    performance.rejectedActions
      ? `${performance.rejectedActions} rejected`
      : undefined,
  ]
    .filter(Boolean)
    .join(' · ')
}
