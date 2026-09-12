'use client'
import { Header } from './header'
import { GameArtwork } from './game-artwork'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ArrowUpRight, Gamepad2, Plus } from 'lucide-react'
import { emptyBrowserDocument, type StudioProject } from '@common-arcade/studio'
import { ArcadeComposer, useArcadeIdentity } from './studio-composer'
import { arcade } from '../../lib/api'

export function StudioHome() {
  const identity = useArcadeIdentity(),
    router = useRouter()
  const [agentId, setAgentId] = useState(''),
    [prompt, setPrompt] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const [projects, setProjects] = useState<StudioProject[]>([])
  useEffect(() => {
    if (identity.copilotId) setAgentId(identity.copilotId)
  }, [identity.copilotId])
  useEffect(() => {
    if (identity.user)
      void arcade<{ projects: StudioProject[] }>('projects')
        .then((r) =>
          setProjects(
            r.projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
          ),
        )
        .catch((e) => setError(e.message))
  }, [identity.user])
  async function create(
    attachments: { fileId: string }[],
    generate = true,
    model?: { provider: string; modelId: string },
  ) {
    setBusy(true)
    setError('')
    try {
      const project = await arcade<StudioProject>('projects', {
        document: emptyBrowserDocument,
      })
      // The workspace runs the build, so the creator watches their game take
      // shape in the studio instead of waiting on this page for it to appear.
      sessionStorage.setItem(
        `arcade-prompt:${project.id}`,
        generate ? prompt : '',
      )
      router.push(`/studio/${project.id}`)
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Could not create your project.',
      )
      const result = await arcade<{ projects: StudioProject[] }>(
        'projects',
      ).catch(() => null)
      if (result) setProjects(result.projects)
    } finally {
      setBusy(false)
    }
  }
  return (
    <main className="studio-home">
      <Header />
      <section className="studio-home-create">
        <span className="studio-home-eyebrow">
          <Gamepad2 size={17} />
          Arcade Studio
        </span>
        <h1>What shall we play?</h1>
        <p>
          Create a game or simulation with your Commons agents.
          <br />
          Imagine it. Build it. Make it yours.
        </p>
        <ArcadeComposer
          value={prompt}
          onChange={setPrompt}
          identity={{ ...identity, copilotId: agentId }}
          onAgentChange={setAgentId}
          busy={busy}
          onSubmit={(attachments, model) =>
            void create(attachments, true, model)
          }
        />
        {busy && (
          <p role="status" className="studio-thinking">
            Opening your workspace…
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        {!identity.user && !identity.loading && (
          <a
            className="ac-button ac-button-primary"
            href="/api/auth/login?next=/studio"
          >
            Continue with Commons
          </a>
        )}
        <div className="studio-home-suggestions">
          {[
            { idea: 'A four-in-a-row strategy duel', color: '#4f46e5' },
            { idea: 'A five-by-five line-building game', color: '#f97316' },
            {
              idea: 'A fast competitive three-in-a-row variant',
              color: '#0ea5e9',
            },
          ].map(({ idea, color }) => (
            <button key={idea} onClick={() => setPrompt(idea)} disabled={busy}>
              <span className="suggestion-dot" style={{ background: color }} />
              {idea}
              <ArrowUpRight size={12} />
            </button>
          ))}
        </div>
      </section>
      {identity.user && (
        <section className="studio-home-projects">
          <div>
            <h2>Your projects</h2>
            <button
              className="ac-button"
              disabled={busy}
              onClick={() => void create([], false)}
            >
              <Plus size={14} />
              Blank project
            </button>
          </div>
          {projects.length ? (
            <div className="studio-project-grid">
              {projects.map((p) => (
                <Link href={`/studio/${p.id}`} key={p.id}>
                  <GameArtwork
                    title={p.document.title}
                    src={p.document.thumbnail}
                  />
                  <h3>{p.document.title}</h3>
                  <p>{p.document.description || 'Ready for your next idea.'}</p>
                  <small>
                    Revision {p.revision} ·{' '}
                    {new Date(p.updatedAt).toLocaleDateString()}
                  </small>
                </Link>
              ))}
            </div>
          ) : (
            <p>Your saved games will appear here.</p>
          )}
        </section>
      )}
    </main>
  )
}
