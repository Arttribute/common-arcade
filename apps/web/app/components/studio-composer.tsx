'use client'
import { useEffect, useState, type ReactNode } from 'react'
import { ChatComposer, type ComposerAttachment } from '@agent-commons/ui'
import { arcade } from '../../lib/api'

export type CommonsAgent = {
  agentId: string
  name: string
  modelId?: string
  modelProvider?: string
}
export function useArcadeIdentity() {
  const [user, setUser] = useState<{ id: string; name: string } | null>(null)
  const [agents, setAgents] = useState<CommonsAgent[]>([])
  const [copilotId, setCopilotId] = useState('')
  const [models, setModels] = useState<
    { provider: string; modelId: string; displayName: string; tier?: string }[]
  >([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const session = await fetch('/api/auth/session').then((r) => r.json())
        if (!active) return
        setUser(session.user)
        if (!session.user) return
        void arcade<{
          models: {
            provider: string
            modelId: string
            displayName: string
            tier?: string
          }[]
        }>('commons/models')
          .then((result) => {
            if (active)
              setModels(result.models.filter((m) => m.tier !== 'local'))
          })
          .catch(() => undefined)
        // Listing is independent of project loading and copilot provisioning.
        const result = await arcade<{
          agents: CommonsAgent[] | { agents: CommonsAgent[] }
        }>('commons/agents')
        if (!active) return
        const all = Array.isArray(result.agents)
          ? result.agents
          : (result.agents.agents ?? [])
        setAgents(all)
        let copilot: CommonsAgent | undefined
        for (let attempt = 0; attempt < 8 && active; attempt++) {
          try {
            copilot = await arcade<CommonsAgent>('commons/copilot', {})
            break
          } catch (e) {
            if (
              !(e instanceof Error) ||
              !e.message.includes('record changed') ||
              attempt === 7
            )
              throw e
            await new Promise((resolve) => setTimeout(resolve, 2000))
          }
        }
        if (active && copilot) {
          setCopilotId(copilot.agentId)
          setAgents([
            copilot,
            ...all.filter((a) => a.agentId !== copilot!.agentId),
          ])
        }
      } catch (e) {
        if (active)
          setError(
            e instanceof Error
              ? e.message
              : 'Could not load your Commons agents.',
          )
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [])
  return { user, agents, copilotId, models, error, loading }
}
export function ArcadeComposer({
  value,
  onChange,
  onSubmit,
  identity,
  onAgentChange,
  busy,
  context,
}: {
  value: string
  onChange: (value: string) => void
  onSubmit: (
    attachments: { fileId: string }[],
    model?: { provider: string; modelId: string },
  ) => void
  identity: ReturnType<typeof useArcadeIdentity>
  onAgentChange: (id: string) => void
  busy?: boolean
  context?: ReactNode
}) {
  const [attachments, setAttachments] = useState<
    (ComposerAttachment & { fileId?: string })[]
  >([])
  const [error, setError] = useState('')
  const [modelKey, setModelKey] = useState('')
  async function upload(files: File[]) {
    setError('')
    for (const file of files) {
      if (file.size > 4 * 1024 * 1024) {
        setError(`${file.name} exceeds the 4 MB attachment limit.`)
        continue
      }
      const id = crypto.randomUUID()
      setAttachments((all) => [
        ...all,
        { id, name: file.name, status: 'uploading' },
      ])
      try {
        const form = new FormData()
        form.set('agentId', identity.copilotId)
        form.append('files', file)
        const response = await fetch('/api/files/upload', {
          method: 'POST',
          body: form,
        })
        const result = await response.json()
        if (!response.ok)
          throw new Error(result.detail ?? result.message ?? 'Upload failed.')
        const uploaded = (result.data ?? result)[0]
        if (!uploaded?.fileId)
          throw new Error('Upload did not return a file reference.')
        setAttachments((all) =>
          all.map((a) =>
            a.id === id
              ? { ...a, fileId: uploaded.fileId, status: 'ready' }
              : a,
          ),
        )
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Upload failed.')
        setAttachments((all) =>
          all.map((a) => (a.id === id ? { ...a, status: 'error' } : a)),
        )
      }
    }
  }
  return (
    <div className="arcade-composer-wrap">
      {(identity.error || error) && (
        <p role="alert" className="studio-help">
          {error || identity.error}
        </p>
      )}
      <ChatComposer
        value={value}
        onChange={onChange}
        onSubmit={() => {
          if (attachments.some((a) => a.status !== 'ready')) return
          const selected = identity.models.find(
            (m) => `${m.provider}:${m.modelId}` === modelKey,
          )
          onSubmit(
            attachments.flatMap((a) =>
              a.fileId ? [{ fileId: a.fileId }] : [],
            ),
            selected
              ? { provider: selected.provider, modelId: selected.modelId }
              : undefined,
          )
          setAttachments([])
        }}
        busy={busy}
        disabled={!identity.user || !identity.copilotId}
        placeholder={
          identity.user
            ? 'Describe a game, an idea, or a change…'
            : 'Sign in to create with your Commons agents'
        }
        agents={identity.agents.map((a) => ({ id: a.agentId, name: a.name }))}
        agentId={identity.copilotId}
        onAgentChange={onAgentChange}
        models={[
          { id: '', name: 'Agent default' },
          ...identity.models.map((m) => ({
            id: `${m.provider}:${m.modelId}`,
            name: m.displayName,
          })),
        ]}
        modelId={modelKey}
        onModelChange={setModelKey}
        onFiles={(files) => void upload(files)}
        attachments={attachments}
        onRemoveAttachment={(id) =>
          setAttachments((all) => all.filter((a) => a.id !== id))
        }
        context={context}
      />
    </div>
  )
}
