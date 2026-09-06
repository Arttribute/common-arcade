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
  MessageSquare,
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
import { arcade, arcadeCopilot } from '../../lib/api'
import { RecordingShelf, storeRecording } from './recording-shelf'

type Agent = { agentId: string; name: string }
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
type Proposal = {
  summary: string
  document: GameDocument
  baseRevision: number
  agentId: string
}
export function GameStudio({ projectId }: { projectId: string }) {
  const router = useRouter()
  const compiledRef = useRef<CompiledFrameHandle>(null)
  const annotationContext = useRef<Promise<unknown> | undefined>(undefined)
  const [shareRecordings, setShareRecordings] = useState(false),
    [recordingsRefresh, setRecordingsRefresh] = useState(0)
  const [browserRun, setBrowserRun] = useState<{
    id: string
    step: number
    revision: number
  }>()
  const [browserEvents, setBrowserEvents] = useState<
    {
      step: number
      observation: CanvasObservation
      decision: { actionId: string; reason: string }
    }[]
  >([])
  async function browserDecision() {
    if (!project || dirty)
      throw new Error('Save the project before running a browser playtest.')
    if (!compiledRef.current)
      throw new Error('Open Preview to playtest the game.')
    const current =
      browserRun ??
      (await arcade<{ id: string; step: number; revision: number }>(
        `projects/${project.id}/browser-runs`,
        { agentId: selectedAgents[0] || copilotId },
      ))
    if (current.revision !== project.revision)
      throw new Error('Start a new playtest for this revision.')
    const observation = await compiledRef.current.observe()
    const event = await arcade<{
      step: number
      observation: CanvasObservation
      decision: { actionId: string; reason: string }
    }>(`studio/browser-runs/${current.id}/decide`, {
      step: current.step,
      observation,
    })
    await compiledRef.current.act(event.decision.actionId)
    setBrowserRun({ ...current, step: current.step + 1 })
    setBrowserEvents((all) => [...all, event])
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
  const [prompt, setPrompt] = useState(''),
    [proposal, setProposal] = useState<Proposal>()
  const [messages, setMessages] = useState<
    { role: 'user' | 'assistant'; text: string }[]
  >([])
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
  const load = useCallback((p: StudioProject) => {
    setProject(p)
    setDocument(p.document)
    setSource(JSON.stringify(p.document, null, 2))
    setRun(undefined)
    setBrowserRun(undefined)
    setBrowserEvents([])
    setPlaying(false)
    setProposal(undefined)
    setMessages([])
    setDraft(undefined)
    window.history.replaceState(null, '', `/studio/${p.id}`)
  }, [])
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
  const board = run?.replay.checkpoints.at(-1)?.state as
    { board?: (string | null)[] } | undefined
  const previewDocument = view === 'test' && run ? run.document : document
  const html = useMemo(() => {
    try {
      return compilePresentation(
        previewDocument,
        view === 'test' ? board : undefined,
        view !== 'test',
      )
    } catch {
      return null
    }
  }, [previewDocument, view, board])
  const logs = (run?.diagnostics ?? []) as unknown as Log[]
  const visibleNotes =
    project?.annotations.filter(
      (a) =>
        a.revision ===
        (view === 'test' && run ? run.revision : project.revision),
    ) ?? []
  /**
   * One copilot turn: the request goes out, the finished game comes back and is
   * saved straight away. Creating a game is a single run, so the creator lands
   * on a playable revision rather than on a proposal they must accept first.
   */
  const runCopilot = useCallback(
    async (
      message: string,
      attachments: { fileId: string }[] = [],
      model?: { provider: string; modelId: string },
    ) =>
      task('copilot', async () => {
        const p = !project || dirty ? await save() : project
        setMessages((m) => [...m, { role: 'user', text: message }])
        const result = (await arcadeCopilot(
          p.id,
          { message, agentId: copilotId, attachments, model },
          { onWait: setElapsed },
        )) as Proposal
        setElapsed(0)
        setMessages((m) => [...m, { role: 'assistant', text: result.summary }])
        if (result.baseRevision === p.revision) {
          await save(result.document)
          setProposal(undefined)
          setView('preview')
        } else {
          // The project moved while the agent worked; let the creator decide.
          setProposal(result)
        }
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
                  Browser playtest
                </div>
                <label>
                  Player
                  <select
                    value={selectedAgents[0]}
                    onChange={(e) =>
                      setSelectedAgents([e.target.value, selectedAgents[1]])
                    }
                  >
                    <option value="">Arcade Copilot</option>
                    {agents.map((a) => (
                      <option value={a.agentId} key={a.agentId}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  disabled={
                    !!busy ||
                    !user ||
                    dirty ||
                    view !== 'preview' ||
                    (browserRun?.step ?? 0) >= 20
                  }
                  onClick={() => void task('agent playtest', browserDecision)}
                >
                  Run one agent action
                </Button>
                {browserRun && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setBrowserRun(undefined)
                      setBrowserEvents([])
                    }}
                  >
                    New playtest
                  </Button>
                )}
                <p className="studio-help">
                  Agent decisions use the current browser observation.{' '}
                  {browserRun?.step ?? 0} / 20 actions.
                </p>
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
                      <p>{m.text}</p>
                    </div>
                  ))}
                  {busy === 'copilot' && (
                    <div className="studio-thinking" role="status">
                      {elapsed > 4
                        ? `Building your game… ${elapsed}s`
                        : 'Building your game…'}
                    </div>
                  )}
                  {proposal && (
                    <div className="studio-proposal">
                      <span>
                        <Check size={13} />
                        Validated game proposal
                      </span>
                      <p>{proposal.summary}</p>
                      <Button
                        variant="primary"
                        disabled={
                          !!busy || proposal.baseRevision !== project?.revision
                        }
                        onClick={() =>
                          void task('save', async () => {
                            await save(proposal.document)
                            setProposal(undefined)
                            setView('preview')
                            setNotice(
                              'Copilot changes saved as a new revision.',
                            )
                          })
                        }
                      >
                        Apply changes
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => setProposal(undefined)}
                      >
                        Dismiss
                      </Button>
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
            <strong>Browser playtest · client observations</strong>
            {browserEvents.map((event) => (
              <details key={event.step}>
                <summary>
                  {event.step + 1}. {event.decision.actionId} ·{' '}
                  {event.decision.reason}
                </summary>
                <pre>{JSON.stringify(event.observation, null, 2)}</pre>
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
        <div className="studio-preview-stage">
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
                html
                  ? { type: 'html', html }
                  : {
                      type: 'unavailable',
                      error:
                        'The source could not compile. Check the entry file and local imports, or ask your copilot to fix the project.',
                    }
              }
              interactive={tool === 'select'}
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
