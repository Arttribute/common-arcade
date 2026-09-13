'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { MessageSquare, ShieldCheck, Monitor, Check, X } from 'lucide-react'
import { arcade, ArcadeApiError } from '../../lib/api'
import { Select, SelectOption } from './ui/select'
import { SwitchField } from './ui/switch'
import { Field } from './ui/field'

type Message = { role: 'user' | 'assistant'; text: string; sessionId?: string }
type Conversation = {
  sessionId: string
  agentId: string
  title?: string
  createdAt: string
  activeJobId?: string
  messages?: Message[]
}
type Change = {
  id: string
  sessionId: string
  tool: string
  args: unknown
  baseRevision: number
  status: string
  result?: { error?: string }
}
export type ApprovalMode = 'manual' | 'automatic' | 'read-only'

export function useProjectCopilot(
  projectId: string,
  agentId: string,
  onMessages: (messages: Message[]) => void,
) {
  const [sessions, setSessions] = useState<Conversation[]>([])
  const [sessionId, setSessionId] = useState('')
  const [changes, setChanges] = useState<Change[]>([])
  const [loading, setLoading] = useState(true)
  const [activeJobId, setActiveJobId] = useState('')
  const [recoveredRevision, setRecoveredRevision] = useState(0)
  const [error, setError] = useState('')
  const [jobError, setJobError] = useState('')
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>('manual')
  const [computerEnabled, setComputerEnabled] = useState(false)
  const storageKey = `arcade-copilot:${projectId}:${agentId}`
  const rememberSession = useCallback(
    (id: string) => {
      setSessionId(id)
      try {
        sessionStorage.setItem(storageKey, id)
      } catch {}
    },
    [storageKey],
  )
  const generation = useRef(0)
  const messages = useRef(onMessages)
  messages.current = onMessages
  const refresh = useCallback(async () => {
    const current = generation.current
    const [history, proposals] = await Promise.all([
      arcade<{ sessions: Conversation[] }>(
        `projects/${projectId}/copilot-sessions`,
      ),
      arcade<{ changes: Change[] }>(`projects/${projectId}/copilot-changes`),
    ])
    if (current !== generation.current) return
    setSessions(history.sessions)
    setChanges(proposals.changes)
  }, [projectId])
  const choose = useCallback(
    async (id = '') => {
      const current = ++generation.current
      setLoading(true)
      setError('')
      setJobError('')
      try {
        let selected = id
        if (!selected) {
          try {
            selected = sessionStorage.getItem(storageKey) ?? ''
          } catch {}
        }
        const read = (session: string) =>
          arcade<Conversation>(
            `projects/${projectId}/copilot-session?agentId=${encodeURIComponent(agentId)}${session ? `&sessionId=${encodeURIComponent(session)}` : ''}`,
          )
        const conversation = await read(selected).catch(async (cause) => {
          if (
            !id &&
            selected &&
            cause instanceof ArcadeApiError &&
            cause.status === 404
          ) {
            try {
              sessionStorage.removeItem(storageKey)
            } catch {}
            return read('')
          }
          throw cause
        })
        if (current !== generation.current) return
        rememberSession(conversation.sessionId ?? '')
        setActiveJobId(conversation.activeJobId ?? '')
        messages.current(
          (conversation.messages ?? []).map((message) => ({
            ...message,
            sessionId: conversation.sessionId,
          })),
        )
        await refresh()
      } catch (cause) {
        if (current === generation.current)
          setError(
            cause instanceof Error
              ? cause.message
              : 'Could not load conversation.',
          )
      } finally {
        if (current === generation.current) setLoading(false)
      }
    },
    [projectId, agentId, refresh, storageKey, rememberSession],
  )
  useEffect(() => {
    setSessionId('')
    setActiveJobId('')
    setRecoveredRevision(0)
    messages.current([])
    setSessions([])
    setChanges([])
    if (agentId) void choose()
    return () => {
      generation.current++
    }
  }, [choose, agentId])
  useEffect(() => {
    if (!activeJobId) return
    let canceled = false
    let timer: ReturnType<typeof setTimeout>
    const current = generation.current
    async function poll() {
      try {
        const job = await arcade<{
          status: string
          projectRevision?: number
          error?: string
        }>(`studio/copilot-jobs/${activeJobId}`)
        if (canceled || current !== generation.current) return
        if (job.status === 'running') {
          timer = setTimeout(poll, 2000)
          return
        }
        const conversation = await arcade<Conversation>(
          `projects/${projectId}/copilot-session?agentId=${encodeURIComponent(agentId)}&sessionId=${encodeURIComponent(sessionId)}`,
        )
        if (canceled || current !== generation.current) return
        messages.current(
          (conversation.messages ?? []).map((message) => ({
            ...message,
            sessionId,
          })),
        )
        if (job.projectRevision) setRecoveredRevision(job.projectRevision)
        await refresh()
        if (canceled || current !== generation.current) return
        if (job.status === 'failed')
          setJobError(job.error ?? 'The previous Copilot turn did not finish.')
        setActiveJobId('')
      } catch (cause) {
        if (!canceled && current === generation.current) {
          setActiveJobId('')
          setError(
            cause instanceof Error
              ? cause.message
              : 'Could not resume Copilot progress.',
          )
        }
      }
    }
    void poll()
    return () => {
      canceled = true
      clearTimeout(timer)
    }
  }, [activeJobId, projectId, agentId, sessionId, refresh])
  async function create() {
    const current = ++generation.current
    setLoading(true)
    setError('')
    try {
      const conversation = await arcade<Conversation>(
        `projects/${projectId}/copilot-sessions`,
        { agentId },
      )
      if (current !== generation.current) return
      await choose(conversation.sessionId)
    } catch (cause) {
      if (current !== generation.current) return
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not start a conversation.',
      )
      setLoading(false)
    }
  }
  return {
    sessions,
    sessionId,
    setSessionId: rememberSession,
    changes,
    loading: loading || Boolean(activeJobId),
    activeJobId,
    recoveredRevision,
    jobError,
    error,
    setError,
    choose,
    create,
    refresh,
    approvalMode,
    setApprovalMode,
    computerEnabled,
    setComputerEnabled,
  }
}

