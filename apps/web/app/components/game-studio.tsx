'use client'
import { AccountMenu } from './account-menu'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
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
  RotateCcw,
  Save,
  Scan,
  Settings2,
  SkipForward,
  Sparkles,
  Upload,
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
  compilePresentation,
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
}
type BrowserEvent = {
  step: number
  seatId?: string
  observation: CanvasObservation
  decision: { actionId: string; reason: string }
  controller?: Pick<
    BrowserController,
    'kind' | 'agentId' | 'strategy' | 'strategyEpoch'
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
  const [shareRecordings, setShareRecordings] = useState(false),
    [recordingsRefresh, setRecordingsRefresh] = useState(0)
  const [browserRun, setBrowserRun] = useState<BrowserRun>()
  const [browserRuns, setBrowserRuns] = useState<BrowserRun[]>([])
  const [browserEvents, setBrowserEvents] = useState<BrowserEvent[]>([])
  const [browserObservation, setBrowserObservation] =
    useState<CanvasObservation>()
  const [browserPlaying, setBrowserPlaying] = useState(false)
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
    const seatObservation = {
      state: stateForSeat(observation.state, selected.seatId),
      actions: actionsForSeat(observation.actions, selected.seatId),
    }
    const event = await arcade<BrowserEvent>(
      `studio/browser-runs/${current.id}/decide`,
      {
        step: current.step,
        seatId: selected.seatId,
        observation: seatObservation,
      },
    )
    const nextObservation = await compiledRef.current.act(
      event.decision.actionId,
    )
    setBrowserObservation(nextObservation)
    setBrowserRun({ ...current, step: current.step + 1 })
    setBrowserEvents((all) => [...all, event])
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
  const load = useCallback(
    (p: StudioProject) => {
      setProject(p)
      setDocument(p.document)
      setSource(JSON.stringify(p.document, null, 2))
      setRun(undefined)
      setBrowserRun(undefined)
      setBrowserRuns([])
      setBrowserEvents([])
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
    if (declaredSeats.length < browserControllers.length)
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
    setBrowserObservation(initialObservation)
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
      'Private Test Arena session started. Human moves use the legal-action controls so the session stays resumable.',
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
  useEffect(() => {
    if (!browserPlaying || busy || !browserRun || browserRun.step >= 200) return
    const decisionsPerSecond = isBrowserGame(document)
      ? (document.play?.maxDecisionsPerSecond ?? 2)
      : 2
    const timer = setTimeout(
      () => {
        void task('agent move', browserDecision)
      },
      Math.max(250, Math.ceil(1000 / decisionsPerSecond)),
    )
    return () => clearTimeout(timer)
  }, [browserPlaying, busy, browserRun?.step, document])
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
          <div className="studio-toolbar-end">
            {user ? (
              <>
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
                      disabled={!!busy || browserRun.step >= 200}
                      onClick={() => setBrowserPlaying(!browserPlaying)}
                    >
                      {browserPlaying ? (
                        <Pause size={13} />
                      ) : (
                        <Play size={13} />
                      )}
                      {browserPlaying ? 'Pause agents' : 'Run agents'}
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={
                        !!busy || browserPlaying || browserRun.step >= 200
                      }
                      onClick={() => void task('agent move', browserDecision)}
                    >
                      <SkipForward size={13} /> One decision
                    </Button>
                  </div>
                )}
                {browserRun && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setBrowserPlaying(false)
                      setBrowserRun(undefined)
                      setBrowserEvents([])
                      setBrowserObservation(undefined)
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
        isBrowserGame(document) && browserEvents.length > 0 ? (
          <div className="studio-browser-events">
            <strong>
              Browser Test Arena · {browserRun?.controllers.length ?? 0} seats ·
              private / unrated
            </strong>
            {browserEvents.map((event) => (
              <details key={event.step}>
                <summary>
                  {event.step + 1}. {event.seatId ?? 'seat'} ·{' '}
                  {event.decision.actionId} · {event.decision.reason}
                </summary>
                <pre>
                  {JSON.stringify(
                    {
                      controller: event.controller,
                      observation: event.observation,
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
              interactive={tool === 'select' && !browserRun}
              title={`${document.title} compiled game`}
              revision={`${previewKey}:${view}:${run?.steps ?? 0}`}
            />
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

function stateForSeat(state: unknown, seatId: string): unknown {
  if (!state || typeof state !== 'object') return state
  const arcade = (state as Record<string, unknown>).arcade
  if (!arcade || typeof arcade !== 'object') return state
  const observations = (arcade as Record<string, unknown>).observations
  if (!observations || typeof observations !== 'object') return state
  return (observations as Record<string, unknown>)[seatId] ?? state
}

async function waitForPreview(
  ref: React.RefObject<CompiledFrameHandle | null>,
): Promise<CanvasObservation> {
  let lastError: unknown
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      if (!ref.current) throw new Error('The compiled preview is not mounted.')
      const observation = await ref.current.observe()
      if (seatsFromObservation(observation).length) return observation
      lastError = new Error('The game runtime is still loading.')
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('The compiled preview did not become ready.')
}
