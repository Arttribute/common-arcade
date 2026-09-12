'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { CommonsWindow } from '@agent-commons/ui'
import {
  ChevronRight,
  Code2,
  Cpu,
  FileText,
  Folder,
  Globe,
  Loader2,
  Moon,
  Play,
  RefreshCw,
  Settings2,
  Terminal,
  X,
} from 'lucide-react'
import './computer.css'

type Config = {
  enabled: boolean
  allowAgentStart: boolean
  allowBrowser: boolean
  allowTerminal: boolean
  allowFilesystem: boolean
  resourceProfile?: string
  idleTtlMinutes?: number
}
type Computer = {
  computerId: string
  name: string
  status: string
  workspaceRoot?: string | null
  workspaceSnapshot?: string | null
  errorMessage?: string | null
  browser?: {
    url?: string | null
    title?: string | null
    screenshot?: string | null
    status?: string
    error?: string | null
  } | null
  terminal?: { lastCommand?: string | null; lastOutput?: string | null } | null
}
type ComputerEvent = {
  eventId: string
  eventType: string
  summary?: string | null
  createdAt: string
}
type FileNode = {
  name: string
  path: string
  isDir: boolean
  children: FileNode[]
}
type App = 'files' | 'code' | 'browser' | 'terminal' | 'settings'

function snapshotTree(snapshot: string, root: string): FileNode[] {
  const tree: FileNode[] = []
  const stack: { node: FileNode; indent: number }[] = []
  for (const line of snapshot.split('\n').slice(1)) {
    const name = line.trim().replace(/\/$/, '')
    if (!name || name.includes('...')) continue
    const indent = line.length - line.trimStart().length
    while (stack.length && stack.at(-1)!.indent >= indent) stack.pop()
    const parent = stack.at(-1)?.node
    const node: FileNode = {
      name,
      path: `${(parent?.path ?? root).replace(/\/$/, '')}/${name}`,
      isDir: line.trim().endsWith('/'),
      children: [],
    }
    ;(parent?.children ?? tree).push(node)
    if (node.isDir) stack.push({ node, indent })
  }
  return tree
}