/** The title shown above the conversation — the open session's own name. */
export function copilotSessionTitle(
  copilot: ReturnType<typeof useProjectCopilot>,
) {
  if (!copilot.sessionId) return 'New conversation'
  const session = copilot.sessions.find(
    (candidate) => candidate.sessionId === copilot.sessionId,
  )
  return session?.title || 'Game conversation'
}

/**
 * Past conversations, as their own tab beside Notes and Revisions.
 *
 * This used to be a <select> pinned above the chat, which spent a whole row of
 * the panel on a control that is used once a session — and put a border
 * between the heading and the first message.
 */
export function CopilotSessionList({
  copilot,
  agentId,
  busy,
  onOpen,
}: {
  copilot: ReturnType<typeof useProjectCopilot>
  agentId: string
  busy: boolean
  onOpen: () => void
}) {
  const disabled = busy || copilot.loading
  const sessions = copilot.sessions.filter(
    (session) => session.agentId === agentId,
  )
  return (
    <div className="copilot-session-list">
      {sessions.length === 0 ? (
        <p className="copilot-session-empty">
          Past conversations about this game will be listed here.
        </p>
      ) : (
        sessions.map((session) => (
          <button
            key={session.sessionId}
            type="button"
            className="copilot-session-row"
            aria-current={session.sessionId === copilot.sessionId}
            disabled={disabled}
            onClick={() => {
              void copilot.choose(session.sessionId)
              onOpen()
            }}
          >
            <MessageSquare size={14} aria-hidden />
            <span>
              <strong>{session.title || 'Game conversation'}</strong>
              <small>{new Date(session.createdAt).toLocaleString()}</small>
            </span>
            {session.sessionId === copilot.sessionId ? (
              <Check size={15} aria-hidden />
            ) : null}
          </button>
        ))
      )}
    </div>
  )
}

/**
 * Everything the Copilot needs to say above the conversation: job status,
 * errors, and any change waiting to be approved.
 */
