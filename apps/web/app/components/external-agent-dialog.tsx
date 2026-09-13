'use client'
import { useEffect, useState, type ReactNode } from 'react'
import {
  ArrowUpRight,
  Check,
  Copy,
  FileText,
  KeyRound,
  Loader2,
} from 'lucide-react'
import { arcade } from '../../lib/api'
import { Dialog } from './ui/dialog'
import { Tab, Tabs } from './ui/tabs'
import {
  SKILL_PATH,
  buildAgentSetup,
  type ExternalClient,
} from './external-agent-setup'

/** Loads Arcade's skill the first time the dialog opens (its content only
 *  mounts while open), so the page itself never pays for the 10 KB file. */
function useSkillText(onLoad: (text: string) => void, loaded: boolean) {
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (loaded) return
    let alive = true
    fetch(SKILL_PATH)
      .then((response) =>
        response.ok ? response.text() : Promise.reject(response.status),
      )
      .then((text) => alive && onLoad(text))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [loaded, onLoad])
  return failed
}

function SkillPanel({
  skill,
  onLoad,
}: {
  skill: string
  onLoad: (text: string) => void
}) {
  const failed = useSkillText(onLoad, Boolean(skill))
  return (
    <details className="external-agent-skill">
      <summary>
        <FileText size={14} aria-hidden />
        View the skill · SKILL.md
      </summary>
      {skill ? (
        <CopyBlock label="SKILL.md" text={skill} />
      ) : (
        <p role={failed ? 'alert' : 'status'}>
          {failed ? 'The skill could not be loaded.' : 'Loading the skill…'}
        </p>
      )}
      <a href={SKILL_PATH} target="_blank" rel="noreferrer">
        Open SKILL.md
        <ArrowUpRight size={12} aria-hidden />
      </a>
    </details>
  )
}

const CLIENTS: { id: ExternalClient; label: string }[] = [
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'codex', label: 'Codex' },
  { id: 'other', label: 'Other agent' },
]

function CopyBlock({
  label,
  text,
  multiline = true,
  wrap = true,
}: {
  label: string
  text: string
  multiline?: boolean
  /** Prose wraps; terminal commands scroll so paths stay on one line. */
  wrap?: boolean
}) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="external-agent-code">
      <div className="external-agent-code-head">
        <span>{label}</span>
        <button
          type="button"
          onClick={() =>
            void navigator.clipboard.writeText(text).then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), 1600)
            })
          }
        >
          {copied ? (
            <Check size={14} aria-hidden />
          ) : (
            <Copy size={14} aria-hidden />
          )}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {multiline ? (
        <pre className={wrap ? 'is-wrapped' : undefined}>{text}</pre>
      ) : (
        <code>{text}</code>
      )}
    </div>
  )
}

/**
 * Lets a creator build games with their own coding agent (Claude Code, Codex
 * or any agent that can make HTTPS calls) instead of the built-in Commons
 * copilot: mint a scoped, expiring access key, install the portable Arcade
 * skill, and hand the agent a ready prompt. Inside a project the prompt
 * targets that project; on the studio home it creates a new one.
 */
