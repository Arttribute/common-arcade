'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
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
} from '@agent-commons/ui'
import {
  compilePresentation,
  gameDocumentSchema,
  starterDocument,
  type GameDocument,
  type StudioProject,
  type StudioRelease,
} from '@common-arcade/studio'
import type { TestRun } from '@common-arcade/control-client'
import { arcade } from '../../lib/api'

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
export function GameStudio() {
  const [user, setUser] = useState<{ id: string; name: string } | null>(null)
  const [project, setProject] = useState<StudioProject>()
  const [projects, setProjects] = useState<StudioProject[]>([])
  const [document, setDocument] = useState<GameDocument>(starterDocument)
  const [source, setSource] = useState(JSON.stringify(starterDocument, null, 2))
  const [view, setView] = useState<'preview' | 'code' | 'test'>('preview')
  const [right, setRight] = useState<'copilot' | 'notes' | 'history'>('copilot')
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
      (view === 'code' && source !== JSON.stringify(document, null, 2))
    : false
  const load = useCallback((p: StudioProject) => {
    setProject(p)
    setDocument(p.document)
    setSource(JSON.stringify(p.document, null, 2))
    setRun(undefined)
    setPlaying(false)
    setProposal(undefined)
    setMessages([])
    setDraft(undefined)
    window.history.replaceState(null, '', `/studio?project=${p.id}`)
  }, [])
  useEffect(() => {
    let active = true
    void fetch('/api/auth/session')
      .then((r) => r.json())
      .then(async (s) => {
        if (!active) return
        setUser(s.user)
        if (!s.user) {
          if (new URLSearchParams(window.location.search).has('authError'))
            setError(
              'Commons sign-in could not finish. Please try signing in again.',
            )
          return
        }
        const result = await arcade<{ projects: StudioProject[] }>('projects')
        if (!active) return
        setProjects(result.projects)
        const target = new URLSearchParams(window.location.search).get(
          'project',
        )
        const p =
          result.projects.find((p) => p.id === target) ?? result.projects[0]
        if (p) load(p)
        const a = await arcade<{ agents: Agent[] | { agents: Agent[] } }>(
          'commons/agents',
        )
        if (active)
          setAgents(
            Array.isArray(a.agents) ? a.agents : (a.agents.agents ?? []),
          )
      })
      .catch((e) => {
        if (active) setError(e.message)
      })
    return () => {
      active = false
    }
  }, [load])
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
    next = view === 'code'
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
    window.history.replaceState(null, '', `/studio?project=${p.id}`)
    return p
  }
  function update(patch: Partial<GameDocument>) {
    setPlaying(false)
    setDocument((d) => {
      const next = { ...d, ...patch }
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
  const title = project?.document.title ?? 'New game'
  const icon = (
    node: React.ReactNode,
    label: string,
    action: () => void,
    active = false,
  ) => (
    <button
      className={`studio-icon ${active ? 'is-active' : ''}`}
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={action}
    >
      {node}
    </button>
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
                  if (p) load(p)
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
                  setProject(undefined)
                  setDocument(starterDocument)
                  setSource(JSON.stringify(starterDocument, null, 2))
                  setRun(undefined)
                  setPlaying(false)
                  window.history.replaceState(null, '', '/studio')
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
              <div className="studio-field-pair">
                <label>
                  Board
                  <select
                    value={document.boardSize}
                    onChange={(e) => {
                      const n = Number(e.target.value)
                      update({
                        boardSize: n,
                        winLength: Math.min(n, document.winLength),
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
                      value={document.marks[i]}
                      maxLength={3}
                      onChange={(e) => {
                        const marks: [string, string] = [...document.marks]
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
            </div>
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
                Commons agents choose a bounded play policy. Every move uses the
                same game rules.
              </p>
            </div>
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
                <select
                  aria-label="Copilot agent"
                  value={copilotId}
                  onChange={(e) => setCopilotId(e.target.value)}
                >
                  <option value="">Create my Arcade Copilot</option>
                  {agents.map((a) => (
                    <option key={a.agentId} value={a.agentId}>
                      {a.name}
                    </option>
                  ))}
                </select>
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
                            'Make this a five by five game where four in a row wins. Give it a calm blue palette and a fitting name.',
                          )
                        }
                      >
                        A bigger board, a new strategy <ArrowUp size={12} />
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
                    <div className="studio-thinking">
                      <Loader2 size={14} className="spin" />
                      Reading the revision and preparing a proposal…
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
                <form
                  className="studio-prompt"
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (!user || !prompt.trim()) return
                    void task('copilot', async () => {
                      const p = !project || dirty ? await save() : project
                      const agentId =
                        copilotId ||
                        (await ensureAgent('copilot', 'Arcade Copilot'))
                      setCopilotId(agentId)
                      const message = prompt
                      setPrompt('')
                      setMessages((m) => [
                        ...m,
                        { role: 'user', text: message },
                      ])
                      const result = await arcade<Proposal>(
                        `projects/${p.id}/copilot`,
                        { message, agentId },
                      )
                      setProposal(result)
                      setMessages((m) => [
                        ...m,
                        { role: 'assistant', text: result.summary },
                      ])
                    })
                  }}
                >
                  <textarea
                    aria-label="Message Arcade Copilot"
                    placeholder={
                      user
                        ? 'What should we create or change?'
                        : 'Sign in to create with your agent'
                    }
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    maxLength={8000}
                    rows={3}
                  />
                  <div>
                    <span>
                      {project
                        ? `Revision ${project.revision} attached`
                        : 'Game context attached'}
                    </span>
                    <button
                      aria-label="Send to copilot"
                      disabled={!user || !!busy || !prompt.trim()}
                    >
                      <ArrowUp size={15} />
                    </button>
                  </div>
                </form>
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
                    Start a test to inspect agent observations, policy decisions
                    and accepted actions.
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
              href="https://app.agentcommons.io/settings/billing"
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
          {(['preview', 'code', 'test'] as const).map((v) => (
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
              {icon(<RotateCcw size={14} />, 'Restart preview', () =>
                setPreviewKey((k) => k + 1),
              )}
            </>
          )}
        </div>
      </div>
      {view === 'code' ? (
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
      ) : (
        <div className="studio-preview-stage">
          <div className="studio-preview-meta">
            <span>
              {view === 'test'
                ? `Test run · revision ${run?.revision ?? '—'}`
                : 'Compiled game preview'}
            </span>
            <span>
              {document.boardSize} × {document.boardSize} · Turn based
            </span>
          </div>
          <div className="studio-preview-frame">
            <CompiledArtifactFrame
              preview={
                html
                  ? { type: 'html', html }
                  : {
                      type: 'unavailable',
                      error:
                        'Complete the game properties to compile a preview. Names and player marks must be non-empty and each player needs a different mark.',
                    }
              }
              title={`${document.title} compiled game`}
              revision={`${previewKey}:${view}:${run?.steps ?? 0}`}
            />
            <AnnotationLayer
              tool={view === 'test' ? 'select' : tool}
              notes={visibleNotes}
              onCreate={(g) => {
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
