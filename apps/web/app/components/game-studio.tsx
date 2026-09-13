'use client'
import { AgentSelect, type SelectableAgent } from './agent-select'
import { CreatorEconomySettings } from './creator-economy-settings'
import { AccountMenu } from './account-menu'
import { Brand } from './brand'
import {
  CopilotReview,
  CopilotSessionList,
  CopilotSettings,
  copilotSessionTitle,
  useProjectCopilot,
} from './copilot-sessions'
import { AgentComputerPanel } from './agent-computer-panel'
import { ThumbnailField } from './thumbnail-field'
import { StudioCodeEditor } from './studio-code-editor'
import { ProjectSwitcher } from './project-switcher'
import { SwitchField } from './ui/switch'
import { CheckboxField } from './ui/checkbox'
import { Field, Input, Textarea } from './ui/field'
import { Select, SelectOption } from './ui/select'
import { Tab, Tabs } from './ui/tabs'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArcadeComposer, useArcadeIdentity } from './studio-composer'
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  TrendingUp,
  ArrowUp,
  Bot,
  Check,
  Circle,
  Code2,
  Download,
  EyeOff,
  FlaskConical,
  Folder,
  Wallet,
  Film,
  Gamepad2,
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
  RotateCcw,
  Save,
  Scan,
  Settings,
  Settings2,
  Share2,
  SkipForward,
  Square,
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
  isManagedBrowserGame,
  type GameDocument,
  type StudioProject,
  type StudioRelease,
} from '@common-arcade/studio'
import type { TestRun } from '@common-arcade/control-client'
import { arcade, arcadeCopilot, type CopilotActivity } from '../../lib/api'
import { RecordingShelf, storeRecording } from './recording-shelf'
import { usePreviewAgents } from '../lib/use-preview-agents'
import {
  createBrowserPolicy,
  type ExecutableStrategy,
} from '@common-arcade/studio'
import {
  transitionFeedback,
  type BrowserFeedback,
} from '../lib/browser-policy-feedback'