export function CopilotReview({
  copilot,
  projectId,
  busy,
  dirty,
  onApplied,
  onReviewing,
}: {
  copilot: ReturnType<typeof useProjectCopilot>
  projectId: string
  busy: boolean
  dirty: boolean
  onApplied: () => Promise<void>
  onReviewing: (value: boolean) => void
}) {
  const [applying, setApplying] = useState('')
  const disabled = busy || copilot.loading || Boolean(applying)
  async function review(change: Change, action: 'approve' | 'reject') {
    setApplying(change.id)
    onReviewing(true)
    copilot.setError('')
    try {
      const result = await arcade<Change>(
        `projects/${projectId}/copilot-changes/${change.id}/${action}`,
        {},
      )
      if (result.status === 'failed')
        throw new Error(
          result.result?.error ?? 'The change could not be applied.',
        )
      if (result.status === 'applied') await onApplied()
      await copilot.refresh()
    } catch (cause) {
      copilot.setError(
        cause instanceof Error ? cause.message : 'Could not review change.',
      )
    } finally {
      setApplying('')
      onReviewing(false)
    }
  }
  return (
    <>
      {copilot.jobError && (
        <p className="copilot-error" role="status">
          {copilot.jobError} You can continue this conversation.
        </p>
      )}
      {copilot.activeJobId && (
        <p className="copilot-error" role="status">
          Resuming Copilot’s work…
        </p>
      )}
      {copilot.error && (
        <p role="alert" className="error-text copilot-error">
          {copilot.error}
          <button
            onClick={() => void copilot.choose(copilot.sessionId)}
            disabled={disabled}
          >
            Reload conversation
          </button>
        </p>
      )}
      {copilot.changes
        .filter(
          (change) =>
            change.sessionId === copilot.sessionId &&
            change.status === 'pending',
        )
        .map((change) => (
          <details key={change.id} className="copilot-change">
            <summary>
              {change.tool === 'arcade_publish_game'
                ? 'Review publication'
                : 'Review proposed change'}{' '}
              · revision {change.baseRevision}
            </summary>
            <pre>{JSON.stringify(change.args, null, 2)}</pre>
            {dirty && <p>Save your edits before reviewing this proposal.</p>}
            <div className="actions">
              <button
                disabled={disabled || dirty}
                onClick={() => void review(change, 'approve')}
              >
                <Check size={14} />
                Approve
              </button>
              <button
                disabled={disabled}
                onClick={() => void review(change, 'reject')}
              >
                <X size={14} />
                Reject
              </button>
            </div>
          </details>
        ))}
    </>
  )
}

export function CopilotSettings({
  copilot,
  busy,
  onComputer,
}: {
  copilot: ReturnType<typeof useProjectCopilot>
  busy: boolean
  onComputer: () => void
}) {
  const disabled = busy || copilot.loading
  return (
    <section className="copilot-settings" aria-label="Copilot settings">
      <Field
        label="Game editing"
        hint="Applies to the files this game is built from, not to the conversation."
      >
        <div className="copilot-permissions">
          <ShieldCheck size={16} aria-hidden />
          <Select
            ariaLabel="Copilot editing permissions"
            value={copilot.approvalMode}
            disabled={disabled}
            onValueChange={(mode) =>
              copilot.setApprovalMode(mode as ApprovalMode)
            }
          >
            <SelectOption
              value="manual"
              title="Review edits"
              hint="Approve game changes before they are saved"
            />
            <SelectOption
              value="automatic"
              title="Auto-approve edits"
              hint="Copilot can save changes directly"
            />
            <SelectOption
              value="read-only"
              title="Discuss only"
              hint="Discuss the game without changing its saved files"
            />
          </Select>
        </div>
      </Field>
      <div className="copilot-settings-group">
        <h3>Agent computer</h3>
        <SwitchField
          checked={copilot.computerEnabled}
          disabled={disabled || copilot.approvalMode === 'read-only'}
          onCheckedChange={copilot.setComputerEnabled}
          label="Request a computer"
          hint="Asks Commons to prepare the agent’s computer for this run."
        />
        <p className="copilot-settings-note">
          Computer tools follow the agent’s Commons permissions; game revisions
          follow the editing mode above.
        </p>
        <button
          type="button"
          className="ui-button"
          aria-label="Open agent computer"
          onClick={onComputer}
        >
          <Monitor size={14} aria-hidden /> Open computer
        </button>
      </div>
    </section>
  )
}
