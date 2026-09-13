'use client'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { Check, ChevronsUpDown, Plus, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { StudioProject } from '@common-arcade/studio'
import { GameArtwork } from './game-artwork'

/**
 * The Studio project switcher, matching the agent switcher in Agent Commons:
 * the open project's artwork and name in the toolbar, and a searchable popover
 * to jump to another one.
 *
 * It replaces both the plain toolbar title and the <select> that used to sit in
 * the Project panel — the title was stated twice and only one of the two could
 * actually switch projects.
 */
export function ProjectSwitcher({
  current,
  projects,
  disabled = false,
  disabledReason,
  onCreate,
}: {
  current?: StudioProject
  projects: StudioProject[]
  disabled?: boolean
  disabledReason?: string
  onCreate?: () => void
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const title = current?.document.title || 'New game'
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return projects
    return projects.filter((project) =>
      project.document.title.toLowerCase().includes(needle),
    )
  }, [projects, query])
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          className="project-switcher-trigger"
          disabled={disabled}
          title={disabled ? disabledReason : 'Switch project'}
        >
          <span className="project-switcher-art" aria-hidden>
            <GameArtwork title={title} src={current?.document.thumbnail} />
          </span>
          <span className="project-switcher-name">{title}</span>
          <ChevronsUpDown size={14} aria-hidden />
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        {/* Radix portals to document.body, outside the `.arcade` shell, so the
            surface carries the class itself to inherit the app's tokens. */}
        <PopoverPrimitive.Content
          className="arcade project-switcher-popover"
          align="start"
          sideOffset={6}
        >
          <div className="project-switcher-search">
            <Search size={14} aria-hidden />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Switch project…"
              aria-label="Search your projects"
            />
          </div>
          <div className="project-switcher-list">
            {filtered.length === 0 ? (
              <p className="project-switcher-empty">No projects found</p>
            ) : (
              filtered.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  className="project-switcher-item"
                  aria-current={project.id === current?.id}
                  onClick={() => {
                    setOpen(false)
                    if (project.id !== current?.id)
                      router.push(`/studio/${project.id}`)
                  }}
                >
                  <span className="project-switcher-art" aria-hidden>
                    <GameArtwork
                      title={project.document.title}
                      src={project.document.thumbnail}
                    />
                  </span>
                  <span className="project-switcher-item-copy">
                    <strong>{project.document.title}</strong>
                    <small>
                      Revision {project.revision} ·{' '}
                      {new Date(project.updatedAt).toLocaleDateString()}
                    </small>
                  </span>
                  {project.id === current?.id ? (
                    <Check size={15} aria-hidden />
                  ) : null}
                </button>
              ))
            )}
          </div>
          {onCreate ? (
            <button
              type="button"
              className="project-switcher-create"
              onClick={() => {
                setOpen(false)
                onCreate()
              }}
            >
              <Plus size={14} aria-hidden />
              New game
            </button>
          ) : null}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}