function FileTree({
  nodes,
  onOpen,
  selected,
}: {
  nodes: FileNode[]
  onOpen: (path: string) => void
  selected: string
}) {
  return (
    <ul className="computer-file-tree">
      {nodes.map((node) => (
        <li key={node.path}>
          {node.isDir ? (
            <details open>
              <summary>
                <ChevronRight size={12} className="computer-folder-chevron" />
                <Folder size={16} />
                {node.name}
              </summary>
              <FileTree
                nodes={node.children}
                onOpen={onOpen}
                selected={selected}
              />
            </details>
          ) : (
            <button
              type="button"
              className={selected === node.path ? 'is-selected' : ''}
              aria-current={selected === node.path ? 'true' : undefined}
              onClick={() => onOpen(node.path)}
              title={node.path}
            >
              <FileText size={16} />
              <span>{node.name}</span>
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}

export function AgentComputerPanel({
  agentId,
  active,
  onClose,
}: {
  agentId: string
  active: boolean
  onClose: () => void
}) {
  const [returnFocus] = useState(() =>
    typeof document === 'undefined' ? null : document.activeElement,
  )
  // Remount the surface when the selected agent changes so files and commands
  // from the previous agent can never be shown or sent to the next agent.
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="computer-overlay" />
        <Dialog.Content
          className="computer-panel"
          onCloseAutoFocus={(event) => {
            // The launcher is outside this controlled dialog's Root, so there
            // is no Radix Trigger to restore focus to automatically.
            if (returnFocus instanceof HTMLElement && returnFocus.isConnected) {
              event.preventDefault()
              returnFocus.focus()
            }
          }}
        >
          <ComputerSurface
            key={agentId}
            agentId={agentId}
            active={active}
            onClose={onClose}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function ComputerSurface({
  agentId,
  active,
  onClose,
}: {
  agentId: string
  active: boolean
  onClose: () => void
}) {
  const [config, setConfig] = useState<Config | null>(null)
  const [computer, setComputer] = useState<Computer | null>(null)
  const [events, setEvents] = useState<ComputerEvent[]>([])
  const [app, setApp] = useState<App>('files')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [pending, setPending] = useState('')
  const [url, setUrl] = useState('')
  const [command, setCommand] = useState('')
  const [filePath, setFilePath] = useState('')
  const [fileContent, setFileContent] = useState('')
  const [fileLoading, setFileLoading] = useState(false)
  const fileSequence = useRef(0)
  const mounted = useRef(true)
  const loadingStatus = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const api = useCallback(
    async (suffix = '', method = 'GET', body?: unknown) => {
      const response = await fetch(
        `/api/agent-computer/agents/${encodeURIComponent(agentId)}/computer${suffix}`,
        {
          method,
          cache: 'no-store',
          ...(body === undefined
            ? {}
            : {
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
              }),
        },
      )
      const payload = await response.json()
      if (!response.ok) {
        const message =
          payload?.error?.message ?? payload?.error ?? payload?.message
        throw new Error(
          typeof message === 'string'
            ? message
            : 'Could not reach the agent computer',
        )
      }
      return payload.data
    },
    [agentId],
  )

  const load = useCallback(async () => {
    if (!agentId || loadingStatus.current) {
      if (!agentId) setLoading(false)
      return
    }
    loadingStatus.current = true
    try {
      const [nextConfig, data] = await Promise.all([api('/config'), api()])
      if (!mounted.current) return
      setConfig(nextConfig)
      const candidate = data?.computer ?? data
      setComputer(candidate?.computerId ? candidate : null)
      setLoadError('')
    } catch (err) {
      if (mounted.current)
        setLoadError(
          err instanceof Error ? err.message : 'Could not load computer',
        )
    } finally {
      loadingStatus.current = false
      if (mounted.current) setLoading(false)
    }
  }, [agentId, api])

  useEffect(() => {
    void load()
    // This is computer telemetry, never the Arcade gameplay transport.
    const timer = window.setInterval(
      () => {
        if (!document.hidden) void load()
      },
      active ? 2500 : 6000,
    )
    return () => window.clearInterval(timer)
  }, [load, active])
  useEffect(() => {
    setUrl(computer?.browser?.url ?? '')
  }, [computer?.browser?.url])
  useEffect(() => {
    if (app !== 'terminal' || !computer?.computerId) return
    let cancelled = false
    const refresh = async () => {
      try {
        const data = await api('/events?limit=80')
        if (!cancelled) setEvents(Array.isArray(data) ? data : [])
      } catch (err) {
        if (!cancelled)
          setError(
            err instanceof Error
              ? err.message
              : 'Could not load computer activity',
          )
      }
    }
    void refresh()
    const timer = window.setInterval(() => {
      if (!document.hidden) void refresh()
    }, 5000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [api, app, computer?.computerId])

  const perform = async (
    name: string,
    suffix: string,
    method = 'POST',
    body?: unknown,
  ) => {
    if (pending) return false
    setPending(name)
    setError('')
    try {
      await api(suffix, method, body)
      await load()
      return true
    } catch (err) {
      if (mounted.current)
        setError(err instanceof Error ? err.message : `${name} failed`)
      return false
    } finally {
      if (mounted.current) setPending('')
    }
  }
  const openFile = async (path: string) => {
    const sequence = ++fileSequence.current
    setFilePath(path)
    setFileContent('')
    setFileLoading(true)
    setApp('code')
    setError('')
    try {
      const data = await api(`/files/read?path=${encodeURIComponent(path)}`)
      if (mounted.current && sequence === fileSequence.current)
        setFileContent(data?.content ?? '')
    } catch (err) {
      if (mounted.current && sequence === fileSequence.current)
        setError(err instanceof Error ? err.message : 'Could not read file')
    } finally {
      if (mounted.current && sequence === fileSequence.current)
        setFileLoading(false)
    }
  }
  const usable = Boolean(
    config?.enabled &&
    computer &&
    ['running', 'idle'].includes(computer.status),
  )
  const transitioning = Boolean(
    computer &&
    ['provisioning', 'starting', 'restarting', 'resizing', 'stopping'].includes(
      computer.status,
    ),
  )
  const tree = useMemo(
    () =>
      snapshotTree(
        computer?.workspaceSnapshot ?? '',
        computer?.workspaceRoot ?? '/mnt/shared',
      ),
    [computer?.workspaceSnapshot, computer?.workspaceRoot],
  )
  const apps = [
    {
      id: 'files' as const,
      label: 'Files',
      icon: Folder,
      enabled: config?.allowFilesystem !== false,
    },
    {
      id: 'code' as const,
      label: 'Code',
      icon: Code2,
      enabled: config?.allowFilesystem !== false,
    },
    {
      id: 'browser' as const,
      label: 'Browser',
      icon: Globe,
      enabled: config?.allowBrowser !== false,
    },
    {
      id: 'terminal' as const,
      label: 'Terminal',
      icon: Terminal,
      enabled: config?.allowTerminal !== false,
    },
    {
      id: 'settings' as const,
      label: 'Settings',
      icon: Settings2,
      enabled: true,
    },
  ]
  const available = apps.find((item) => item.id === app)?.enabled
  const status = loading
    ? 'Connecting…'
    : !config?.enabled
      ? 'Disabled'
      : (computer?.status?.replaceAll('_', ' ') ?? 'Not started')
  return (
    <>
      <header className="computer-panel-header">
        <Cpu size={20} />
        <div>
          <Dialog.Title>Agent computer</Dialog.Title>
          <Dialog.Description>
            Your agent’s persistent Commons workspace.
          </Dialog.Description>
        </div>
        <button
          type="button"
          className="computer-icon-button"
          title="Close computer"
          aria-label="Close computer"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </header>
      <div className="computer-power-bar">
        <span
          className={`computer-status ${usable ? 'is-running' : ''}`}
          role="status"
        >
          <i />
          {status}
        </span>
        <span className="computer-power-spacer" />
        <button
          type="button"
          className="computer-icon-button"
          title="Refresh status"
          aria-label="Refresh computer status"
          onClick={() => void load()}
          disabled={loading || Boolean(pending)}
        >
          <RefreshCw size={16} />
        </button>
        {config?.enabled && !usable && (
          <button
            type="button"
            className="computer-primary"
            disabled={Boolean(pending) || transitioning}
            onClick={() => void perform('Starting', '/wake')}
          >
            {pending === 'Starting' ? (
              <Loader2 size={16} />
            ) : (
              <Play size={16} />
            )}
            Start
          </button>
        )}
        {usable && (
          <>
            <button
              type="button"
              disabled={Boolean(pending)}
              onClick={() => void perform('Sleeping', '/sleep')}
            >
              <Moon size={16} />
              Sleep
            </button>
            <button
              type="button"
              className="computer-icon-button"
              aria-label="Restart computer"
              title="Restart computer"
              disabled={Boolean(pending)}
              onClick={() => void perform('Restarting', '/restart')}
            >
              <RefreshCw size={16} />
            </button>
          </>
        )}
      </div>
      {(error || loadError) && (
        <div className="computer-error" role="alert">
          {error || loadError}
        </div>
      )}
      {computer?.errorMessage && !error && !loadError && (
        <div className="computer-error" role="alert">
          {computer.errorMessage}
        </div>
      )}
      {pending && (
        <div className="computer-progress" role="status">
          <Loader2 size={14} />
          {pending}…
        </div>
      )}
      <nav className="computer-dock" aria-label="Computer apps">
        {apps.map(({ id, label, icon: Icon, enabled }) => (
          <button
            key={id}
            type="button"
            aria-pressed={app === id}
            disabled={!enabled}
            onClick={() => setApp(id)}
            title={
              !enabled ? `${label} is disabled in Commons settings` : label
            }
          >
            <Icon size={18} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <main className="computer-desktop">
        {loading ? (
          <div className="computer-empty">
            <Loader2 size={28} />
            <p>Connecting to your computer…</p>
          </div>
        ) : !agentId ? (
          <div className="computer-empty">
            <Cpu size={32} />
            <h3>Select a Copilot agent</h3>
            <p>Choose your agent in Copilot to access its computer.</p>
          </div>
        ) : app === 'settings' ? (
          <CommonsWindow title="Computer settings">
            <div className="computer-settings">
              <h3>Workspace access</h3>
              <p>These settings are shared with your agent in Commons.</p>
              {config ? (
                <>
                  <label>
                    <span>Enable computer</span>
                    <input
                      type="checkbox"
                      checked={config.enabled}
                      disabled={Boolean(pending)}
                      onChange={(event) =>
                        void perform('Saving settings', '/config', 'PUT', {
                          enabled: event.target.checked,
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>Allow this agent to start its computer</span>
                    <input
                      type="checkbox"
                      checked={config.allowAgentStart !== false}
                      disabled={Boolean(pending)}
                      onChange={(event) =>
                        void perform('Saving settings', '/config', 'PUT', {
                          allowAgentStart: event.target.checked,
                        })
                      }
                    />
                  </label>
                  <dl>
                    <dt>Resources</dt>
                    <dd>{config.resourceProfile ?? 'Standard'}</dd>
                    <dt>Sleep after inactivity</dt>
                    <dd>{config.idleTtlMinutes ?? 60} minutes</dd>
                  </dl>
                  <p>
                    Copilot’s editing approval applies to game revisions.
                    Commands you run here execute directly on the agent’s
                    computer.
                  </p>
                  <a
                    href={`https://agentcommons.io/studio/agents/${encodeURIComponent(agentId)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Manage agent in Commons <ChevronRight size={14} />
                  </a>
                </>
              ) : (
                <p>Settings could not be loaded. Refresh to try again.</p>
              )}
            </div>
          </CommonsWindow>
        ) : !config?.enabled ? (
          <div className="computer-empty">
            <Cpu size={36} />
            <h3>A workspace for your agent</h3>
            <p>
              Browse files, inspect code and follow browser and terminal
              activity across Copilot sessions.
            </p>
            {config && (
              <button
                type="button"
                className="computer-primary"
                disabled={Boolean(pending)}
                onClick={() =>
                  void perform('Enabling computer', '/config', 'PUT', {
                    enabled: true,
                  })
                }
              >
                Enable computer
              </button>
            )}
            <small>Uses your Agent Commons compute plan.</small>
          </div>
        ) : !usable ? (
          <div className="computer-empty">
            <Cpu size={36} />
            <h3>
              {transitioning
                ? 'Computer is getting ready'
                : 'Your workspace is asleep'}
            </h3>
            <p>
              {transitioning
                ? 'Its status will update here automatically.'
                : 'Start the computer to open files, use the browser and run commands.'}
            </p>
            {!transitioning && (
              <button
                type="button"
                className="computer-primary"
                disabled={Boolean(pending)}
                onClick={() => void perform('Starting', '/wake')}
              >
                <Play size={16} />
                Start computer
              </button>
            )}
          </div>
        ) : !available ? (
          <div className="computer-empty">
            <p>This app is disabled in your agent’s Commons settings.</p>
          </div>
        ) : (
          <CommonsWindow
            title={
              app === 'browser'
                ? computer?.browser?.title || 'Browser'
                : app === 'terminal'
                  ? 'Terminal'
                  : app === 'code'
                    ? filePath.split('/').at(-1) || 'Code'
                    : 'Files'
            }
            tone={app === 'terminal' ? 'dark' : 'light'}
          >
            {(app === 'files' || app === 'code') && (
              <div
                className={`computer-files ${app === 'code' ? 'with-code' : ''}`}
              >
                <aside>
                  <div
                    className="computer-path"
                    title={computer?.workspaceRoot ?? '/mnt/shared'}
                  >
                    {computer?.workspaceRoot ?? '/mnt/shared'}
                  </div>
                  {tree.length ? (
                    <FileTree
                      nodes={tree}
                      onOpen={(path) => void openFile(path)}
                      selected={filePath}
                    />
                  ) : (
                    <p className="computer-file-empty">
                      No files in the workspace yet.
                    </p>
                  )}
                </aside>
                {app === 'code' && (
                  <div className="computer-code">
                    <header title={filePath}>
                      {filePath || 'Select a file'}
                      {filePath && (
                        <button
                          type="button"
                          className="computer-icon-button"
                          title="Reload file"
                          aria-label="Reload file"
                          disabled={fileLoading}
                          onClick={() => void openFile(filePath)}
                        >
                          <RefreshCw size={14} />
                        </button>
                      )}
                    </header>
                    {fileLoading ? (
                      <div className="computer-empty">Reading file…</div>
                    ) : (
                      <pre>
                        <code>
                          {filePath
                            ? fileContent
                            : 'Choose a file to inspect its contents. Ask Copilot to make changes.'}
                        </code>
                      </pre>
                    )}
                  </div>
                )}
              </div>
            )}
            {app === 'browser' && (
              <div className="computer-browser">
                <form
                  className="computer-address"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void perform('Opening page', '/browser/open', 'POST', {
                      url: url.trim(),
                    })
                  }}
                >
                  <Globe size={16} />
                  <input
                    aria-label="Browser URL"
                    type="url"
                    placeholder="https://example.com"
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    required
                  />
                  <button
                    type="submit"
                    disabled={Boolean(pending) || !url.trim()}
                  >
                    Open
                  </button>
                </form>
                <div className="computer-browser-viewport">
                  {computer?.browser?.screenshot ? (
                    <img
                      src={computer.browser.screenshot}
                      alt="Latest agent browser viewport"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="computer-empty">
                      <Globe size={32} />
                      <p>
                        {computer?.browser?.status === 'starting'
                          ? 'Browser is opening…'
                          : 'Open a page to see the browser viewport.'}
                      </p>
                    </div>
                  )}
                </div>
                <footer>
                  {computer?.browser?.error ||
                    'Latest captured viewport · updated with agent activity'}
                </footer>
              </div>
            )}
            {app === 'terminal' && (
              <div className="computer-terminal">
                <div
                  className="computer-terminal-output"
                  role="log"
                  aria-label="Terminal output"
                >
                  {computer?.terminal?.lastCommand && (
                    <pre>
                      <span>$ {computer.terminal.lastCommand}</span>
                      {'\n'}
                      {computer.terminal.lastOutput}
                    </pre>
                  )}
                  {!computer?.terminal?.lastCommand && (
                    <p>Commands and agent activity appear here.</p>
                  )}
                  {events.length > 0 && (
                    <details>
                      <summary>
                        <ChevronRight size={12} aria-hidden="true" />
                        Recent activity · {events.length}
                      </summary>
                      {events.map((item) => (
                        <p key={item.eventId}>
                          <time dateTime={item.createdAt}>
                            {new Date(item.createdAt).toLocaleTimeString()}
                          </time>{' '}
                          {item.summary || item.eventType}
                        </p>
                      ))}
                    </details>
                  )}
                </div>
                <form
                  onSubmit={(event) => {
                    event.preventDefault()
                    void perform('Running command', '/commands', 'POST', {
                      command: command.trim(),
                      timeoutSeconds: 90,
                    }).then((ok) => {
                      if (ok) setCommand('')
                    })
                  }}
                >
                  <label htmlFor="computer-command">$</label>
                  <input
                    id="computer-command"
                    aria-label="Terminal command (runs directly)"
                    autoComplete="off"
                    placeholder="Run a command…"
                    value={command}
                    onChange={(event) => setCommand(event.target.value)}
                  />
                  <button
                    type="submit"
                    disabled={Boolean(pending) || !command.trim()}
                  >
                    Run
                  </button>
                </form>
                <footer>
                  Commands run directly. Game revision approvals are managed in
                  Copilot.
                </footer>
              </div>
            )}
          </CommonsWindow>
        )}
      </main>
    </>
  )
}