type Agent = SelectableAgent
type BrowserController = {
  seatId: string
  label: string
  kind: 'human' | 'agent'
  agentId?: string
  sessionId?: string
  strategy: string
  strategyEpoch?: number
  executableStrategy?: ExecutableStrategy
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
type BrowserEvent = {
  epoch?: string
  step: number
  seatId?: string
  observation: CanvasObservation
  decision: {
    actionId: string
    reason: string
    learning?: { lesson: string; confidence: number }
  }
  decisionSource?:
    | 'commons'
    | 'arcade-policy'
    | 'arcade-fallback'
    | 'human'
    | 'external'
    | 'preview-frame-policy'
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
const BrowserEventRow = memo(function BrowserEventRow({
  event,
  index,
  sampled,
}: {
  event: BrowserEvent
  index: number
  sampled: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        {index + 1}. {sampled ? `Decision ${event.step + 1} · ` : ''}
        {event.seatId ?? 'seat'} · {event.decision.actionId} ·{' '}
        {event.decision.reason}{' '}
        {event.feedback ? (
          <em className={`studio-feedback ${event.feedback.outcome}`}>
            {event.feedback.reward >= 0 ? '+' : ''}
            {event.feedback.reward.toFixed(1)}
          </em>
        ) : null}
      </summary>
      {open ? (
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
      ) : null}
    </details>
  )
})

type BrowserRun = {
  id: string
  step: number
  revision: number
  createdAt: string
  controllers: BrowserController[]
  events?: BrowserEvent[]
  preview?: { decisions: number; samples: number }
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
  const activeCopilotRun = useRef<AbortController | undefined>(undefined)
  useEffect(
    () => () => {
      // The Commons job remains durable; only this workspace's polling and
      // callbacks stop when its route changes or the component unmounts.
      activeCopilotRun.current?.abort()
    },
    [projectId],
  )
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
  const [reviewingBrowserRun, setReviewingBrowserRun] = useState(false)
  const browserRunCurrent = useRef(browserRun)
  browserRunCurrent.current = browserRun
  const installedStrategies = useRef(new Map<string, number>())
  const [browserRuns, setBrowserRuns] = useState<BrowserRun[]>([])
  const [browserEvents, setBrowserEvents] = useState<BrowserEvent[]>([])
  const [browserObservation, setBrowserObservation] =
    useState<CanvasObservation>()
  const [browserPlaying, setBrowserPlaying] = useState(false)
  const [browserDeciding, setBrowserDeciding] = useState(false)
  const [frameDecisions, setFrameDecisions] = useState(0)
  const [logsOpen, setLogsOpen] = useState(true)
  const [logsExpanded, setLogsExpanded] = useState(false)
  const [workspaceGroup, setWorkspaceGroup] = useState('project')
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
      const ended =
        isManagedBrowserGame(document) &&
        agents.every((controller) => {
          const state = stateForSeat(observation.state, controller.seatId)
          return (
            state &&
            typeof state === 'object' &&
            'result' in state &&
            state.result != null
          )
        })
      if (
        ended ||
        !isBrowserGame(document) ||
        document.play?.mode === 'turn-based'
      )
        setBrowserPlaying(false)
      setBrowserObservation(observation)
      setNotice(
        ended
          ? 'Match finished. Start a new session to play again.'
          : 'Agents are waiting for a legal move. Play a human turn or wait for the next playable moment.',
      )
      return
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
    if (
      browserRunCurrent.current?.id !== current.id ||
      (installedStrategies.current.get(`${current.id}/${selected.seatId}`) ??
        0) > (event.controller?.strategyEpoch ?? selected.strategyEpoch ?? 0)
    )
      return
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
    setBrowserRun((latest) =>
      latest?.id !== current.id
        ? latest
        : {
            ...latest,
            step: current.step + 1,
            controllers: latest.controllers.map((controller) =>
              controller.seatId === selected.seatId && event.controller
                ? {
                    ...controller,
                    ...event.controller,
                    performance: event.performance,
                  }
                : controller,
            ),
          },
    )
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
    setBrowserRun((latest) =>
      latest?.id === browserRun.id ? { ...latest, step: nextRun.step } : latest,
    )
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
  const [publication, setPublication] = useState<{
    projectId: string
    isPublished: boolean
  }>()
  const [publicationLoading, setPublicationLoading] = useState(false)
  const [publicationError, setPublicationError] = useState('')
  const [publicationRefresh, setPublicationRefresh] = useState(0)
  const [collaboratorId, setCollaboratorId] = useState('')
  const [collaboratorPermission, setCollaboratorPermission] = useState<
    'test' | 'comment' | 'edit'
  >('test')
  const [projects, setProjects] = useState<StudioProject[]>([])
  const [document, setDocument] = useState<GameDocument>(emptyBrowserDocument)
  const [source, setSource] = useState(
    JSON.stringify(emptyBrowserDocument, null, 2),
  )
  const currentDraft = useRef({ document, source })
  currentDraft.current = { document, source }
  const approvalDraft = useRef(currentDraft.current)
  const [view, setView] = useState<'preview' | 'code' | 'test'>('preview')
  const [right, setRight] = useState<
    'copilot' | 'sessions' | 'notes' | 'history' | 'settings'
  >('copilot')
  const [elapsed, setElapsed] = useState(0)
  const [pendingPrompt, setPendingPrompt] = useState('')
  const pendingContext = useRef<{
    agentId?: string
    attachments?: { fileId: string }[]
    model?: { provider: string; modelId: string }
  }>({})
  const [leftOpen, setLeftOpen] = useState(true),
    [rightOpen, setRightOpen] = useState(true)
  useEffect(() => {
    const mobile = window.matchMedia('(max-width: 850px)')
    const collapse = () => {
      if (mobile.matches) {
        setLeftOpen(false)
        setRightOpen(false)
      }
    }
    collapse()
    mobile.addEventListener('change', collapse)
    return () => mobile.removeEventListener('change', collapse)
  }, [])
  function showLeftPanel(open: boolean) {
    setLeftOpen(open)
    if (open && window.matchMedia('(max-width: 850px)').matches)
      setRightOpen(false)
  }
  function showRightPanel(open: boolean) {
    setRightOpen(open)
    if (open && window.matchMedia('(max-width: 850px)').matches)
      setLeftOpen(false)
  }

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
  const copilot = useProjectCopilot(projectId, copilotId, setMessages)
  const publicationProjectId = user ? project?.id : undefined
  useEffect(() => {
    let active = true
    const controller = new AbortController()
    setPublication(undefined)
    setPublicationError('')
    setPublicationLoading(Boolean(publicationProjectId))
    if (publicationProjectId) {
      void arcade<{ projectId: string; isPublished: boolean }>(
        `projects/${publicationProjectId}/publication`,
        undefined,
        'GET',
        {},
        controller.signal,
      )
        .then((status) => {
          if (!active) return
          if (
            status.projectId !== publicationProjectId ||
            typeof status.isPublished !== 'boolean'
          )
            throw new Error('Could not verify publication status.')
          setPublication(status)
        })
        .catch((cause) => {
          if (active)
            setPublicationError(
              cause instanceof Error
                ? cause.message
                : 'Could not load publication status.',
            )
        })
        .finally(() => {
          if (active) setPublicationLoading(false)
        })
    }
    return () => {
      active = false
      controller.abort()
    }
    // Publication can change without a new source revision, including when a
    // recovered Copilot job finishes after the workspace has been reopened.
  }, [
    publicationProjectId,
    publicationRefresh,
    copilot.activeJobId,
    copilot.recoveredRevision,
  ])
  const [computerOpen, setComputerOpen] = useState(false)
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
  const realtimePreview =
    isBrowserGame(document) &&
    ['realtime', 'hybrid'].includes(document.play?.mode ?? '')
  usePreviewAgents({
    root: previewStageRef,
    active:
      realtimePreview &&
      !reviewingBrowserRun &&
      browserPlaying &&
      !dirty &&
      view === 'preview' &&
      tool === 'select',
    runId: browserRun?.id,
    previewRevision: `${project?.revision}:${previewKey}:${view}`,
    controllers: browserRun?.controllers ?? [],
    decisionsPerSecond: isBrowserGame(document)
      ? (document.play?.maxDecisionsPerSecond ?? 10)
      : 2,
    onSample: (event: BrowserEvent, epoch, decisions) => {
      setFrameDecisions(decisions)
      setBrowserRuns((runs) =>
        runs.map((run) =>
          run.id === browserRun?.id
            ? {
                ...run,
                preview: {
                  decisions,
                  samples: (run.preview?.samples ?? 0) + 1,
                },
              }
            : run,
        ),
      )
      setBrowserEvents((all) => [...all, { ...event, epoch }].slice(-120))
      setBrowserAction({
        seat:
          browserRun?.controllers.find((c) => c.seatId === event.seatId)
            ?.label ??
          event.seatId ??
          '',
        action:
          event.observation.actions.find(
            (a) => a.id === event.decision.actionId,
          )?.label ?? event.decision.actionId,
        fallback: false,
      })
    },
    onStrategyApplied: (seatId, epoch) =>
      setNotice(`Strategy ${epoch} is active for ${seatId}.`),
    onStop: (reason) => {
      setBrowserPlaying(false)
      setNotice(reason)
    },
    onWarning: (reason) => setNotice(reason),
  })
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
      setBusy('')
      setElapsed(0)
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
          try {
            const request = JSON.parse(initial)
            if (typeof request.message === 'string') {
              pendingContext.current = request
              if (request.agentId) setCopilotId(request.agentId)
              setPendingPrompt(request.message)
            } else setPendingPrompt(initial)
          } catch {
            setPendingPrompt(initial)
          }
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
    if (identity.copilotId)
      setCopilotId(
        (current) =>
          current || pendingContext.current.agentId || identity.copilotId,
      )
  }, [identity.agents, identity.copilotId])
  useEffect(() => {
    const changed = () =>
      setFullscreen(globalThis.document.fullscreenElement !== null)
    globalThis.document.addEventListener('fullscreenchange', changed)
    return () =>
      globalThis.document.removeEventListener('fullscreenchange', changed)
  }, [])
  useEffect(() => {
    if (
      !project ||
      !copilot.recoveredRevision ||
      copilot.recoveredRevision <= project.revision
    )
      return
    let alive = true
    const before = currentDraft.current
    void arcade<StudioProject>(`projects/${projectId}`)
      .then((latest) => {
        if (!alive) return
        setProject(latest)
        if (
          !dirty &&
          before.document === currentDraft.current.document &&
          before.source === currentDraft.current.source
        ) {
          setDocument(latest.document)
          setSource(JSON.stringify(latest.document, null, 2))
          setPreviewKey((key) => key + 1)
        }
        setNotice(`Copilot completed revision ${latest.revision}.`)
      })
      .catch((error) => {
        if (alive) setError(error.message)
      })
    return () => {
      alive = false
    }
  }, [copilot.recoveredRevision, project?.revision, projectId])
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  async function task(
    name: string,
    fn: () => Promise<void>,
    isCurrent = () => true,
  ) {
    setBusy(name)
    setError('')
    setNotice('')
    try {
      await fn()
    } catch (e) {
      if (!isCurrent()) return
      setError(e instanceof Error ? e.message : String(e))
      setPlaying(false)
      setBrowserPlaying(false)
    } finally {
      if (isCurrent()) setBusy('')
    }
  }
  async function save(
    next = view === 'code' && !isBrowserGame(document)
      ? gameDocumentSchema.parse(JSON.parse(source))
      : document,
    isCurrent = () => true,
  ) {
    gameDocumentSchema.parse(next)
    const p = project
      ? await arcade<StudioProject>(`projects/${project.id}`, next, 'PUT', {
          'If-Match': String(project.revision),
        })
      : await arcade<StudioProject>('projects', { document: next })
    if (!isCurrent()) return p
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
    if (isManagedBrowserGame(p.document)) {
      setPreviewKey((key) => key + 1)
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      )
    }
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
    setReviewingBrowserRun(false)
    setBrowserRun(created)
    setFrameDecisions(0)
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
            ((isManagedBrowserGame(p.document) &&
              p.document.play?.mode !== 'turn-based') ||
              actionsForSeat(initialObservation.actions, controller.seatId)
                .length > 0),
        ),
      ),
    )
    setNotice(
      isManagedBrowserGame(p.document)
        ? 'Local playtest started using the saved game rules. Play with the game controls; publish to host a shared live match.'
        : bridgeFromObservation(initialObservation) === 'dom-fallback'
          ? 'Session started in compatibility mode. Arcade assigned visible control groups to each seat; ask the copilot to add a semantic agent bridge for richer strategy.'
          : 'Private Test Arena session started. Human moves use the legal-action controls so the session stays resumable.',
    )
    return created
  }
  async function resumeBrowserRun(summary: BrowserRun) {
    const saved = await arcade<
      BrowserRun & {
        events: BrowserEvent[]
        telemetry?: {
          epoch: string
          recordedAt?: string
          events: BrowserEvent[]
        }[]
      }
    >(`studio/browser-runs/${summary.id}`)
    setReviewingBrowserRun(true)
    setBrowserRun(saved)
    setBrowserControllers(saved.controllers)
    setBrowserEvents(saved.events ?? [])
    setBrowserPlaying(false)
    setLogsOpen(true)
    setFrameDecisions(saved.preview?.decisions ?? 0)
    if (
      isManagedBrowserGame(document) ||
      realtimePreview ||
      saved.telemetry?.length
    ) {
      const epochs = new Map<
        string,
        { started: string; events: BrowserEvent[] }
      >()
      for (const batch of saved.telemetry ?? []) {
        const prior = epochs.get(batch.epoch) ?? {
          started: batch.recordedAt ?? batch.epoch,
          events: [],
        }
        if (batch.recordedAt && batch.recordedAt < prior.started)
          prior.started = batch.recordedAt
        prior.events.push(
          ...batch.events.map((event) => ({ ...event, epoch: batch.epoch })),
        )
        epochs.set(batch.epoch, prior)
      }
      setBrowserEvents(
        [
          ...(saved.events ?? []),
          ...[...epochs.values()]
            .sort((a, b) => a.started.localeCompare(b.started))
            .flatMap((epoch) =>
              [
                ...new Map(
                  epoch.events.map((event) => [event.step, event]),
                ).values(),
              ].sort((a, b) => a.step - b.step),
            ),
        ].slice(-120),
      )
      setNotice(
        `Reviewing saved diagnostics from revision ${saved.revision}. Start a new session to play. Timed playtests cannot be reconstructed from samples.`,
      )
      return
    }
    if (!project || saved.revision !== project.revision)
      throw new Error(
        `Restore revision ${saved.revision} before resuming this turn-based session.`,
      )
    setReviewingBrowserRun(false)
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
    const runId = browserRun.id
    const observed = await compiledRef.current?.observe()
    if (!observed)
      throw new Error(
        'The game observation is unavailable. Retry when the preview is ready.',
      )
    const state = observed.state as Record<string, any>
    const seatState = state?.arcade?.observations?.[controller.seatId]
    const actions = observed.actions.filter((a) =>
      a.id.startsWith(`seat:${encodeURIComponent(controller.seatId)}:`),
    )
    if (!seatState || !actions.length)
      throw new Error(
        'This seat needs an observation and legal actions before it can be coached.',
      )
    setNotice(`${controller.label} is processing your coaching…`)
    const result = await arcade<{ controller: BrowserController }>(
      `studio/browser-runs/${browserRun.id}/controllers/${encodeURIComponent(controller.seatId)}/coach`,
      {
        prompt: strategy,
        observation: {
          state: seatState,
          actions: actions
            .slice(0, 80)
            .map((a) => ({ id: a.id, label: a.label.slice(0, 200) })),
        },
      },
    )
    if (browserRunCurrent.current?.id !== runId) return
    installedStrategies.current.set(
      `${runId}/${controller.seatId}`,
      result.controller.strategyEpoch ?? 0,
    )
    browserOutcome.current.delete(controller.seatId)
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
      `${controller.label} prepared strategy ${result.controller.strategyEpoch}; applying it to the game.`,
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
      (isBrowserGame(document) &&
        ['realtime', 'hybrid'].includes(document.play?.mode ?? '')) ||
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
          { managedPreview: true },
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
    ) => {
      if (project && project.id !== projectId) return
      activeCopilotRun.current?.abort()
      const controller = new AbortController()
      activeCopilotRun.current = controller
      const isCurrent = () => !controller.signal.aborted
      return task(
        'copilot',
        async () => {
          const p =
            !project || dirty ? await save(undefined, isCurrent) : project
          if (!isCurrent()) return
          setMessages((m) => [...m, { role: 'user', text: message }])
          setCopilotActivity([])
          const result = await arcadeCopilot(
            p.id,
            {
              message,
              agentId: copilotId,
              attachments,
              model,
              sessionId: copilot.sessionId || undefined,
              approvalMode: copilot.approvalMode,
              computerEnabled: copilot.computerEnabled,
            },
            {
              signal: controller.signal,
              onWait: (seconds) => {
                if (isCurrent()) setElapsed(seconds)
              },
              onUpdate: (events) => {
                if (isCurrent()) setCopilotActivity(events)
              },
              onStarted: (sessionId) => {
                if (isCurrent()) copilot.setSessionId(sessionId)
              },
            },
          ).finally(() => {
            if (!isCurrent()) return
            setPublicationRefresh((value) => value + 1)
            return copilot.refresh().catch(() => undefined)
          })
          if (!isCurrent()) return
          setElapsed(0)
          if (result.sessionId) copilot.setSessionId(result.sessionId)
          await copilot.refresh()
          if (!isCurrent()) return
          const latest = await arcade<StudioProject>(`projects/${p.id}`)
          if (!isCurrent()) return
          const changedLocally =
            currentDraft.current.document !== document ||
            currentDraft.current.source !== source
          setProject(latest)
          if (!changedLocally) {
            setDocument(latest.document)
            setSource(JSON.stringify(latest.document, null, 2))
          }
          setProjects((all) => [
            latest,
            ...all.filter((x) => x.id !== latest.id),
          ])
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
            changedLocally
              ? `Copilot saved revision ${latest.revision}. Your unsaved local edits have been kept; review them before saving.`
              : latest.revision > p.revision
                ? `Copilot saved revision ${latest.revision}.`
                : 'Copilot finished.',
          )
        },
        isCurrent,
      )
    },
    [
      projectId,
      project,
      dirty,
      document,
      source,
      copilotId,
      copilot.sessionId,
      copilot.approvalMode,
      copilot.computerEnabled,
    ],
  )
  useEffect(() => {
    if (
      !pendingPrompt ||
      !project ||
      !copilotId ||
      busy ||
      copilot.loading ||
      copilot.error
    )
      return
    const message = pendingPrompt
    setPendingPrompt('')
    void runCopilot(
      message,
      pendingContext.current.attachments,
      pendingContext.current.model,
    )
    pendingContext.current = {}
  }, [
    pendingPrompt,
    project,
    copilotId,
    busy,
    copilot.loading,
    copilot.error,
    runCopilot,
  ])
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
    <main className="arcade studio-workspace" id="main">
      <nav className="studio-rail" aria-label="Studio sections">
        <Link
          href="/studio"
          className="rail-brand"
          aria-label="All projects"
          title="Back to Studio"
        >
          <Brand compact />
        </Link>
        {(
          [
            ['project', 'Project', Folder],
            ['testing', 'Testing', FlaskConical],
            ['recordings', 'Recordings', Film],
            ['publishing', 'Publishing', Upload],
            ['payments', 'Payments', Wallet],
            ['team', 'Team', Users],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            title={label}
            aria-label={label}
            aria-pressed={leftOpen && workspaceGroup === id}
            onClick={() => {
              setWorkspaceGroup(id)
              showLeftPanel(workspaceGroup === id ? !leftOpen : true)
            }}
          >
            <Icon size={16} strokeWidth={1.75} />
          </button>
        ))}
        <div className="rail-account">
          <AccountMenu
            user={user}
            beforeSignOut={async () => {
              if (dirty) await save()
            }}
          />
        </div>
      </nav>
      {computerOpen && (
        <AgentComputerPanel
          agentId={copilotId}
          active={busy === 'copilot'}
          onClose={() => setComputerOpen(false)}
        />
      )}
      <CanvasShell
        className={logsExpanded && logsOpen ? 'studio-logs-expanded' : ''}
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
            <ProjectSwitcher
              current={project ?? undefined}
              projects={projects}
              disabled={!user || !!busy || dirty}
              disabledReason={
                dirty
                  ? 'Save your changes before switching project.'
                  : 'Sign in to open your projects.'
              }
              onCreate={() => router.push('/studio')}
            />
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
                  {isOwner && liveReadiness.liveReady ? (
                    <Button
                      disabled={!!busy}
                      onClick={() =>
                        void task('publish', async () => {
                          if (!document.thumbnail) {
                            setWorkspaceGroup('publishing')
                            showLeftPanel(true)
                            throw new Error(
                              'Add a game thumbnail in Publishing before publishing.',
                            )
                          }
                          const p = !project || dirty ? await save() : project
                          const release = await arcade<StudioRelease>(
                            `projects/${p.id}/publish`,
                            {},
                            'POST',
                            { 'If-Match': String(p.revision) },
                          )
                          setProject({ ...p, releaseId: release.id })
                          setPublicationRefresh((value) => value + 1)
                          setNotice(
                            'Published. Your game is now in the Arcade.',
                          )
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
              {icon(
                <PanelRightClose size={16} />,
                'Toggle assistant panel',
                () => showRightPanel(!rightOpen),
                rightOpen,
              )}
            </div>
          </>
        }
        left={
          leftOpen && (
            <>
              <div className="studio-panel-heading">
                <span>
                  {workspaceGroup.charAt(0).toUpperCase() +
                    workspaceGroup.slice(1)}
                </span>
                {icon(
                  <PanelLeftClose size={14} />,
                  'Collapse project panel',
                  () => showLeftPanel(false),
                )}
              </div>
              <div hidden={workspaceGroup !== 'payments'}>
                <CreatorEconomySettings
                  value={document.monetization}
                  onChange={(monetization) => update({ monetization })}
                  disabled={!isOwner}
                />
                {project?.unresolvedRemixRoyalty && (
                  <p className="studio-help">
                    This source has legacy royalty terms without payout
                    addresses. Free remix publication is available; paid
                    publication is blocked until the source terms can be
                    resolved.
                  </p>
                )}
                {project?.inheritedEconomy?.mode === 'revenue-share' && (
                  <details className="studio-section">
                    <summary>Inherited source royalties</summary>
                    {Object.entries(
                      project.inheritedEconomy.royalties ?? {},
                    ).flatMap(([network, shares]) =>
                      shares.map((share) => (
                        <p
                          key={`${network}:${share.recipient}`}
                          className="studio-help"
                          style={{ overflowWrap: 'anywhere' }}
                        >
                          {network}: {share.bps / 100}% of creator earnings →{' '}
                          {share.recipient}
                        </p>
                      )),
                    )}
                  </details>
                )}
              </div>
              <div hidden={workspaceGroup !== 'publishing'}>
                {project && (
                  <div className="studio-section">
                    <div className="studio-section-label">
                      <Upload size={13} /> Publication
                    </div>
                    <p className="studio-help" role="status">
                      <strong>
                        {publicationLoading
                          ? 'Checking publication…'
                          : publication?.projectId === project.id
                            ? publication.isPublished
                              ? 'Published'
                              : 'Unpublished'
                            : 'Publication status unavailable'}
                      </strong>
                    </p>
                    {publicationError ? (
                      <>
                        <p className="studio-help" role="alert">
                          {publicationError}
                        </p>
                        <Button
                          disabled={!!busy || publicationLoading}
                          onClick={() =>
                            setPublicationRefresh((value) => value + 1)
                          }
                        >
                          <RotateCcw size={14} /> Retry status
                        </Button>
                      </>
                    ) : publication?.projectId === project.id ? (
                      <>
                        <p className="studio-help">
                          {publication.isPublished
                            ? 'Visible in Discover and available for new sessions.'
                            : 'Publish to make this game visible in Discover and available for new sessions.'}
                        </p>
                        {isOwner && publication.isPublished && (
                          <>
                            <Button
                              disabled={!!busy || publicationLoading}
                              onClick={() =>
                                void task('unpublish', async () => {
                                  try {
                                    await arcade<{
                                      projectId: string
                                      isPublished: boolean
                                    }>(
                                      `projects/${project.id}/unpublish`,
                                      {},
                                      'POST',
                                      { 'If-Match': String(project.revision) },
                                    )
                                    setNotice(
                                      'Unpublished. Existing games continue; you can publish again at any time.',
                                    )
                                  } finally {
                                    setPublicationRefresh((value) => value + 1)
                                  }
                                })
                              }
                            >
                              <EyeOff size={14} />{' '}
                              {busy === 'unpublish'
                                ? 'Unpublishing…'
                                : 'Unpublish'}
                            </Button>
                            <p className="studio-help">
                              Removes this game from discovery and prevents new
                              sessions. Existing games continue. You can publish
                              again.
                            </p>
                          </>
                        )}
                        {!isOwner && (
                          <p className="studio-help">
                            Only the owner can publish or unpublish this game.
                          </p>
                        )}
                      </>
                    ) : null}
                  </div>
                )}
                <ThumbnailField
                  value={document.thumbnail}
                  onChange={(thumbnail) => update({ thumbnail })}
                  disabled={!canEdit}
                />
                <div className="studio-section economy-settings">
                  <div className="studio-section-label">
                    <Share2 size={13} />
                    Publishing & remixes
                  </div>
                  <Field label="License">
                    <Select
                      ariaLabel="License"
                      value={
                        document.distribution?.license ??
                        defaultGameDistribution.license
                      }
                      disabled={!canEdit}
                      onValueChange={(license) =>
                        update({
                          distribution: {
                            ...(document.distribution ??
                              defaultGameDistribution),
                            license: license as
                              | 'all-rights-reserved'
                              | 'cc-by-4.0'
                              | 'cc-by-sa-4.0'
                              | 'cc0-1.0',
                          },
                        })
                      }
                    >
                      <SelectOption
                        value="all-rights-reserved"
                        title="All rights reserved"
                      />
                      <SelectOption value="cc-by-4.0" title="CC BY 4.0" />
                      <SelectOption value="cc-by-sa-4.0" title="CC BY-SA 4.0" />
                      <SelectOption value="cc0-1.0" title="CC0 1.0" />
                    </Select>
                  </Field>
                  <Field label="Remixing">
                    <Select
                      ariaLabel="Remixing"
                      value={
                        document.distribution?.remixing ??
                        defaultGameDistribution.remixing
                      }
                      disabled={!canEdit}
                      onValueChange={(remixing) =>
                        update({
                          distribution: {
                            ...(document.distribution ??
                              defaultGameDistribution),
                            remixing: remixing as 'disabled' | 'allowed',
                          },
                        })
                      }
                    >
                      <SelectOption value="disabled" title="Disabled" />
                      <SelectOption
                        value="allowed"
                        title="Allow attributed remixes"
                      />
                    </Select>
                  </Field>
                  <CheckboxField
                    checked={document.distribution?.commercialUse ?? false}
                    disabled={!canEdit}
                    label="Allow remixes to earn money"
                    onCheckedChange={(commercialUse) =>
                      update({
                        distribution: {
                          ...(document.distribution ?? defaultGameDistribution),
                          commercialUse,
                        },
                      })
                    }
                  />
                  <Field label="Royalty from new remixes">
                    <Select
                      ariaLabel="Royalty from new remixes"
                      value={String(
                        document.distribution?.revenueShareBps ??
                          defaultGameDistribution.revenueShareBps,
                      )}
                      disabled={!canEdit}
                      onValueChange={(value) =>
                        update({
                          distribution: {
                            ...(document.distribution ??
                              defaultGameDistribution),
                            revenueShareBps: Number(value),
                          },
                        })
                      }
                    >
                      {[0, 500, 1000, 2000, 3000, 5000].map((bps) => (
                        <SelectOption
                          key={bps}
                          value={String(bps)}
                          title={
                            bps === 0
                              ? 'Free remixes · no new royalty'
                              : `${bps / 100}% of remaining creator earnings`
                          }
                        />
                      ))}
                    </Select>
                  </Field>
                  <p className="studio-help">
                    Remixes are isolated projects with immutable source
                    attribution. Choose 0% for free remixes. Royalties come from
                    creator earnings, never an extra player fee. Existing
                    inherited royalties remain.
                  </p>
                </div>
              </div>
              <div hidden={workspaceGroup !== 'team'}>
                {project && isOwner ? (
                  <div className="studio-section">
                    <div className="studio-section-label">
                      <Users size={13} />
                      Team access
                    </div>
                    <Field label="Commons user ID">
                      <Input
                        value={collaboratorId}
                        onChange={(event) =>
                          setCollaboratorId(event.target.value)
                        }
                        placeholder="user_…"
                      />
                    </Field>
                    <Field label="Permission">
                      <Select
                        ariaLabel="Permission"
                        value={collaboratorPermission}
                        onValueChange={(permission) =>
                          setCollaboratorPermission(
                            permission as typeof collaboratorPermission,
                          )
                        }
                      >
                        <SelectOption value="test" title="Can test" />
                        <SelectOption value="comment" title="Can comment" />
                        <SelectOption value="edit" title="Can edit" />
                      </Select>
                    </Field>
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
                      Your access: {myPermissions.join(', ') || 'view only'}.
                      Only the owner can publish or change team permissions.
                    </p>
                  </div>
                ) : null}
              </div>
              <div hidden={workspaceGroup !== 'project'}>
                <div className="studio-section">
                  <div className="studio-section-label">
                    <Settings2 size={13} />
                    Game properties
                  </div>
                  <Field label="Name">
                    <Input
                      value={document.title}
                      maxLength={100}
                      disabled={!canEdit}
                      onChange={(e) => update({ title: e.target.value })}
                    />
                  </Field>
                  <Field label="Description">
                    <Textarea
                      rows={3}
                      maxLength={1000}
                      value={document.description}
                      disabled={!canEdit}
                      onChange={(e) => update({ description: e.target.value })}
                    />
                  </Field>
                  {!isBrowserGame(document) && (
                    <>
                      {' '}
                      <div className="studio-field-pair">
                        <Field label="Board">
                          <Select
                            ariaLabel="Board"
                            value={String(document.boardSize)}
                            onValueChange={(value) => {
                              const n = Number(value)
                              update({
                                boardSize: n,
                                winLength: Math.min(
                                  n,
                                  !isBrowserGame(document)
                                    ? document.winLength
                                    : 3,
                                ),
                              })
                            }}
                          >
                            {[3, 4, 5, 6, 7, 8].map((n) => (
                              <SelectOption
                                key={n}
                                value={String(n)}
                                title={`${n} × ${n}`}
                              />
                            ))}
                          </Select>
                        </Field>
                        <Field label="In a row">
                          <Select
                            ariaLabel="In a row"
                            value={String(document.winLength)}
                            onValueChange={(value) =>
                              update({ winLength: Number(value) })
                            }
                          >
                            {Array.from(
                              { length: document.boardSize - 2 },
                              (_, i) => i + 3,
                            ).map((n) => (
                              <SelectOption
                                key={n}
                                value={String(n)}
                                title={String(n)}
                              />
                            ))}
                          </Select>
                        </Field>
                      </div>
                      <div className="studio-field-pair">
                        {[0, 1].map((i) => (
                          <Field key={i} label={`Player ${i + 1}`}>
                            <Input
                              value={
                                !isBrowserGame(document)
                                  ? document.marks[i]
                                  : ''
                              }
                              maxLength={3}
                              onChange={(e) => {
                                const marks: [string, string] = [
                                  ...(!isBrowserGame(document)
                                    ? document.marks
                                    : (['X', 'O'] as [string, string])),
                                ]
                                marks[i] =
                                  e.target.value || (i === 0 ? 'X' : 'O')
                                update({ marks })
                              }}
                            />
                          </Field>
                        ))}
                      </div>
                      <div className="studio-field-pair">
                        <Field label="Accent">
                          <Input
                            type="color"
                            value={document.accent}
                            onChange={(e) => update({ accent: e.target.value })}
                          />
                        </Field>
                        <Field label="Canvas">
                          <Input
                            type="color"
                            value={document.background}
                            onChange={(e) =>
                              update({ background: e.target.value })
                            }
                          />
                        </Field>
                      </div>
                    </>
                  )}
                  {isBrowserGame(document) && (
                    <p className="studio-help">
                      {document.files.length} source files · Browser game
                      <br />
                      Edit every file in Code, or describe a change to your
                      agent.
                    </p>
                  )}
                </div>
              </div>
              <div hidden={workspaceGroup !== 'testing'}>
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
                          <AgentSelect
                            agents={agents}
                            value={selectedAgents[i] ?? ''}
                            allowNone
                            noneLabel="Create a Commons agent"
                            ariaLabel={`Seat ${i + 1} agent`}
                            onChange={(id) =>
                              setSelectedAgents((ids) => {
                                const next: [string, string] = [...ids]
                                next[i] = id
                                return next
                              })
                            }
                          />
                        </label>
                      ))}
                      <Field label="Scenario seed">
                        <Input
                          value={seed}
                          onChange={(e) => setSeed(e.target.value)}
                          maxLength={200}
                        />
                      </Field>
                      <p className="studio-help">
                        Commons agents choose a bounded play policy. Every move
                        uses the same game rules.
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
                    <Field label="Players">
                      <Select
                        ariaLabel="Players"
                        value={String(browserControllers.length)}
                        disabled={!!browserRun}
                        onValueChange={(value) => {
                          const count = Number(value)
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
                          <SelectOption
                            value={String(count)}
                            key={count}
                            title={String(count)}
                          />
                        ))}
                      </Select>
                    </Field>
                    <div className="studio-controller-list">
                      {browserControllers.map((controller, index) => (
                        <div
                          className="studio-controller"
                          key={controller.seatId}
                        >
                          <div>
                            <strong>{controller.label}</strong>
                            {controller.strategyEpoch ? (
                              <small>Strategy {controller.strategyEpoch}</small>
                            ) : null}
                          </div>
                          {controller.performance ? (
                            <div className="studio-learning-summary">
                              <span>
                                {controller.performance.improving ? (
                                  <TrendingUp size={14} aria-hidden />
                                ) : (
                                  <ArrowRight size={14} aria-hidden />
                                )}{' '}
                                {controller.performance.feedbackSamples}{' '}
                                feedback samples
                              </span>
                              <span>
                                reward{' '}
                                {controller.performance.cumulativeReward >= 0
                                  ? '+'
                                  : ''}
                                {controller.performance.cumulativeReward.toFixed(
                                  1,
                                )}
                              </span>
                            </div>
                          ) : null}
                          {controller.policyMemory?.preferredDefense ? (
                            <small className="studio-learned-policy">
                              Learned defense:{' '}
                              {controller.policyMemory.preferredDefense}
                            </small>
                          ) : null}
                          <Select
                            ariaLabel={`${controller.label} controller`}
                            value={controller.kind}
                            disabled={!!browserRun}
                            onValueChange={(kind) =>
                              setBrowserControllers((current) =>
                                current.map((candidate, candidateIndex) =>
                                  candidateIndex === index
                                    ? {
                                        ...candidate,
                                        kind: kind as 'human' | 'agent',
                                        agentId: undefined,
                                        strategy:
                                          kind === 'human'
                                            ? 'Human controlled.'
                                            : 'Play to win, adapt to the opponent, and use only legal actions.',
                                      }
                                    : candidate,
                                ),
                              )
                            }
                          >
                            <SelectOption value="human" title="Human" />
                            <SelectOption value="agent" title="Agent" />
                          </Select>
                          {controller.kind === 'agent' ? (
                            <>
                              <AgentSelect
                                agents={agents}
                                ariaLabel={`${controller.label} agent`}
                                value={controller.agentId ?? ''}
                                disabled={!!browserRun}
                                allowNone
                                noneLabel="Create a player agent"
                                onChange={(id) =>
                                  setBrowserControllers((current) =>
                                    current.map((candidate, candidateIndex) =>
                                      candidateIndex === index
                                        ? {
                                            ...candidate,
                                            agentId: id || undefined,
                                          }
                                        : candidate,
                                    ),
                                  )
                                }
                              />
                              <Textarea
                                rows={2}
                                aria-label={`${controller.label} coaching`}
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
                                  disabled={
                                    !!busy || !controller.strategy.trim()
                                  }
                                  onClick={() =>
                                    void updateBrowserStrategy(
                                      controller,
                                      controller.strategy,
                                    ).catch((cause) =>
                                      setError(
                                        cause instanceof Error
                                          ? cause.message
                                          : String(cause),
                                      ),
                                    )
                                  }
                                >
                                  Coach agent
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
                                    disabled={
                                      !!busy ||
                                      browserPlaying ||
                                      reviewingBrowserRun
                                    }
                                    onClick={() =>
                                      void task('human move', () =>
                                        browserHumanDecision(
                                          controller,
                                          action.id,
                                        ),
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
                        disabled={
                          !!busy || !user || dirty || view !== 'preview'
                        }
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
                          disabled={
                            reviewingBrowserRun ||
                            (!realtimePreview && browserRun.step >= 200)
                          }
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
                            reviewingBrowserRun ||
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
                          setReviewingBrowserRun(false)
                          setBrowserRun(undefined)
                          setBrowserEvents([])
                          setBrowserObservation(undefined)
                          setBrowserAction(undefined)
                          setBrowserControllers(
                            defaultBrowserControllers(document),
                          )
                        }}
                      >
                        New session
                      </Button>
                    )}
                    <p className="studio-help">
                      Private, unrated and not prize eligible. Humans and agents
                      use the same legal controls. Timed sessions save
                      diagnostics for review; hosted matches support reconnects.{' '}
                      {realtimePreview
                        ? `${frameDecisions} local decisions · five-minute sessions · sampled diagnostics`
                        : `${browserRun?.step ?? 0} / 200 decisions.`}
                    </p>
                    {browserRuns.length ? (
                      <Field label="Session history">
                        <Select
                          ariaLabel="Session history"
                          placeholder="Choose a prior session"
                          value={browserRun?.id ?? ''}
                          disabled={!!busy}
                          onValueChange={(id) => {
                            const selected = browserRuns.find(
                              (run) => run.id === id,
                            )
                            if (selected)
                              void task('resume playtest', () =>
                                resumeBrowserRun(selected),
                              )
                          }}
                        >
                          {browserRuns.map((run) => (
                            <SelectOption
                              key={run.id}
                              value={run.id}
                              title={new Date(run.createdAt).toLocaleString()}
                              hint={
                                run.preview?.decisions
                                  ? `${run.preview.decisions} recorded decisions · ${run.preview.samples} samples`
                                  : `${run.step} moves`
                              }
                            />
                          ))}
                        </Select>
                      </Field>
                    ) : null}
                  </div>
                )}
              </div>
              <div hidden={workspaceGroup !== 'recordings'}>
                {project && (
                  <div className="studio-section">
                    <SwitchField
                      checked={shareRecordings}
                      onCheckedChange={setShareRecordings}
                      label="Share recordings"
                      hint="New recordings become visible to spectators."
                    />
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
              </div>
              <div
                hidden={workspaceGroup !== 'project'}
                className="studio-section"
              >
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
                  <Link href="/docs">
                    Authoring contract <ArrowUpRight size={14} aria-hidden />
                  </Link>
                </p>
              </div>
            </>
          )
        }
        right={
          rightOpen && (
            <>
              <div className="studio-tabs">
                <Tabs
                  value={right}
                  onValueChange={(next) => {
                    setRight(next as typeof right)
                    if (next === 'history' && project)
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
                  variant="underline"
                  ariaLabel="Assistant panel"
                >
                  <Tab value="copilot">Copilot</Tab>
                  <Tab value="sessions">Sessions</Tab>
                  <Tab value="notes" count={visibleNotes.length}>
                    Notes
                  </Tab>
                  <Tab value="history">Revisions</Tab>
                </Tabs>
                <div className="studio-tabs-actions">
                  <button
                    type="button"
                    title="New conversation"
                    aria-label="New conversation"
                    disabled={!!busy || copilot.loading || !copilotId}
                    onClick={() => {
                      setRight('copilot')
                      void copilot.create()
                    }}
                  >
                    <Plus size={15} />
                  </button>
                  <button
                    type="button"
                    aria-label="Copilot settings"
                    title="Copilot settings"
                    aria-pressed={right === 'settings'}
                    onClick={() =>
                      setRight(right === 'settings' ? 'copilot' : 'settings')
                    }
                  >
                    <Settings size={15} />
                  </button>
                </div>
              </div>
              {right === 'settings' ? (
                <CopilotSettings
                  copilot={copilot}
                  busy={!!busy}
                  onComputer={() => setComputerOpen(true)}
                />
              ) : right === 'sessions' ? (
                <CopilotSessionList
                  copilot={copilot}
                  agentId={copilotId}
                  busy={!!busy}
                  onOpen={() => setRight('copilot')}
                />
              ) : right === 'copilot' ? (
                <div className="studio-copilot">
                  <p className="copilot-session-name" title="Open conversation">
                    {copilotSessionTitle(copilot)}
                  </p>
                  <CopilotReview
                    copilot={copilot}
                    projectId={projectId}
                    busy={!!busy}
                    dirty={dirty}
                    onReviewing={(reviewing) => {
                      if (reviewing)
                        approvalDraft.current = currentDraft.current
                      setBusy(reviewing ? 'approval' : '')
                    }}
                    onApplied={async () => {
                      setPublicationRefresh((value) => value + 1)
                      const latest = await arcade<StudioProject>(
                        `projects/${projectId}`,
                      )
                      setProject(latest)
                      if (
                        currentDraft.current.document ===
                          approvalDraft.current.document &&
                        currentDraft.current.source ===
                          approvalDraft.current.source
                      ) {
                        setDocument(latest.document)
                        setSource(JSON.stringify(latest.document, null, 2))
                        setPreviewKey((key) => key + 1)
                        setNotice(`Saved revision ${latest.revision}.`)
                      } else
                        setNotice(
                          `Revision ${latest.revision} was saved. Your unsaved local edits have been kept; review them before saving.`,
                        )
                    }}
                  />
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
                            href={`https://agentcommons.io/sessions/${encodeURIComponent(m.sessionId)}`}
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
                    busy={!!busy || copilot.loading}
                    context={
                      project
                        ? `Revision ${project.revision} · ${visibleNotes.length} notes attached`
                        : 'Project context'
                    }
                    onSubmit={(attachments, model) => {
                      if (
                        !user ||
                        !prompt.trim() ||
                        !copilotId ||
                        copilot.loading ||
                        copilot.error
                      )
                        return
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
                      <Textarea
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
                      <Button
                        variant="ghost"
                        onClick={() => setDraft(undefined)}
                      >
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
                  {browserEvents.length}{' '}
                  {realtimePreview ? 'diagnostic samples' : 'decisions'} ·{' '}
                  {realtimePreview
                    ? 'frame-synchronized policy'
                    : 'model policy'}
                </span>
                <button
                  aria-label={
                    logsExpanded ? 'Restore preview' : 'Expand test logs'
                  }
                  title={logsExpanded ? 'Restore preview' : 'Expand test logs'}
                  onClick={() => setLogsExpanded(!logsExpanded)}
                >
                  {logsExpanded ? (
                    <Minimize2 size={14} />
                  ) : (
                    <Maximize2 size={14} />
                  )}
                </button>
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
                  Decisions, measured feedback, latency, and strategy changes
                  will appear here.
                </p>
              ) : null}
              {browserEvents.map((event, index) => (
                <BrowserEventRow
                  key={`${event.epoch ?? 'server'}:${event.step}`}
                  event={event}
                  index={index}
                  sampled={realtimePreview}
                />
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
                  <Select
                    ariaLabel="Filter diagnostics"
                    value={logFilter}
                    onValueChange={setLogFilter}
                  >
                    <SelectOption value="all" title="All events" />
                    <SelectOption
                      value="policy"
                      title="Observations & decisions"
                    />
                    <SelectOption value="runtime" title="Actions & state" />
                  </Select>
                  <button
                    aria-label={
                      logsExpanded ? 'Restore preview' : 'Expand test logs'
                    }
                    title={
                      logsExpanded ? 'Restore preview' : 'Expand test logs'
                    }
                    onClick={() => setLogsExpanded(!logsExpanded)}
                  >
                    {logsExpanded ? (
                      <Minimize2 size={14} />
                    ) : (
                      <Maximize2 size={14} />
                    )}
                  </button>
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
                Manage Commons credits <ArrowUpRight size={14} aria-hidden />
              </a>
            )}
            {notice.startsWith('Published.') && project?.releaseId && (
              <Link href={`/games/${project.id.replace('prj_', 'gam_')}`}>
                Open game <ArrowUpRight size={14} aria-hidden />
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
                showLeftPanel(true),
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
                    showRightPanel(true)
                  },
                  tool === 'point',
                )}
                {icon(
                  <Scan size={15} />,
                  'Region annotation',
                  () => {
                    setTool('region')
                    setRight('notes')
                    showRightPanel(true)
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
                  fullscreen ? (
                    <Minimize2 size={14} />
                  ) : (
                    <Maximize2 size={14} />
                  ),
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
              <StudioCodeEditor
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
              <StudioCodeEditor
                files={[{ path: 'game.json', content: source }]}
                onChange={(_path, content) => setSource(content)}
              />
            </div>
          )
        ) : (
          <div
            className="studio-preview-stage"
            ref={previewStageRef}
            style={{ backgroundSize: `${24 * zoom}px ${24 * zoom}px` }}
          >
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
                zoom,
                width: '100%',
                marginInline: 'auto',
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
                recordingLabels={{
                  start: (
                    <>
                      <Circle size={12} aria-hidden="true" /> Record interaction
                    </>
                  ),
                  stop: (
                    <>
                      <Square size={12} aria-hidden="true" /> Stop recording
                    </>
                  ),
                  dismissError: <X size={14} aria-hidden="true" />,
                }}
                key={previewKey}
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
                interactive={tool === 'select' && !reviewingBrowserRun}
                title={`${document.title} compiled game`}
                revision={`${previewKey}:${view}:${run?.steps ?? 0}`}
              />
              {browserRun && !isManagedBrowserGame(document) ? (
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
                  showRightPanel(true)
                }}
                onSelect={(a) => {
                  setRight('notes')
                  showRightPanel(true)
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
                      : `Session paused · ${realtimePreview ? frameDecisions : browserRun.step} decisions`
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
    </main>
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

const { enrich: enrichRealtimeState } = createBrowserPolicy()

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
