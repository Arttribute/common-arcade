'use client'
import { AccountMenu } from './account-menu'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { MAKE_LIVE_READY_PROMPT } from '../lib/live-ready'
import { ArcadeComposer, useArcadeIdentity } from './studio-composer'
import {
  ArrowLeft,
  ArrowUp,
  Bot,
  Check,
  Code2,
  Download,
  FlaskConical,
  Folder,
  Gamepad2,
  History,
  Loader2,
  MapPin,
  Maximize2,
  MessageSquare,
  Minimize2,
  MousePointer2,
  PanelLeftClose,
  PanelRightClose,
  Pause,
  Play,
  Plus,
  Radio,
  RotateCcw,
  Save,
  Scan,
  Settings2,
  Share2,
  SkipForward,
  Sparkles,
  Upload,
  Users,
  X,
} from 'lucide-react'
import {
  AnnotationLayer,
  CanvasShell,
  CommonsButton as Button,
  CompiledArtifactFrame,
  type AnnotationGeometry,
  CanvasToolButton,
  CodeFileBrowser,
  CommonsWindow,
  type CompiledFrameHandle,
  type CanvasObservation,
  type CanvasRecording,
} from '@agent-commons/ui'
import {
  assessLiveReadiness,
  compilePresentation,
  defaultGameDistribution,
  gameDocumentSchema,
  emptyBrowserDocument,
  isBrowserGame,
  type GameDocument,
  type StudioProject,
  type StudioRelease,
} from '@common-arcade/studio'
import type { TestRun } from '@common-arcade/control-client'
import { arcade, arcadeCopilot, type CopilotActivity } from '../../lib/api'
import { RecordingShelf, storeRecording } from './recording-shelf'