export function ExternalAgentDialog({
  trigger,
  signedIn,
  project,
}: {
  trigger: ReactNode
  signedIn: boolean
  project?: { id: string; title: string; revision: number }
}) {
  const [client, setClient] = useState<ExternalClient>('claude-code')
  const [publish, setPublish] = useState(false)
  const [days, setDays] = useState(7)
  const [token, setToken] = useState('')
  const [idea, setIdea] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [skill, setSkill] = useState('')
  const [inlineSkill, setInlineSkill] = useState(false)

  const origin =
    typeof window === 'undefined'
      ? 'https://arcade.agentcommons.io'
      : window.location.origin
  const setup = buildAgentSetup({
    client,
    origin,
    token,
    idea,
    project,
    skillText: inlineSkill && skill ? skill : undefined,
  })
  const clientLabel = CLIENTS.find((c) => c.id === client)!.label

  async function createKey() {
    setBusy(true)
    setError('')
    try {
      const key = await arcade<{ token: string }>('access-keys', {
        name: `${clientLabel}${project ? ` · ${project.title}` : ''}`.slice(
          0,
          100,
        ),
        scopes: [
          'projects:read',
          'projects:write',
          ...(publish ? ['releases:publish'] : []),
        ],
        days,
      })
      setToken(key.token)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      trigger={trigger}
      title="Build with your own agent"
      description={
        project
          ? `Let Claude Code, Codex or another coding agent work on ${project.title} with a scoped access key.`
          : 'Create games with Claude Code, Codex or another coding agent instead of a Commons agent.'
      }
    >
      <div className="external-agent">
        <Tabs
          value={client}
          onValueChange={(value) => setClient(value as ExternalClient)}
          ariaLabel="Your agent"
          className="external-agent-tabs"
        >
          {CLIENTS.map((c) => (
            <Tab key={c.id} value={c.id}>
              {c.label}
            </Tab>
          ))}
        </Tabs>

        <ol className="external-agent-steps">
          <li>
            <h3>Create an access key</h3>
            {!signedIn ? (
              <p>
                <a
                  href={`/api/auth/login?next=${encodeURIComponent(project ? `/studio/${project.id}` : '/studio')}`}
                >
                  Sign in with Commons
                </a>{' '}
                to create a key.
              </p>
            ) : token ? (
              <>
                <p className="external-agent-key-note">
                  <KeyRound size={14} aria-hidden />
                  Key created. It is only shown once and is already included in
                  the setup below.
                </p>
                <CopyBlock label="Access key" text={token} multiline={false} />
              </>
            ) : (
              <>
                <p>
                  The key lets your agent create, edit and test games as you.
                  You can revoke it any time from{' '}
                  <a href="/agents" target="_blank" rel="noreferrer">
                    Agents
                  </a>
                  .
                </p>
                <div className="external-agent-key-options">
                  <label>
                    <input
                      type="checkbox"
                      checked={publish}
                      onChange={(event) => setPublish(event.target.checked)}
                    />
                    Also allow publishing releases
                  </label>
                  <label className="external-agent-expiry">
                    Expires in
                    <select
                      value={days}
                      onChange={(event) => setDays(Number(event.target.value))}
                    >
                      <option value={1}>1 day</option>
                      <option value={7}>7 days</option>
                      <option value={30}>30 days</option>
                      <option value={90}>90 days</option>
                    </select>
                  </label>
                </div>
                <button
                  type="button"
                  className="primary compact"
                  disabled={busy}
                  onClick={() => void createKey()}
                >
                  {busy ? (
                    <Loader2 size={16} className="spin" aria-hidden />
                  ) : (
                    <KeyRound size={16} aria-hidden />
                  )}
                  Create key
                </button>
              </>
            )}
            {error ? <p role="alert">{error}</p> : null}
          </li>

          <li>
            <h3>Connect {clientLabel}</h3>
            <p>
              The Common Arcade skill teaches your agent Arcade's game format
              and API. {setup.connectNote}
            </p>
            <SkillPanel skill={skill} onLoad={setSkill} />
            <CopyBlock
              label="Run in your terminal"
              text={setup.install}
              wrap={false}
            />
          </li>

          <li>
            <h3>Tell it what to build</h3>
            {project ? null : (
              <label className="external-agent-idea">
                Game idea
                <input
                  value={idea}
                  maxLength={400}
                  placeholder="A neon racing game with drifting"
                  onChange={(event) => setIdea(event.target.value)}
                />
              </label>
            )}
            <label>
              <input
                type="checkbox"
                checked={inlineSkill}
                disabled={!skill}
                onChange={(event) => setInlineSkill(event.target.checked)}
              />
              Include the full skill in the prompt
            </label>
            <p>
              {inlineSkill
                ? 'Works even where the agent cannot read files or reach the internet. '
                : 'Without the setup step, the agent fetches the skill from Arcade itself. '}
              {setup.launchNote}
            </p>
            <CopyBlock label="Prompt" text={setup.prompt} />
          </li>
        </ol>
      </div>
    </Dialog>
  )
}