type Agent = { agentId: string; name: string }
type BrowserController = {
  seatId: string
  label: string
  kind: 'human' | 'agent'
  agentId?: string
  sessionId?: string
  strategy: string
  strategyEpoch?: number
  lastActionId?: string
  lastDecisionAt?: number
  performance?: {
    decisions: number
    feedbackSamples: number
    cumulativeReward: number
    recentReward: number
    improving: boolean
  }
  policyMemory?: {
    preferredDefense?: string
    actions: Record<
      string,
      { samples: number; totalReward: number; meanReward: number }
    >
    lastLesson?: string
  }
}
type BrowserFeedback = {
  actionId: string
  outcome: 'positive' | 'negative' | 'neutral' | 'unknown'
  reward: number
  summary: string
  observedAfterMs: number
  metrics: Record<string, number>
}
type BrowserEvent = {
  step: number
  seatId?: string
  observation: CanvasObservation
  decision: {
    actionId: string
    reason: string
    learning?: { lesson: string; confidence: number }
  }
  decisionSource?:
    'commons' | 'arcade-policy' | 'arcade-fallback' | 'human' | 'external'
  feedback?: BrowserFeedback
  adaptation?: {
    from: string
    to: string
    strategyEpoch: number
    reason: string
    source: string
  }
  timing?: { decisionLatencyMs: number; observationFrame?: number }
  performance?: BrowserController['performance']
  controller?: Pick<
    BrowserController,
    'kind' | 'agentId' | 'strategy' | 'strategyEpoch' | 'policyMemory'
  >
}
type BrowserRun = {
  id: string
  step: number
  revision: number
  createdAt: string
  controllers: BrowserController[]
  events?: BrowserEvent[]
}
type Run = TestRun & {
  document: GameDocument
  revision: number
  digest: string
  agents: string[]
}
type Log = {
  sequence: number
  type: string
  summary: string
  category: string
  source: { seatId?: string; kind: string }
  data: unknown
}
export function GameStudio({ projectId }: { projectId: string }) {
  const router = useRouter()
  const compiledRef = useRef<CompiledFrameHandle>(null)
  const previewStageRef = useRef<HTMLDivElement>(null)
  const annotationContext = useRef<Promise<unknown> | undefined>(undefined)
  const browserDecisionActive = useRef(false)
  const browserOutcome = useRef(
    new Map<string, { state: unknown; actionId: string; actedAt: number }>(),
  )
  const [shareRecordings, setShareRecordings] = useState(false),
    [recordingsRefresh, setRecordingsRefresh] = useState(0)
  const [browserRun, setBrowserRun] = useState<BrowserRun>()
  const [browserRuns, setBrowserRuns] = useState<BrowserRun[]>([])
  const [browserEvents, setBrowserEvents] = useState<BrowserEvent[]>([])
  const [browserObservation, setBrowserObservation] =
    useState<CanvasObservation>()
  const [browserPlaying, setBrowserPlaying] = useState(false)
  const [browserDeciding, setBrowserDeciding] = useState(false)
  const [logsOpen, setLogsOpen] = useState(true)
  const [browserAction, setBrowserAction] = useState<{
    seat: string
    action: string
    fallback: boolean
  }>()
  const [fullscreen, setFullscreen] = useState(false)
  const defaultBrowserControllers = useCallback((game: GameDocument) => {
    const count = isBrowserGame(game) ? (game.play?.seats.default ?? 2) : 2
    return Array.from({ length: count }, (_, index): BrowserController => ({
      seatId: `seat-${index + 1}`,
      label: `Player ${index + 1}`,
      kind: index === 0 ? 'human' : 'agent',
      strategy:
        index === 0
          ? 'Human controlled.'
          : 'Play to win, adapt to the opponent, and use only legal actions.',
    }))
  }, [])
  const [browserControllers, setBrowserControllers] = useState<
    BrowserController[]
  >(() => defaultBrowserControllers(emptyBrowserDocument))
  async function browserDecision() {
    if (!project || dirty)
      throw new Error('Save the project before running a browser playtest.')
    if (!compiledRef.current)
      throw new Error('Open Preview to playtest the game.')
    const current = browserRun ?? (await startBrowserRun())
    if (current.revision !== project.revision)
      throw new Error('Start a new playtest for this revision.')
    const observation = await compiledRef.current.observe()
    const agents = current.controllers.filter(
      (controller) => controller.kind === 'agent',
    )
    if (!agents.length) throw new Error('Add an agent-controlled seat first.')
    const ordered = agents.map(
      (_, index) => agents[(current.step + index) % agents.length]!,
    )
    const selected = ordered.find(
      (controller) =>
        actionsForSeat(observation.actions, controller.seatId).length,
    )
    if (!selected) {
      setBrowserPlaying(false)
      throw new Error(
        'No agent-controlled seat has a legal action. Make a human move or restart the session.',
      )
    }
    const rawSeatState = stateForSeat(observation.state, selected.seatId)
    const prior = browserOutcome.current.get(selected.seatId)
    const feedback = prior
      ? transitionFeedback(
          prior.state,
          rawSeatState,
          prior.actionId,
          Date.now() - prior.actedAt,
        )
      : undefined
    const seatObservation = {
      state: enrichRealtimeState(rawSeatState),
      actions: actionsForSeat(observation.actions, selected.seatId),
    }
    setBrowserAction({
      seat: selected.label,
      action: 'Choosing a move…',
      fallback: false,
    })
    const event = await arcade<BrowserEvent>(
      `studio/browser-runs/${current.id}/decide`,
      {
        step: current.step,
        seatId: selected.seatId,
        observation: seatObservation,
        ...(feedback ? { feedback } : {}),
        decisionMode:
          isBrowserGame(document) && document.play?.mode === 'realtime'
            ? 'realtime-policy'
            : 'model',
      },
    )
    const chosen = seatObservation.actions.find(
      (action) => action.id === event.decision.actionId,
    )
    setBrowserAction({
      seat: selected.label,
      action: chosen?.label ?? event.decision.actionId,
      fallback: event.decisionSource === 'arcade-fallback',
    })
    const nextObservation = await compiledRef.current.act(
      event.decision.actionId,
    )
    browserOutcome.current.set(selected.seatId, {
      state: rawSeatState,
      actionId: event.decision.actionId,
      actedAt: Date.now(),
    })
    setBrowserObservation(nextObservation)
    setBrowserRun({
      ...current,
      step: current.step + 1,
      controllers: current.controllers.map((controller) =>
        controller.seatId === selected.seatId && event.controller
          ? {
              ...controller,
              ...event.controller,
              performance: event.performance,
            }
          : controller,
      ),
    })
    setBrowserEvents((all) => [...all, event])
    if (event.decisionSource === 'arcade-fallback')
      setNotice(
        'Commons was temporarily unavailable for that move. Arcade applied a legal fallback and kept the agents playing.',
      )
  }
  async function browserHumanDecision(
    controller: BrowserController,
    actionId: string,
  ) {
    if (!browserRun || !compiledRef.current)
      throw new Error('Start or resume a session first.')
    const observation = await compiledRef.current.observe()
    const actions = actionsForSeat(observation.actions, controller.seatId)
    if (!actions.some((action) => action.id === actionId))
      throw new Error('That action is no longer available. Choose again.')
    const event = await arcade<BrowserEvent>(
      `studio/browser-runs/${browserRun.id}/decide`,
      {
        step: browserRun.step,
        seatId: controller.seatId,
        observation: {
          state: stateForSeat(observation.state, controller.seatId),
          actions,
        },
        actionId,
      },
    )
    const chosen = actions.find((action) => action.id === actionId)
    setBrowserAction({
      seat: controller.label,
      action: chosen?.label ?? actionId,
      fallback: false,
    })
    const nextObservation = await compiledRef.current.act(
      event.decision.actionId,
    )
    const nextRun = { ...browserRun, step: browserRun.step + 1 }
    setBrowserObservation(nextObservation)
    setBrowserRun(nextRun)
    setBrowserEvents((all) => [...all, event])
    setBrowserPlaying(
      nextRun.controllers.some(
        (candidate) =>
          candidate.kind === 'agent' &&
          actionsForSeat(nextObservation.actions, candidate.seatId).length > 0,
      ),
    )
  }
  async function saveInteractionRecording(recording: CanvasRecording) {
    if (!project || dirty) {
      setError(
        'Save source changes before recording. This recording is available as a local download.',
      )
      return
    }
    try {
      await storeRecording(
        project.id,
        project.revision,
        recording,
        shareRecordings,
      )
      setRecordingsRefresh((r) => r + 1)
      setNotice(
        shareRecordings
          ? 'Recording saved and shared with spectators.'
          : 'Private recording saved.',
      )
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Could not store recording. Download remains available.',
      )
    }
  }
  const identity = useArcadeIdentity()
  const [zoom, setZoom] = useState(1)
  const [user, setUser] = useState<{ id: string; name: string } | null>(null)
  const [project, setProject] = useState<StudioProject>()
  const [collaboratorId, setCollaboratorId] = useState('')
  const [collaboratorPermission, setCollaboratorPermission] = useState<
    'test' | 'comment' | 'edit'
  >('test')
  const [projects, setProjects] = useState<StudioProject[]>([])
  const [document, setDocument] = useState<GameDocument>(emptyBrowserDocument)
  const [source, setSource] = useState(
    JSON.stringify(emptyBrowserDocument, null, 2),
  )
  const [view, setView] = useState<'preview' | 'code' | 'test'>('preview')
  const [right, setRight] = useState<'copilot' | 'notes' | 'history'>('copilot')
  const [elapsed, setElapsed] = useState(0)
  const [pendingPrompt, setPendingPrompt] = useState('')
  const [leftOpen, setLeftOpen] = useState(true),
    [rightOpen, setRightOpen] = useState(true)
  const [tool, setTool] = useState<'select' | 'point' | 'region'>('select')
  const [draft, setDraft] = useState<AnnotationGeometry>(),
    [note, setNote] = useState('')
  const [agents, setAgents] = useState<Agent[]>([]),
    [copilotId, setCopilotId] = useState('')
  const [prompt, setPrompt] = useState('')
  const [messages, setMessages] = useState<
    {
      role: 'user' | 'assistant'
      text: string
      sessionId?: string
      durationSeconds?: number
      activities?: CopilotActivity[]
    }[]
  >([])
  const [copilotActivity, setCopilotActivity] = useState<CopilotActivity[]>([])
  const [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('')
  const [run, setRun] = useState<Run>(),
    [playing, setPlaying] = useState(false),
    [seed, setSeed] = useState('studio-42')
  const [selected, setSelected] = useState<Log>(),
    [logFilter, setLogFilter] = useState('all')
  const [history, setHistory] = useState<StudioProject[]>([]),
    [previewKey, setPreviewKey] = useState(0)
  const [selectedAgents, setSelectedAgents] = useState<[string, string]>([
    '',
    '',
  ])
  const file = useRef<HTMLInputElement>(null)
  const dirty = project
    ? JSON.stringify(project.document) !== JSON.stringify(document) ||
      (!isBrowserGame(document) &&
        view === 'code' &&
        source !== JSON.stringify(document, null, 2))
    : false
  const isOwner = Boolean(user && project?.ownerId === user.id)
  const myPermissions =
    project?.collaborators?.find((member) => member.actorId === user?.id)
      ?.permissions ?? []
  const canEdit =
    project === undefined || isOwner || myPermissions.includes('edit')
  const load = useCallback(
    (p: StudioProject) => {
      setProject(p)
      setDocument(p.document)
      setSource(JSON.stringify(p.document, null, 2))
      setRun(undefined)
      setBrowserRun(undefined)
      setBrowserRuns([])
      setBrowserEvents([])
      browserOutcome.current.clear()
      setBrowserObservation(undefined)
      setBrowserControllers(defaultBrowserControllers(p.document))
      setBrowserPlaying(false)
      setPlaying(false)
      setMessages([])
      setCopilotActivity([])
      setDraft(undefined)
      window.history.replaceState(null, '', `/studio/${p.id}`)
    },
    [defaultBrowserControllers],
  )
  useEffect(() => {
    let active = true
    void fetch('/api/auth/session')
      .then((r) => r.json())
      .then(async (s) => {
        if (!active) return
        setUser(s.user)
        if (!s.user) return
        const [p, result] = await Promise.all([
          arcade<StudioProject>(`projects/${projectId}`),
          arcade<{ projects: StudioProject[] }>('projects'),
        ])
        if (!active) return
        setProjects(result.projects)
        load(p)
        if (isBrowserGame(p.document))
          void arcade<{ runs: BrowserRun[] }>(
            `projects/${projectId}/browser-runs`,
          ).then(({ runs }) => {
            if (active) setBrowserRuns(runs)
          })
        const initial = sessionStorage.getItem(`arcade-prompt:${projectId}`)
        if (initial) {
          sessionStorage.removeItem(`arcade-prompt:${projectId}`)
          // The build was asked for on the home page; run it here so the
          // creator watches it happen in the workspace it belongs to.
          setPendingPrompt(initial)
        }
      })
      .catch((e) => {
        if (active) setError(e.message)
      })
    return () => {
      active = false
    }
  }, [load, projectId])
  useEffect(() => {
    setAgents(identity.agents)
    if (identity.copilotId) setCopilotId(identity.copilotId)
  }, [identity.agents, identity.copilotId])
  useEffect(() => {
    if (!project || !copilotId) return
    let active = true
    void arcade<{
      messages?: { role: 'user' | 'assistant'; text: string }[]
    }>(
      `projects/${project.id}/copilot-session?agentId=${encodeURIComponent(copilotId)}`,
    )
      .then((session) => {
        if (active) setMessages(session.messages ?? [])
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [project?.id, copilotId])
  useEffect(() => {
    const changed = () =>
      setFullscreen(globalThis.document.fullscreenElement !== null)
    globalThis.document.addEventListener('fullscreenchange', changed)
    return () =>
      globalThis.document.removeEventListener('fullscreenchange', changed)
  }, [])
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  async function task(name: string, fn: () => Promise<void>) {
    setBusy(name)
    setError('')
    setNotice('')
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPlaying(false)
      setBrowserPlaying(false)
    } finally {
      setBusy('')
    }
  }
  async function save(
    next = view === 'code' && !isBrowserGame(document)
      ? gameDocumentSchema.parse(JSON.parse(source))
      : document,
  ) {
    gameDocumentSchema.parse(next)
    const p = project
      ? await arcade<StudioProject>(`projects/${project.id}`, next, 'PUT', {
          'If-Match': String(project.revision),
        })
      : await arcade<StudioProject>('projects', { document: next })
    setProject(p)
    setDocument(p.document)
    setSource(JSON.stringify(p.document, null, 2))
    setProjects((all) => [p, ...all.filter((x) => x.id !== p.id)])
    window.history.replaceState(null, '', `/studio/${p.id}`)
    return p
  }
  async function setCollaborators(
    collaborators: NonNullable<StudioProject['collaborators']>,
  ) {
    if (!project) return
    const next = await arcade<StudioProject>(
      `projects/${project.id}/collaborators`,
      { collaborators },
      'PUT',
    )
    setProject(next)
    setProjects((all) => [next, ...all.filter((item) => item.id !== next.id)])
  }
  function update(patch: Partial<GameDocument>) {
    setPlaying(false)
    setDocument((d) => {
      const next = { ...d, ...patch } as GameDocument
      setSource(JSON.stringify(next, null, 2))
      return next
    })
  }
  async function ensureAgent(role: 'copilot' | 'player', name: string) {
    const a = await arcade<Agent>('commons/agents', { role, name })
    setAgents((all) => [...all, a])
    return a.agentId
  }
  async function startBrowserRun(): Promise<BrowserRun> {
    const p = !project || dirty ? await save() : project
    if (!isBrowserGame(p.document))
      throw new Error('Browser playtests require a browser game.')
    if (!compiledRef.current)
      throw new Error('Open Preview before starting a playtest.')
    const initialObservation = await waitForPreview(compiledRef)
    const declaredSeats = seatsFromObservation(initialObservation)
    if (
      declaredSeats.length > 0 &&
      declaredSeats.length < browserControllers.length
    )
      throw new Error(
        `The game bridge exposes ${declaredSeats.length} seats, but ${browserControllers.length} players are configured.`,
      )
    const configuredControllers = browserControllers.map((controller, index) =>
      declaredSeats[index]
        ? {
            ...controller,
            seatId: declaredSeats[index]!.id,
            label: declaredSeats[index]!.label,
          }
        : controller,
    )
    const controllers = await Promise.all(
      configuredControllers.map(async (controller) =>
        controller.kind === 'agent' && !controller.agentId
          ? {
              ...controller,
              agentId: await ensureAgent(
                'player',
                `${p.document.title} · ${controller.label}`,
              ),
            }
          : controller,
      ),
    )
    setBrowserControllers(controllers)
    const created = await arcade<BrowserRun>(`projects/${p.id}/browser-runs`, {
      controllers,
    })
    setBrowserRun(created)
    setBrowserRuns((runs) => [created, ...runs])
    setBrowserEvents([])
    browserOutcome.current.clear()
    setBrowserObservation(initialObservation)
    setLogsOpen(true)
    setBrowserPlaying(
      Boolean(
        created.controllers.some(
          (controller) =>
            controller.kind === 'agent' &&
            actionsForSeat(initialObservation.actions, controller.seatId)
              .length > 0,
        ),
      ),
    )
    setNotice(
      bridgeFromObservation(initialObservation) === 'dom-fallback'
        ? 'Session started in compatibility mode. Arcade assigned visible control groups to each seat; ask the copilot to add a semantic agent bridge for richer strategy.'
        : 'Private Test Arena session started. Human moves use the legal-action controls so the session stays resumable.',
    )
    return created
  }
  async function resumeBrowserRun(summary: BrowserRun) {
    const saved = await arcade<BrowserRun & { events: BrowserEvent[] }>(
      `studio/browser-runs/${summary.id}`,
    )
    if (!project || saved.revision !== project.revision)
      throw new Error(
        `This session belongs to revision ${saved.revision}. Restore that revision before resuming it.`,
      )
    setBrowserRun(saved)
    setBrowserControllers(saved.controllers)
    setBrowserEvents(saved.events ?? [])
    setBrowserPlaying(false)
    setPreviewKey((key) => key + 1)
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    )
    await waitForPreview(compiledRef)
    for (const event of [...(saved.events ?? [])].sort(
      (a, b) => a.step - b.step,
    ))
      await compiledRef.current?.act(event.decision.actionId)
    setBrowserObservation(await compiledRef.current?.observe())
    setNotice(`Resumed session ${saved.id.slice(-8)} at action ${saved.step}.`)
  }
  async function updateBrowserStrategy(
    controller: BrowserController,
    strategy: string,
  ) {
    if (!browserRun) throw new Error('Start or resume a session first.')
    const result = await arcade<{ controller: BrowserController }>(
      `studio/browser-runs/${browserRun.id}/controllers/${encodeURIComponent(controller.seatId)}/strategy`,
      { prompt: strategy },
    )
    setBrowserRun((run) =>
      run
        ? {
            ...run,
            controllers: run.controllers.map((candidate) =>
              candidate.seatId === controller.seatId
                ? result.controller
                : candidate,
            ),
          }
        : run,
    )
    setBrowserControllers((controllers) =>
      controllers.map((candidate) =>
        candidate.seatId === controller.seatId ? result.controller : candidate,
      ),
    )
    setNotice(
      `${controller.label} will use strategy epoch ${result.controller.strategyEpoch} on its next decision.`,
    )
  }
  async function startRun() {
    const p = !project || dirty ? await save() : project
    const ids: [string, string] = [...selectedAgents]
    for (const i of [0, 1] as const)
      if (!ids[i])
        ids[i] = await ensureAgent(
          'player',
          `${p.document.title} · Player ${i + 1}`,
        )
    setSelectedAgents(ids)
    const r = await arcade<Run>(`projects/${p.id}/runs`, { seed, agents: ids })
    setRun(r)
    setView('test')
    setPlaying(true)
    setLogsOpen(true)
    setSelected(undefined)
  }
  async function stepRun() {
    if (!run) return
    setRun(
      await arcade<Run>(`studio/runs/${run.runId}/step`, { steps: run.steps }),
    )
  }
  useEffect(() => {
    if (!playing || busy || !run || run.status !== 'running') return
    const timer = setTimeout(() => {
      void task('step', stepRun)
    }, 750)
    return () => clearTimeout(timer)
  }, [playing, busy, run])
  const runBrowserDecision = useCallback(async () => {
    if (browserDecisionActive.current) return
    browserDecisionActive.current = true
    setBrowserDeciding(true)
    setError('')
    try {
      await browserDecision()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setBrowserPlaying(false)
    } finally {
      browserDecisionActive.current = false
      setBrowserDeciding(false)
    }
  }, [browserRun, project, dirty, document, browserControllers])
  useEffect(() => {
    if (
      !browserPlaying ||
      browserDeciding ||
      !browserRun ||
      browserRun.step >= 200
    )
      return
    const decisionsPerSecond = isBrowserGame(document)
      ? (document.play?.maxDecisionsPerSecond ?? 2)
      : 2
    const timer = setTimeout(
      () => {
        void runBrowserDecision()
      },
      Math.max(50, Math.ceil(1000 / decisionsPerSecond)),
    )
    return () => clearTimeout(timer)
  }, [
    browserPlaying,
    browserDeciding,
    browserRun?.step,
    document,
    runBrowserDecision,
  ])
  const board = run?.replay.checkpoints.at(-1)?.state as
    { board?: (string | null)[] } | undefined
  const previewDocument = view === 'test' && run ? run.document : document
  const compiled = useMemo(() => {
    try {
      return {
        html: compilePresentation(
          previewDocument,
          view === 'test' ? board : undefined,
          view !== 'test',
        ),
      }
    } catch (error) {
      return {
        error:
          error instanceof Error
            ? error.message
            : 'The source could not compile.',
      }
    }
  }, [previewDocument, view, board])
  const logs = (run?.diagnostics ?? []) as unknown as Log[]
  const visibleNotes =
    project?.annotations.filter(
      (a) =>
        a.revision ===
        (view === 'test' && run ? run.revision : project.revision),
    ) ?? []
  /** One raw user turn runs in a durable Commons session. Arcade project
   * changes arrive through tool calls and are already authoritative revisions. */
  const runCopilot = useCallback(
    async (
      message: string,
      attachments: { fileId: string }[] = [],
      model?: { provider: string; modelId: string },
    ) =>
      task('copilot', async () => {
        const p = !project || dirty ? await save() : project
        setMessages((m) => [...m, { role: 'user', text: message }])
        setCopilotActivity([])
        const result = await arcadeCopilot(
          p.id,
          { message, agentId: copilotId, attachments, model },
          { onWait: setElapsed, onUpdate: setCopilotActivity },
        )
        setElapsed(0)
        const latest = await arcade<StudioProject>(`projects/${p.id}`)
        setProject(latest)
        setDocument(latest.document)
        setSource(JSON.stringify(latest.document, null, 2))
        setProjects((all) => [latest, ...all.filter((x) => x.id !== latest.id)])
        setMessages((m) => [
          ...m,
          {
            role: 'assistant',
            text: result.response,
            sessionId: result.sessionId,
            durationSeconds: result.durationSeconds,
            activities: result.events,
          },
        ])
        setCopilotActivity([])
        setView('preview')
        setPreviewKey((key) => key + 1)
        setNotice(
          latest.revision > p.revision
            ? `Copilot saved revision ${latest.revision}.`
            : 'Copilot finished without changing the project.',
        )
      }),
    [project, dirty, copilotId],
  )
  useEffect(() => {
    if (!pendingPrompt || !project || !copilotId || busy) return
    const message = pendingPrompt
    setPendingPrompt('')
    void runCopilot(message)
  }, [pendingPrompt, project, copilotId, busy, runCopilot])
  const title = project?.document.title ?? 'New game'
  const liveReadiness = useMemo(() => assessLiveReadiness(document), [document])
  const sourceSize = useMemo(() => {
    if (!isBrowserGame(document)) return ''
    const bytes = document.files.reduce(
      (total, file) => total + new TextEncoder().encode(file.content).length,
      0,
    )
    return bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024)} KB`
  }, [document])
  const icon = (
    node: React.ReactNode,
    label: string,
    action: () => void,
    active = false,
  ) => (
    <CanvasToolButton label={label} active={active} onClick={action}>
      {node}
    </CanvasToolButton>
  )
  return (
    <CanvasShell
      toolbar={
        <>
          <Link
            href="/discover"
            className="studio-back"
            aria-label="Back to Arcade"
          >
            <ArrowLeft size={16} />
          </Link>
          <span className="studio-divider" />
          <Gamepad2 size={18} />
          <span className="studio-project-title">{title}</span>
          <span className="studio-saved">
            {busy ? (
              <Loader2 size={12} className="spin" />
            ) : dirty ? (
              '•'
            ) : (
              <Check size={12} />
            )}{' '}
            {busy
              ? busy === 'copilot'
                ? 'Copilot is working'
                : 'Working'
              : dirty
                ? 'Unsaved changes'
                : project
                  ? `Revision ${project.revision}`
                  : 'Draft preview'}
          </span>
          <span
            className={`studio-live-readiness ${liveReadiness.liveReady ? 'is-ready' : 'is-preview'}`}
            title={liveReadiness.blockers.join(' ')}
          >
            {liveReadiness.liveReady ? 'Live-ready' : 'Preview only'}
          </span>
          {!liveReadiness.liveReady ? (
            <Button
              className="studio-make-live"
              disabled={!!busy || !canEdit || !copilotId}
              title={
                !canEdit
                  ? 'You need edit permission to change this game.'
                  : !copilotId
                    ? 'Connect a Commons agent to use Arcade Copilot.'
                    : 'Preserve this game and add a tested authoritative live runtime.'
              }
              onClick={() => {
                setRight('copilot')
                setRightOpen(true)
                void runCopilot(MAKE_LIVE_READY_PROMPT)
              }}
            >
              <Radio size={13} />
              Make live-ready
            </Button>
          ) : null}
          <div className="studio-toolbar-end">
            {user ? (
              <>
                {canEdit ? (
                  <Button
                    disabled={!!busy}
                    onClick={() =>
                      void task('save', async () => {
                        await save()
                        setNotice('Revision saved.')
                      })
                    }
                  >
                    <Save size={14} />
                    Save
                  </Button>
                ) : null}
                {isOwner ? (
                  <Button
                    disabled={!!busy}
                    onClick={() =>
                      void task('publish', async () => {
                        const p = !project || dirty ? await save() : project
                        const release = await arcade<StudioRelease>(
                          `projects/${p.id}/publish`,
                          {},
                          'POST',
                          { 'If-Match': String(p.revision) },
                        )
                        setProject({ ...p, releaseId: release.id })
                        setNotice('Published. Your game is now in the Arcade.')
                      })
                    }
                    variant="primary"
                  >
                    <Upload size={14} />
                    Publish
                  </Button>
                ) : null}
              </>
            ) : (
              <a
                className="ac-button ac-button-primary"
                href="/api/auth/login?next=/studio"
              >
                Sign in to create
              </a>
            )}
            <AccountMenu
              user={user}
              beforeSignOut={async () => {
                if (dirty) await save()
              }}
            />
            {icon(
              <PanelRightClose size={16} />,
              'Toggle assistant panel',
              () => setRightOpen(!rightOpen),
              rightOpen,
            )}
          </div>
        </>
      }
      left={
        leftOpen && (
          <>
            <div className="studio-panel-heading">
              <span>Workspace</span>
              {icon(
                <PanelLeftClose size={14} />,
                'Collapse project panel',
                () => setLeftOpen(false),
              )}
            </div>
            <div className="studio-section">
              <div className="studio-section-label">
                <Share2 size={13} />
                Publishing & remixes
              </div>
              <label>
                License
                <select
                  value={
                    document.distribution?.license ??
                    defaultGameDistribution.license
                  }
                  onChange={(event) =>
                    update({
                      distribution: {
                        ...(document.distribution ?? defaultGameDistribution),
                        license: event.target.value as
                          | 'all-rights-reserved'
                          | 'cc-by-4.0'
                          | 'cc-by-sa-4.0'
                          | 'cc0-1.0',
                      },
                    })
                  }
                >
                  <option value="all-rights-reserved">
                    All rights reserved
                  </option>
                  <option value="cc-by-4.0">CC BY 4.0</option>
                  <option value="cc-by-sa-4.0">CC BY-SA 4.0</option>
                  <option value="cc0-1.0">CC0 1.0</option>
                </select>
              </label>
              <label>
                Remixing
                <select
                  value={
                    document.distribution?.remixing ??
                    defaultGameDistribution.remixing
                  }
                  onChange={(event) =>
                    update({
                      distribution: {
                        ...(document.distribution ?? defaultGameDistribution),
                        remixing: event.target.value as 'disabled' | 'allowed',
                      },
                    })
                  }
                >
                  <option value="disabled">Disabled</option>
                  <option value="allowed">Allow attributed remixes</option>
                </select>
              </label>
              <label>
                Future creator share
                <select
                  value={
                    document.distribution?.revenueShareBps ??
                    defaultGameDistribution.revenueShareBps
                  }
                  onChange={(event) =>
                    update({
                      distribution: {
                        ...(document.distribution ?? defaultGameDistribution),
                        revenueShareBps: Number(event.target.value),
                      },
                    })
                  }
                >
                  {[0, 500, 1000, 2000, 3000, 5000].map((bps) => (
                    <option key={bps} value={bps}>
                      {bps / 100}%
                    </option>
                  ))}
                </select>
              </label>
              <p className="studio-help">
                Remixes are isolated projects with immutable source attribution.
                Creator-share terms are recorded now; settlement is not active.
              </p>
            </div>
            {project && isOwner ? (
              <div className="studio-section">
                <div className="studio-section-label">
                  <Users size={13} />
                  Team access
                </div>
                <label>
                  Commons user ID
                  <input
                    value={collaboratorId}
                    onChange={(event) => setCollaboratorId(event.target.value)}
                    placeholder="user_…"
                  />
                </label>
                <label>
                  Permission
                  <select
                    value={collaboratorPermission}
                    onChange={(event) =>
                      setCollaboratorPermission(
                        event.target.value as typeof collaboratorPermission,
                      )
                    }
                  >
                    <option value="test">Can test</option>
                    <option value="comment">Can comment</option>
                    <option value="edit">Can edit</option>
                  </select>
                </label>
                <button
                  className="studio-access-add"
                  disabled={!collaboratorId.trim() || !!busy}
                  onClick={() =>
                    void task('access', async () => {
                      const actorId = collaboratorId.trim()
                      const current = project.collaborators ?? []
                      await setCollaborators([
                        ...current.filter(
                          (member) => member.actorId !== actorId,
                        ),
                        { actorId, permissions: [collaboratorPermission] },
                      ])
                      setCollaboratorId('')
                      setNotice('Team access updated.')
                    })
                  }
                >
                  Add team member
                </button>
                <div className="studio-access-list">
                  {(project.collaborators ?? []).map((member) => (
                    <div key={member.actorId}>
                      <span>
                        <strong>{member.actorId}</strong>
                        <small>{member.permissions.join(', ')}</small>
                      </span>
                      <button
                        aria-label={`Remove ${member.actorId}`}
                        onClick={() =>
                          void task('access', async () => {
                            await setCollaborators(
                              (project.collaborators ?? []).filter(
                                (candidate) =>
                                  candidate.actorId !== member.actorId,
                              ),
                            )
                            setNotice('Team member removed.')
                          })
                        }
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : project ? (
              <div className="studio-section">
                <div className="studio-section-label">
                  <Users size={13} /> Shared workspace
                </div>
                <p className="studio-help">
                  Your access: {myPermissions.join(', ') || 'view only'}. Only
                  the owner can publish or change team permissions.
                </p>
              </div>
            ) : null}
            <div className="studio-project-switch">
              <Folder size={14} />
              <select
                aria-label="Open project"
                value={project?.id ?? ''}
                disabled={!!busy || dirty}
                onChange={(e) => {
                  const p = projects.find((p) => p.id === e.target.value)
                  if (p) router.push(`/studio/${p.id}`)
                }}
              >
                <option value="">New game</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.document.title}
                  </option>
                ))}
              </select>
              <button
                aria-label="Create new game"
                disabled={!user || !!busy || dirty}
                onClick={() => {
                  router.push('/studio')
                }}
              >
                <Plus size={14} />
              </button>
            </div>
            <div className="studio-section">
              <div className="studio-section-label">
                <Settings2 size={13} />
                Game properties
              </div>
              <label>
                Name
                <input
                  value={document.title}
                  maxLength={100}
                  onChange={(e) => update({ title: e.target.value })}
                />
              </label>
              <label>
                Description
                <textarea
                  rows={3}
                  maxLength={1000}
                  value={document.description}
                  onChange={(e) => update({ description: e.target.value })}
                />
              </label>
              {!isBrowserGame(document) && (
                <>
                  {' '}
                  <div className="studio-field-pair">
                    <label>
                      Board
                      <select
                        value={document.boardSize}
                        onChange={(e) => {
                          const n = Number(e.target.value)
                          update({
                            boardSize: n,
                            winLength: Math.min(
                              n,
                              !isBrowserGame(document) ? document.winLength : 3,
                            ),
                          })
                        }}
                      >
                        {[3, 4, 5, 6, 7, 8].map((n) => (
                          <option key={n} value={n}>
                            {n} × {n}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      In a row
                      <select
                        value={document.winLength}
                        onChange={(e) =>
                          update({ winLength: Number(e.target.value) })
                        }
                      >
                        {Array.from(
                          { length: document.boardSize - 2 },
                          (_, i) => i + 3,
                        ).map((n) => (
                          <option key={n}>{n}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="studio-field-pair">
                    {[0, 1].map((i) => (
                      <label key={i}>
                        Player {i + 1}
                        <input
                          value={
                            !isBrowserGame(document) ? document.marks[i] : ''
                          }
                          maxLength={3}
                          onChange={(e) => {
                            const marks: [string, string] = [
                              ...(!isBrowserGame(document)
                                ? document.marks
                                : (['X', 'O'] as [string, string])),
                            ]
                            marks[i] = e.target.value || (i === 0 ? 'X' : 'O')
                            update({ marks })
                          }}
                        />
                      </label>
                    ))}
                  </div>
                  <div className="studio-field-pair">
                    <label>
                      Accent
                      <input
                        type="color"
                        value={document.accent}
                        onChange={(e) => update({ accent: e.target.value })}
                      />
                    </label>
                    <label>
                      Canvas
                      <input
                        type="color"
                        value={document.background}
                        onChange={(e) => update({ background: e.target.value })}
                      />
                    </label>
                  </div>
                </>
              )}
              {isBrowserGame(document) && (
                <p className="studio-help">
                  {document.files.length} source files · Browser game
                  <br />
                  Edit every file in Code, or describe a change to your agent.
                </p>
              )}
            </div>
            {!isBrowserGame(document) && (
              <>
                {' '}
                <div className="studio-section">
                  <div className="studio-section-label">
                    <Bot size={13} />
                    Test players
                  </div>
                  {[0, 1].map((i) => (
                    <label key={i}>
                      Seat {i + 1}
                      <select
                        value={selectedAgents[i]}
                        onChange={(e) =>
                          setSelectedAgents((ids) => {
                            const next: [string, string] = [...ids]
                            next[i] = e.target.value
                            return next
                          })
                        }
                      >
                        <option value="">Create a Commons agent</option>
                        {agents.map((a) => (
                          <option key={a.agentId} value={a.agentId}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                  <label>
                    Scenario seed
                    <input
                      value={seed}
                      onChange={(e) => setSeed(e.target.value)}
                      maxLength={200}
                    />
                  </label>
                  <p className="studio-help">
                    Commons agents choose a bounded play policy. Every move uses
                    the same game rules.
                  </p>
                </div>
              </>
            )}
            {isBrowserGame(document) && (
              <div className="studio-section">
                <div className="studio-section-label">
                  <Bot size={13} />
                  Test Arena seats
                </div>
                <label>
                  Players
                  <select
                    value={browserControllers.length}
                    disabled={!!browserRun}
                    onChange={(event) => {
                      const count = Number(event.target.value)
                      setBrowserControllers((current) =>
                        Array.from(
                          { length: count },
                          (_, index) =>
                            current[index] ?? {
                              seatId: `seat-${index + 1}`,
                              label: `Player ${index + 1}`,
                              kind: 'agent',
                              strategy:
                                'Play to win, adapt to the opponent, and use only legal actions.',
                            },
                        ),
                      )
                    }}
                  >
                    {Array.from(
                      {
                        length:
                          (document.play?.seats.max ?? 8) -
                          (document.play?.seats.min ?? 1) +
                          1,
                      },
                      (_, index) => (document.play?.seats.min ?? 1) + index,
                    ).map((count) => (
                      <option value={count} key={count}>
                        {count}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="studio-controller-list">
                  {browserControllers.map((controller, index) => (
                    <div className="studio-controller" key={controller.seatId}>
                      <div>
                        <strong>{controller.label}</strong>
                        {controller.strategyEpoch ? (
                          <small>Strategy {controller.strategyEpoch}</small>
                        ) : null}
                      </div>
                      {controller.performance ? (
                        <div className="studio-learning-summary">
                          <span>
                            {controller.performance.improving ? '↗' : '→'}{' '}
                            {controller.performance.feedbackSamples} feedback
                            samples
                          </span>
                          <span>
                            reward{' '}
                            {controller.performance.cumulativeReward >= 0
                              ? '+'
                              : ''}
                            {controller.performance.cumulativeReward.toFixed(1)}
                          </span>
                        </div>
                      ) : null}
                      {controller.policyMemory?.preferredDefense ? (
                        <small className="studio-learned-policy">
                          Learned defense:{' '}
                          {controller.policyMemory.preferredDefense}
                        </small>
                      ) : null}
                      <select
                        aria-label={`${controller.label} controller`}
                        value={controller.kind}
                        disabled={!!browserRun}
                        onChange={(event) =>
                          setBrowserControllers((current) =>
                            current.map((candidate, candidateIndex) =>
                              candidateIndex === index
                                ? {
                                    ...candidate,
                                    kind: event.target.value as
                                      'human' | 'agent',
                                    agentId: undefined,
                                    strategy:
                                      event.target.value === 'human'
                                        ? 'Human controlled.'
                                        : 'Play to win, adapt to the opponent, and use only legal actions.',
                                  }
                                : candidate,
                            ),
                          )
                        }
                      >
                        <option value="human">Human</option>
                        <option value="agent">Agent</option>
                      </select>
                      {controller.kind === 'agent' ? (
                        <>
                          <select
                            aria-label={`${controller.label} agent`}
                            value={controller.agentId ?? ''}
                            disabled={!!browserRun}
                            onChange={(event) =>
                              setBrowserControllers((current) =>
                                current.map((candidate, candidateIndex) =>
                                  candidateIndex === index
                                    ? {
                                        ...candidate,
                                        agentId:
                                          event.target.value || undefined,
                                      }
                                    : candidate,
                                ),
                              )
                            }
                          >
                            <option value="">Create a player agent</option>
                            {agents.map((agent) => (
                              <option value={agent.agentId} key={agent.agentId}>
                                {agent.name}
                              </option>
                            ))}
                          </select>
                          <textarea
                            rows={2}
                            aria-label={`${controller.label} strategy`}
                            value={controller.strategy}
                            onChange={(event) =>
                              setBrowserControllers((current) =>
                                current.map((candidate, candidateIndex) =>
                                  candidateIndex === index
                                    ? {
                                        ...candidate,
                                        strategy: event.target.value,
                                      }
                                    : candidate,
                                ),
                              )
                            }
                          />
                          {browserRun ? (
                            <Button
                              variant="ghost"
                              disabled={!!busy || !controller.strategy.trim()}
                              onClick={() =>
                                void task('strategy update', () =>
                                  updateBrowserStrategy(
                                    controller,
                                    controller.strategy,
                                  ),
                                )
                              }
                            >
                              Coach next move
                            </Button>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  ))}
                </div>
                {browserRun && browserObservation
                  ? browserRun.controllers.map((controller) => {
                      if (controller.kind !== 'human') return null
                      const actions = actionsForSeat(
                        browserObservation.actions,
                        controller.seatId,
                      )
                      if (!actions.length) return null
                      return (
                        <div
                          className="studio-human-actions"
                          key={`actions:${controller.seatId}`}
                        >
                          <strong>{controller.label}&apos;s turn</strong>
                          <div>
                            {actions.map((action) => (
                              <Button
                                key={action.id}
                                variant="ghost"
                                disabled={!!busy || browserPlaying}
                                onClick={() =>
                                  void task('human move', () =>
                                    browserHumanDecision(controller, action.id),
                                  )
                                }
                              >
                                {action.label}
                              </Button>
                            ))}
                          </div>
                        </div>
                      )
                    })
                  : null}
                {!browserRun ? (
                  <Button
                    disabled={!!busy || !user || dirty || view !== 'preview'}
                    onClick={() =>
                      void task('start playtest', async () => {
                        await startBrowserRun()
                      })
                    }
                  >
                    <Play size={13} /> Start session
                  </Button>
                ) : (
                  <div className="studio-controller-actions">
                    <Button
                      disabled={browserRun.step >= 200}
                      onClick={() => setBrowserPlaying((active) => !active)}
                    >
                      {browserPlaying ? (
                        <Pause size={13} />
                      ) : browserDeciding ? (
                        <Loader2 size={13} className="spin" />
                      ) : (
                        <Play size={13} />
                      )}
                      {browserPlaying
                        ? browserDeciding
                          ? 'Stop after this move'
                          : 'Pause agents'
                        : browserDeciding
                          ? 'Stopping…'
                          : 'Run agents'}
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={
                        !!busy ||
                        browserDeciding ||
                        browserPlaying ||
                        browserRun.step >= 200
                      }
                      onClick={() => void runBrowserDecision()}
                    >
                      <SkipForward size={13} /> One decision
                    </Button>
                  </div>
                )}
                {browserRun && (
                  <Button
                    variant="ghost"
                    disabled={browserDeciding}
                    onClick={() => {
                      setBrowserPlaying(false)
                      setBrowserRun(undefined)
                      setBrowserEvents([])
                      setBrowserObservation(undefined)
                      setBrowserAction(undefined)
                      setBrowserControllers(defaultBrowserControllers(document))
                    }}
                  >
                    New session
                  </Button>
                )}
                <p className="studio-help">
                  Private, unrated and not prize eligible. Human controls stay
                  in this panel so every move can be resumed; agents act
                  autonomously from the same legal browser observations.{' '}
                  {browserRun?.step ?? 0} / 200 decisions.
                </p>
                {browserRuns.length ? (
                  <label>
                    Resume session
                    <select
                      value={browserRun?.id ?? ''}
                      disabled={!!busy}
                      onChange={(event) => {
                        const selected = browserRuns.find(
                          (run) => run.id === event.target.value,
                        )
                        if (selected)
                          void task('resume playtest', () =>
                            resumeBrowserRun(selected),
                          )
                      }}
                    >
                      <option value="">Choose a prior session</option>
                      {browserRuns.map((run) => (
                        <option key={run.id} value={run.id}>
                          {new Date(run.createdAt).toLocaleString()} ·{' '}
                          {run.step} moves
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>
            )}
            {project && (
              <div className="studio-section">
                <label className="studio-help">
                  <input
                    type="checkbox"
                    checked={shareRecordings}
                    onChange={(e) => setShareRecordings(e.target.checked)}
                  />
                  Share new recordings with spectators
                </label>
                <RecordingShelf
                  projectId={project.id}
                  refresh={recordingsRefresh}
                  annotations={project.annotations}
                  onAnnotate={async (
                    recordingId,
                    timeMs,
                    revision,
                    geometry,
                    body,
                  ) => {
                    const updated = await arcade<StudioProject>(
                      `projects/${project.id}/annotations`,
                      {
                        ...geometry,
                        body,
                        revision,
                        context: {
                          viewport: { width: 1280, height: 720 },
                          moment: { recordingId, timeMs },
                        },
                      },
                    )
                    setProject(updated)
                    setNotice(
                      `Annotation saved at ${(timeMs / 1000).toFixed(1)}s.`,
                    )
                  }}
                />
              </div>
            )}
            <div className="studio-section">
              <Button onClick={() => file.current?.click()}>
                <Code2 size={13} />
                Import game JSON
              </Button>
              <input
                type="file"
                ref={file}
                accept="application/json,.json"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f)
                    void task('import', async () => {
                      const d = gameDocumentSchema.parse(
                        JSON.parse(await f.text()),
                      )
                      update(d)
                      setView('preview')
                    })
                  e.target.value = ''
                }}
              />
              <p className="studio-help">
                <Link href="/docs">Authoring contract ↗</Link>
              </p>
            </div>
          </>
        )
      }
      right={
        rightOpen && (
          <>
            <div className="studio-tabs">
              <button
                onClick={() => setRight('copilot')}
                className={right === 'copilot' ? 'is-active' : ''}
              >
                <Sparkles size={13} />
                Copilot
              </button>
              <button
                onClick={() => setRight('notes')}
                className={right === 'notes' ? 'is-active' : ''}
              >
                <MessageSquare size={13} />
                Notes {visibleNotes.length || ''}
              </button>
              <button
                aria-label="Revision history"
                title="Revision history"
                onClick={() => {
                  setRight('history')
                  if (project)
                    void task('history', async () =>
                      setHistory(
                        (
                          await arcade<{ revisions: StudioProject[] }>(
                            `projects/${project.id}/revisions`,
                          )
                        ).revisions,
                      ),
                    )
                }}
                className={right === 'history' ? 'is-active' : ''}
              >
                <History size={14} />
              </button>
            </div>
            {right === 'copilot' ? (
              <div className="studio-copilot">
                <div className="studio-agent-heading">
                  <span className="studio-avatar">
                    <Sparkles size={17} />
                  </span>
                  <div>
                    <strong>Arcade Copilot</strong>
                    <small>Powered by your Commons agent</small>
                  </div>
                </div>
                <div className="studio-conversation">
                  {messages.length === 0 && (
                    <div className="studio-copilot-welcome">
                      <h2>Make something worth playing.</h2>
                      <p>
                        Describe a change, select part of the game, or bring a
                        test result into the conversation.
                      </p>
                      <button
                        onClick={() =>
                          setPrompt(
                            'Improve the controls and add clear feedback when the player scores or loses. Keep the current visual style.',
                          )
                        }
                      >
                        Improve the play experience <ArrowUp size={12} />
                      </button>
                      <button
                        onClick={() => {
                          setTool('point')
                          setRight('notes')
                        }}
                      >
                        Point to something to improve <MapPin size={12} />
                      </button>
                    </div>
                  )}
                  {messages.map((m, i) => (
                    <div key={i} className={`studio-message ${m.role}`}>
                      <small>
                        {m.role === 'user' ? 'You' : 'Arcade Copilot'}
                      </small>
                      {m.activities?.length ? (
                        <div className="studio-agent-activity">
                          <span>
                            {m.durationSeconds
                              ? `Worked for ${m.durationSeconds}s`
                              : `Used ${m.activities.length} ${m.activities.length === 1 ? 'tool' : 'tools'}`}
                          </span>
                          {m.activities.map((activity) => (
                            <div key={activity.sequence}>
                              {activity.status === 'running' ? (
                                <Loader2 size={12} className="spin" />
                              ) : (
                                <Check size={12} />
                              )}
                              <span>{activity.label}</span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                      <p>{m.text}</p>
                      {m.role === 'assistant' && m.sessionId ? (
                        <a
                          href={`https://www.agentcommons.io/studio/agents/${copilotId}`}
                          target="_blank"
                          rel="noreferrer"
                          className="studio-session-link"
                        >
                          View Commons session
                        </a>
                      ) : null}
                    </div>
                  ))}
                  {busy === 'copilot' && (
                    <div role="status">
                      <div className="studio-thinking">
                        {elapsed > 4
                          ? `Worked for ${elapsed}s`
                          : 'Arcade Copilot is working…'}
                      </div>
                      {copilotActivity.length ? (
                        <div className="studio-agent-activity is-live">
                          {copilotActivity.map((activity) => (
                            <div key={activity.sequence}>
                              {activity.status === 'running' ? (
                                <Loader2 size={12} className="spin" />
                              ) : (
                                <Check size={12} />
                              )}
                              <span>{activity.label}</span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
                <ArcadeComposer
                  value={prompt}
                  onChange={setPrompt}
                  identity={{ ...identity, agents, copilotId }}
                  onAgentChange={setCopilotId}
                  busy={!!busy}
                  context={
                    project
                      ? `Revision ${project.revision} · ${visibleNotes.length} notes attached`
                      : 'Project context'
                  }
                  onSubmit={(attachments, model) => {
                    if (!user || !prompt.trim() || !copilotId) return
                    const message = prompt
                    setPrompt('')
                    void runCopilot(message, attachments, model)
                  }}
                />
              </div>
            ) : right === 'notes' ? (
              <div className="studio-notes">
                {draft && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault()
                      void task('annotation', async () => {
                        const p = !project || dirty ? await save() : project
                        setProject(
                          await arcade<StudioProject>(
                            `projects/${p.id}/annotations`,
                            {
                              ...draft,
                              context: await annotationContext.current,
                              body: note,
                              revision: p.revision,
                              ...(view === 'test' && run
                                ? { tick: run.steps }
                                : {}),
                            },
                          ),
                        )
                        setDraft(undefined)
                        setNote('')
                        setTool('select')
                      })
                    }}
                  >
                    <strong>Note on this revision</strong>
                    <textarea
                      autoFocus
                      aria-label="Annotation text"
                      placeholder="What would you like to change?"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      rows={4}
                    />
                    <Button
                      type="submit"
                      variant="primary"
                      disabled={!user || !!busy || !note.trim()}
                    >
                      Save note
                    </Button>
                    <Button variant="ghost" onClick={() => setDraft(undefined)}>
                      Cancel
                    </Button>
                  </form>
                )}
                {project?.annotations.map((a, i) => (
                  <article
                    key={a.id}
                    className={a.status === 'resolved' ? 'resolved' : ''}
                  >
                    <span className="studio-note-number">{i + 1}</span>
                    <p>{a.body}</p>
                    <small>
                      Revision {a.revision}
                      {a.revision !== project.revision
                        ? ' · Earlier revision — review before applying'
                        : ''}
                      {a.tick !== undefined ? ` · Turn ${a.tick}` : ''}
                    </small>
                    <div>
                      <button
                        onClick={() => {
                          setPrompt(
                            `Please address this annotation from revision ${a.revision}: ${a.body}`,
                          )
                          setRight('copilot')
                        }}
                      >
                        Ask Copilot
                      </button>
                      <button
                        disabled={!!busy}
                        onClick={() =>
                          void task('annotation', async () =>
                            setProject(
                              await arcade<StudioProject>(
                                `projects/${project.id}/annotations/${a.id}`,
                                {
                                  status:
                                    a.status === 'open' ? 'resolved' : 'open',
                                },
                                'PATCH',
                              ),
                            ),
                          )
                        }
                      >
                        {a.status === 'open' ? 'Resolve' : 'Reopen'}
                      </button>
                    </div>
                  </article>
                ))}
                {!draft && !project?.annotations.length && (
                  <div className="studio-empty">
                    <MessageSquare size={24} />
                    <p>Notes stay with the revision.</p>
                    <small>
                      Choose a point or region in the preview to start a
                      conversation.
                    </small>
                    <Button onClick={() => setDraft({ x: 0.5, y: 0.5 })}>
                      Add a note
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <div className="studio-notes">
                {history.map((p) => (
                  <article key={`${p.revision}:${p.digest}`}>
                    <strong>Revision {p.revision}</strong>
                    <p>{p.document.title}</p>
                    <small>{new Date(p.updatedAt).toLocaleString()}</small>
                    <Button
                      disabled={!!busy}
                      onClick={() => {
                        update(p.document)
                        setView('preview')
                        setNotice(
                          `Previewing revision ${p.revision}. Save to create a new revision.`,
                        )
                      }}
                    >
                      Restore as draft
                    </Button>
                  </article>
                ))}
              </div>
            )}
          </>
        )
      }
      bottom={
        !logsOpen ? undefined : isBrowserGame(document) && browserRun ? (
          <div className="studio-browser-events">
            <div className="studio-browser-events-heading">
              <strong>
                Browser Test Arena · {browserRun.controllers.length} seats ·
                private / unrated
              </strong>
              <span>
                {browserEvents.length} decisions ·{' '}
                {document.play?.mode === 'realtime'
                  ? 'low-latency policy'
                  : 'model policy'}
              </span>
              <button
                aria-label="Close test logs"
                title="Close test logs"
                onClick={() => setLogsOpen(false)}
              >
                <X size={14} />
              </button>
            </div>
            {!browserEvents.length ? (
              <p className="studio-help">
                Decisions, measured feedback, latency, and strategy changes will
                appear here.
              </p>
            ) : null}
            {browserEvents.map((event) => (
              <details key={event.step}>
                <summary>
                  {event.step + 1}. {event.seatId ?? 'seat'} ·{' '}
                  {event.decision.actionId} · {event.decision.reason}{' '}
                  {event.feedback ? (
                    <em className={`studio-feedback ${event.feedback.outcome}`}>
                      {event.feedback.reward >= 0 ? '+' : ''}
                      {event.feedback.reward.toFixed(1)}
                    </em>
                  ) : null}
                </summary>
                <pre>
                  {JSON.stringify(
                    {
                      controller: event.controller,
                      observation: event.observation,
                      feedback: event.feedback,
                      learning: event.decision.learning,
                      adaptation: event.adaptation,
                      performance: event.performance,
                      timing: event.timing,
                    },
                    null,
                    2,
                  )}
                </pre>
              </details>
            ))}
          </div>
        ) : (
          view === 'test' && (
            <>
              <div className="studio-log-heading">
                <FlaskConical size={13} />
                <strong>Test Arena</strong>
                <span>
                  {run
                    ? `${run.steps} decisions · ${run.status}`
                    : 'No run started'}
                </span>
                <select
                  aria-label="Filter diagnostics"
                  value={logFilter}
                  onChange={(e) => setLogFilter(e.target.value)}
                >
                  <option value="all">All events</option>
                  <option value="policy">Observations & decisions</option>
                  <option value="runtime">Actions & state</option>
                </select>
                <button
                  aria-label="Close test logs"
                  title="Close test logs"
                  onClick={() => setLogsOpen(false)}
                >
                  <X size={14} />
                </button>
                {run && (
                  <button
                    onClick={() => {
                      const blob = new Blob([JSON.stringify(run, null, 2)], {
                          type: 'application/json',
                        }),
                        url = URL.createObjectURL(blob)
                      const a = window.document.createElement('a')
                      a.href = url
                      a.download = `${run.runId}.json`
                      a.click()
                      URL.revokeObjectURL(url)
                    }}
                    aria-label="Export replay"
                  >
                    <Download size={14} />
                  </button>
                )}
              </div>
              <div className="studio-log-body">
                <div className="studio-log-list">
                  {logs
                    .filter(
                      (l) => logFilter === 'all' || l.category === logFilter,
                    )
                    .map((l) => (
                      <button
                        key={l.sequence}
                        className={
                          selected?.sequence === l.sequence ? 'is-active' : ''
                        }
                        onClick={() => setSelected(l)}
                      >
                        <span>{String(l.sequence).padStart(3, '0')}</span>
                        <strong>{l.type}</strong>
                        <small>{l.summary}</small>
                      </button>
                    ))}
                  {!logs.length && (
                    <p className="studio-help">
                      Start a test to inspect agent observations, policy
                      decisions and accepted actions.
                    </p>
                  )}
                </div>
                {selected && (
                  <pre className="studio-log-detail">
                    {JSON.stringify(selected.data, null, 2)}
                  </pre>
                )}
              </div>
            </>
          )
        )
      }
    >
      {(error || notice) && (
        <div
          role={error ? 'alert' : 'status'}
          className={`studio-banner ${error ? 'error' : ''}`}
        >
          <span>{error || notice}</span>
          {error.includes('credits') && (
            <a
              href="https://www.agentcommons.io/settings/billing"
              target="_blank"
              rel="noreferrer"
            >
              Manage Commons credits ↗
            </a>
          )}
          {notice.startsWith('Published.') && project?.releaseId && (
            <Link href={`/games/${project.id.replace('prj_', 'gam_')}`}>
              Open game ↗
            </Link>
          )}
          <button
            aria-label="Dismiss message"
            onClick={() => {
              setError('')
              setNotice('')
            }}
          >
            <X size={13} />
          </button>
        </div>
      )}
      <div className="studio-stage-toolbar">
        <div className="studio-segment">
          {(isBrowserGame(document)
            ? (['preview', 'code'] as const)
            : (['preview', 'code', 'test'] as const)
          ).map((v) => (
            <button
              key={v}
              className={view === v ? 'is-active' : ''}
              onClick={() => {
                if (v !== 'test') setPlaying(false)
                setView(v)
              }}
            >
              {v === 'preview' ? (
                <Gamepad2 size={13} />
              ) : v === 'code' ? (
                <Code2 size={13} />
              ) : (
                <FlaskConical size={13} />
              )}{' '}
              {v === 'test' ? 'Test Arena' : v[0]!.toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
        <div className="studio-stage-actions">
          {!logsOpen && (browserRun || view === 'test')
            ? icon(<FlaskConical size={14} />, 'Open test logs', () =>
                setLogsOpen(true),
              )
            : null}
          {!leftOpen &&
            icon(<Folder size={15} />, 'Open project panel', () =>
              setLeftOpen(true),
            )}
          {view === 'test' ? (
            <>
              <Button
                disabled={!user || !!busy}
                onClick={() => void task('prepare test', startRun)}
              >
                <RotateCcw size={13} />
                {run ? 'New run' : 'Run agents'}
              </Button>
              {run && (
                <>
                  {icon(
                    playing ? <Pause size={15} /> : <Play size={15} />,
                    playing ? 'Pause test' : 'Continue test',
                    () => setPlaying(!playing),
                  )}
                  <button
                    className="studio-icon"
                    aria-label="Step one decision"
                    disabled={!!busy || playing || run.status !== 'running'}
                    onClick={() => void task('step', stepRun)}
                  >
                    <SkipForward size={15} />
                  </button>
                </>
              )}
            </>
          ) : (
            <>
              {icon(
                <MousePointer2 size={15} />,
                'Interact with game',
                () => setTool('select'),
                tool === 'select',
              )}
              {icon(
                <MapPin size={15} />,
                'Point annotation',
                () => {
                  setTool('point')
                  setRight('notes')
                  setRightOpen(true)
                },
                tool === 'point',
              )}
              {icon(
                <Scan size={15} />,
                'Region annotation',
                () => {
                  setTool('region')
                  setRight('notes')
                  setRightOpen(true)
                },
                tool === 'region',
              )}
              {icon(<span>−</span>, 'Zoom out', () =>
                setZoom((z) => Math.max(0.5, z - 0.1)),
              )}
              <span className="studio-help">{Math.round(zoom * 100)}%</span>
              {icon(<span>+</span>, 'Zoom in', () =>
                setZoom((z) => Math.min(2, z + 0.1)),
              )}
              {icon(<RotateCcw size={14} />, 'Restart preview', () =>
                setPreviewKey((k) => k + 1),
              )}
              {icon(
                fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />,
                fullscreen ? 'Exit fullscreen preview' : 'Fullscreen preview',
                () => {
                  if (globalThis.document.fullscreenElement)
                    void globalThis.document.exitFullscreen()
                  else void previewStageRef.current?.requestFullscreen()
                },
                fullscreen,
              )}
            </>
          )}
        </div>
      </div>
      {view === 'code' ? (
        isBrowserGame(document) ? (
          // Generated source is shown in the same window chrome Commons uses
          // for an agent's code project, so a game reads as a work product
          // rather than as a text box inside a settings panel.
          <CommonsWindow
            className="studio-window"
            tone="dark"
            title={`${title} — source`}
            status={`${document.files.length} file${document.files.length === 1 ? '' : 's'} · ${sourceSize}`}
          >
            <CodeFileBrowser
              files={document.files}
              onChange={(path, content) =>
                update({
                  files: document.files.map((f) =>
                    f.path === path ? { ...f, content } : f,
                  ),
                })
              }
            />
          </CommonsWindow>
        ) : (
          <div className="studio-code">
            <div>
              <Code2 size={13} />
              game.json
              <Button
                onClick={() =>
                  void task('compile', async () => {
                    update(gameDocumentSchema.parse(JSON.parse(source)))
                    setView('preview')
                  })
                }
              >
                Compile preview
              </Button>
            </div>
            <textarea
              aria-label="Game document source"
              spellCheck={false}
              value={source}
              onChange={(e) => setSource(e.target.value)}
            />
          </div>
        )
      ) : (
        <div className="studio-preview-stage" ref={previewStageRef}>
          {fullscreen ? (
            <button
              className="studio-fullscreen-exit"
              onClick={() => void globalThis.document.exitFullscreen()}
            >
              <Minimize2 size={15} /> Exit fullscreen
            </button>
          ) : null}
          <div className="studio-preview-meta">
            <span>
              {view === 'test'
                ? `Test run · revision ${run?.revision ?? '—'}`
                : 'Compiled game preview'}
            </span>
            <span>
              {isBrowserGame(document)
                ? 'Browser project'
                : `${document.boardSize} × ${document.boardSize} · Turn based`}
            </span>
          </div>
          <div
            className="studio-preview-frame"
            style={{
              transform: `scale(${zoom})`,
              transformOrigin: 'top center',
            }}
          >
            {browserRun && browserAction ? (
              <div
                className={`studio-live-action${browserAction.fallback ? ' is-fallback' : ''}`}
                aria-live="polite"
              >
                <Bot size={14} />
                <span>
                  <strong>{browserAction.seat}</strong>
                  {browserAction.action}
                </span>
                {browserAction.fallback ? (
                  <small>service fallback</small>
                ) : null}
              </div>
            ) : null}
            {/* A live browser run must keep the shared frame interactive so
                its animation clocks run. The sibling shield blocks unlogged
                pointer input without enabling the frame's freeze mode. */}
            <CompiledArtifactFrame
              ref={compiledRef}
              onRecording={(recording) =>
                void saveInteractionRecording(recording)
              }
              preview={
                compiled.html
                  ? { type: 'html', html: compiled.html }
                  : {
                      type: 'unavailable',
                      error: `The source could not compile: ${compiled.error} Check the entry file and local imports, or ask your copilot to fix the project.`,
                    }
              }
              interactive={tool === 'select'}
              title={`${document.title} compiled game`}
              revision={`${previewKey}:${view}:${run?.steps ?? 0}`}
            />
            {browserRun ? (
              <div
                className="studio-agent-input-shield"
                aria-hidden="true"
                title="Use the Test Arena controls while this session is running"
              />
            ) : null}
            <AnnotationLayer
              tool={view === 'test' ? 'select' : tool}
              notes={visibleNotes}
              onCreate={(g) => {
                const frame = compiledRef.current
                const moment = frame?.moment()
                annotationContext.current = frame
                  ? Promise.all([
                      frame.observe(),
                      frame
                        .snapshot()
                        .then(async (snapshot) => {
                          if (!project || dirty) return undefined
                          const saved = await storeRecording(
                            project.id,
                            project.revision,
                            snapshot,
                            false,
                          )
                          setRecordingsRefresh((r) => r + 1)
                          return saved.id
                        })
                        .catch((error) => {
                          setNotice(
                            error instanceof Error
                              ? error.message
                              : 'Could not save the annotation snapshot.',
                          )
                          return undefined
                        }),
                    ])
                      .then(([observation, snapshotRecordingId]) => ({
                        viewport: { width: 1280, height: 720 },
                        moment,
                        observation,
                        snapshotRecordingId,
                      }))
                      .catch(() => ({
                        viewport: { width: 1280, height: 720 },
                        moment,
                      }))
                  : undefined
                setDraft(g)
                setRight('notes')
                setRightOpen(true)
              }}
              onSelect={(a) => {
                setRight('notes')
                setRightOpen(true)
                setNotice(a.body)
              }}
            />
          </div>
          <div className="studio-preview-footer">
            <span className="studio-status-dot" />
            {view === 'test'
              ? run?.status === 'completed'
                ? 'Run complete · replay available below'
                : playing
                  ? 'Agents are playing'
                  : 'Test paused'
              : tool !== 'select'
                ? `Click${tool === 'region' ? ' and drag' : ''} to annotate`
                : isBrowserGame(document) && browserRun
                  ? browserPlaying
                    ? `${browserRun.controllers.filter((controller) => controller.kind === 'agent').length} agents are playing · human turns use the legal-action panel`
                    : `Session paused at decision ${browserRun.step}`
                  : 'Play directly in the preview'}
            <span className="studio-preview-trust">
              {view === 'test'
                ? 'Authoritative test state'
                : 'Isolated preview'}
            </span>
          </div>
        </div>
      )}
    </CanvasShell>
  )
}

function actionsForSeat(
  actions: CanvasObservation['actions'],
  seatId: string,
): CanvasObservation['actions'] {
  const prefix = `seat:${encodeURIComponent(seatId)}:`
  const scoped = actions.filter((action) => action.id.startsWith(prefix))
  const seatAware = actions.some((action) => action.id.startsWith('seat:'))
  return scoped.length || seatAware ? scoped : actions
}

function seatsFromObservation(
  observation: CanvasObservation,
): { id: string; label: string }[] {
  if (!observation.state || typeof observation.state !== 'object') return []
  const arcade = (observation.state as Record<string, unknown>).arcade
  if (!arcade || typeof arcade !== 'object') return []
  const seats = (arcade as Record<string, unknown>).seats
  if (!Array.isArray(seats)) return []
  return seats.flatMap((seat) => {
    if (!seat || typeof seat !== 'object') return []
    const { id, label } = seat as Record<string, unknown>
    return typeof id === 'string' && typeof label === 'string'
      ? [{ id, label }]
      : []
  })
}

function bridgeFromObservation(observation: CanvasObservation) {
  if (!observation.state || typeof observation.state !== 'object') return
  const arcade = (observation.state as Record<string, unknown>).arcade
  if (!arcade || typeof arcade !== 'object') return
  const bridge = (arcade as Record<string, unknown>).bridge
  return typeof bridge === 'string' ? bridge : undefined
}

function stateForSeat(state: unknown, seatId: string): unknown {
  if (!state || typeof state !== 'object') return state
  const arcade = (state as Record<string, unknown>).arcade
  if (!arcade || typeof arcade !== 'object') return state
  const observations = (arcade as Record<string, unknown>).observations
  if (!observations || typeof observations !== 'object') return state
  return (observations as Record<string, unknown>)[seatId] ?? state
}

function numberAt(state: unknown, path: readonly string[]): number | undefined {
  let value = state
  for (const key of path) {
    if (!value || typeof value !== 'object') return undefined
    value = (value as Record<string, unknown>)[key]
  }
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function textAt(state: unknown, path: readonly string[]): string | undefined {
  let value = state
  for (const key of path) {
    if (!value || typeof value !== 'object') return undefined
    value = (value as Record<string, unknown>)[key]
  }
  return typeof value === 'string' ? value : undefined
}

function transitionFeedback(
  before: unknown,
  after: unknown,
  actionId: string,
  observedAfterMs: number,
): BrowserFeedback {
  const metrics: Record<string, number> = {}
  let reward = 0
  const measure = (
    name: string,
    path: readonly string[],
    rewardWeight: number,
  ) => {
    const prior = numberAt(before, path)
    const current = numberAt(after, path)
    if (prior === undefined || current === undefined) return
    const delta = current - prior
    metrics[name] = delta
    reward += delta * rewardWeight
  }
  measure('ownLivesDelta', ['me', 'lives'], 2)
  measure('opponentLivesDelta', ['opponent', 'lives'], -2)
  measure('ownHitsDelta', ['me', 'shotsHit'], 1)
  measure('opponentHitsDelta', ['opponent', 'shotsHit'], -1)
  measure('scoreDelta', ['score'], 1)
  const winner = textAt(after, ['winner'])
  const me = textAt(after, ['me', 'id'])
  if (winner && me) reward += winner === me ? 5 : -5
  const rounded = Math.round(reward * 100) / 100
  const outcome =
    rounded > 0
      ? ('positive' as const)
      : rounded < 0
        ? ('negative' as const)
        : Object.keys(metrics).length
          ? ('neutral' as const)
          : ('unknown' as const)
  const changed = Object.entries(metrics)
    .filter(([, delta]) => delta !== 0)
    .map(([name, delta]) => `${name} ${delta >= 0 ? '+' : ''}${delta}`)
  return {
    actionId,
    outcome,
    reward: rounded,
    summary: changed.length
      ? `Observed ${changed.join(', ')} after the prior action.`
      : `No measurable outcome change was visible after the prior action.`,
    observedAfterMs: Math.max(0, Math.round(observedAfterMs)),
    metrics,
  }
}

function enrichRealtimeState(state: unknown): unknown {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return state
  const source = state as Record<string, unknown>
  const me =
    source.me && typeof source.me === 'object'
      ? (source.me as Record<string, unknown>)
      : undefined
  const bullets = Array.isArray(source.bullets) ? source.bullets : []
  const meX = typeof me?.x === 'number' ? me.x : undefined
  const meId = typeof me?.id === 'string' ? me.id : undefined
  const incomingThreats = bullets.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object' || meX === undefined)
      return []
    const bullet = candidate as Record<string, unknown>
    if (
      typeof bullet.x !== 'number' ||
      typeof bullet.vx !== 'number' ||
      bullet.vx === 0 ||
      (meId && bullet.owner === meId)
    )
      return []
    const seconds = (meX - bullet.x) / bullet.vx
    if (!Number.isFinite(seconds) || seconds < 0) return []
    return [
      {
        owner: typeof bullet.owner === 'string' ? bullet.owner : undefined,
        distance: Math.round(Math.abs(meX - bullet.x)),
        timeToImpactMs: Math.round(seconds * 1000),
        ...(typeof bullet.y === 'number' ? { y: bullet.y } : {}),
      },
    ]
  })
  return {
    ...source,
    arcadeDecisionContext: {
      capturedAt: new Date().toISOString(),
      incomingThreats,
      urgency: incomingThreats.some((threat) => threat.timeToImpactMs <= 500)
        ? 'immediate'
        : incomingThreats.length
          ? 'approaching'
          : 'clear',
    },
  }
}

async function waitForPreview(
  ref: React.RefObject<CompiledFrameHandle | null>,
): Promise<CanvasObservation> {
  let lastError: unknown
  let lastObservation: CanvasObservation | undefined
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      if (!ref.current) throw new Error('The compiled preview is not mounted.')
      const observation = await ref.current.observe()
      lastObservation = observation
      const runtime = runtimeFromObservation(observation)
      if (runtime?.status === 'error')
        throw new Error(
          `The game could not start: ${runtime.message ?? 'unknown preview error'}`,
        )
      if (
        seatsFromObservation(observation).length &&
        runtime?.status !== 'loading'
      )
        return observation
      // Older compiled projects do not expose runtime status. Once their
      // semantic actions respond, they are safe to start through the legacy
      // bridge instead of being rejected by the newer seat handshake.
      if (!runtime && observation.actions.length > 0 && attempt >= 4)
        return observation
      lastError = new Error('The game runtime is still loading.')
    } catch (error) {
      lastError = error
      if (
        error instanceof Error &&
        error.message.startsWith('The game could not start:')
      )
        break
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  if (lastObservation?.actions.length) return lastObservation
  throw lastError instanceof Error
    ? lastError
    : new Error('The compiled preview did not become ready.')
}

function runtimeFromObservation(
  observation: CanvasObservation,
): { status?: string; message?: string } | undefined {
  if (!observation.state || typeof observation.state !== 'object') return
  const arcade = (observation.state as Record<string, unknown>).arcade
  if (!arcade || typeof arcade !== 'object') return
  const runtime = (arcade as Record<string, unknown>).runtime
  if (!runtime || typeof runtime !== 'object') return
  const { status, message } = runtime as Record<string, unknown>
  return {
    ...(typeof status === 'string' ? { status } : {}),
    ...(typeof message === 'string' ? { message } : {}),
  }
}
