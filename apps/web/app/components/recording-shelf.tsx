'use client'
import { useEffect, useState } from 'react'
import { RecordingPlayer, type CanvasRecording } from '@agent-commons/ui'
import { arcade } from '../../lib/api'

type RecordingSummary = {
  id: string
  title: string
  durationMs: number
  revision: number
  public: boolean
}
export async function storeRecording(
  projectId: string,
  revision: number,
  recording: CanvasRecording,
  share: boolean,
) {
  const compressed = await new Response(
    new Blob([JSON.stringify(recording)])
      .stream()
      .pipeThrough(new CompressionStream('gzip')),
  ).blob()
  const result = await arcade<{
    recording: RecordingSummary
    upload: { url: string; fields: Record<string, string> }
  }>(`projects/${projectId}/recordings`, {
    revision,
    title: recording.title.slice(0, 120),
    durationMs: Math.round(recording.durationMs),
    sizeBytes: compressed.size,
    public: share,
  })
  const form = new FormData()
  for (const [key, value] of Object.entries(result.upload.fields))
    form.set(key, value)
  form.set('file', compressed)
  const upload = await fetch(result.upload.url, { method: 'POST', body: form })
  if (!upload.ok)
    throw new Error(
      'Recording upload failed. The local download remains available.',
    )
  return arcade<RecordingSummary>(
    `studio/recordings/${result.recording.id}/complete`,
    {},
  )
}
async function decodeRecording(blob: Blob): Promise<CanvasRecording> {
  let stream = blob.stream()
  if (blob.type.includes('gzip'))
    stream = stream.pipeThrough(new DecompressionStream('gzip'))
  const reader = stream.getReader(),
    chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > 16 * 1024 * 1024) {
      await reader.cancel()
      throw new Error('Recording exceeds the 16 MB playback limit.')
    }
    chunks.push(value)
  }
  const value = JSON.parse(await new Blob(chunks as BlobPart[]).text())
  if (
    value.format !== 'commons.recording.v1' ||
    !Array.isArray(value.events) ||
    value.events.length > 100000 ||
    !Number.isFinite(value.durationMs) ||
    value.durationMs < 0 ||
    value.durationMs > 310000
  )
    throw new Error('Unsupported recording format.')
  return value
}
export function RecordingShelf({
  projectId,
  gameId,
  refresh = 0,
}: {
  projectId?: string
  gameId?: string
  refresh?: number
}) {
  const [recordings, setRecordings] = useState<RecordingSummary[]>([]),
    [selected, setSelected] = useState<CanvasRecording>(),
    [error, setError] = useState('')
  useEffect(() => {
    void arcade<{ recordings: RecordingSummary[] }>(
      projectId
        ? `projects/${projectId}/recordings`
        : `games/${gameId}/recordings`,
    )
      .then((r) => setRecordings(r.recordings))
      .catch((e) => setError(e.message))
  }, [projectId, gameId, refresh])
  async function open(id: string) {
    try {
      const record = await arcade<{ downloadUrl: string }>(
        `studio/recordings/${id}`,
      )
      const response = await fetch(record.downloadUrl)
      if (!response.ok) throw new Error('Recording download failed.')
      setSelected(
        await decodeRecording(
          new Blob([await response.arrayBuffer()], {
            type: 'application/gzip',
          }),
        ),
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open recording.')
    }
  }
  return (
    <section className="recording-shelf">
      <h3>{gameId ? 'Watch play sessions' : 'Recordings'}</h3>
      {error && (
        <p role="alert" className="studio-help">
          {error}
        </p>
      )}
      {recordings.map((r) => (
        <button
          className="recording-shelf-item"
          key={r.id}
          onClick={() => void open(r.id)}
        >
          <span>▷ {r.title}</span>
          <small>
            Revision {r.revision} · {Math.round(r.durationMs / 1000)}s ·{' '}
            {r.public ? 'Shared' : 'Private'}
          </small>
        </button>
      ))}
      {!recordings.length && (
        <p className="studio-help">
          {gameId
            ? 'No shared recordings yet.'
            : 'Record an interaction to keep a replay with this project.'}
        </p>
      )}
      <label className="studio-help">
        Open a recording file
        <input
          type="file"
          accept=".json,.gz,application/json,application/gzip"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file)
              void decodeRecording(
                new Blob([file], {
                  type: file.name.endsWith('.gz')
                    ? 'application/gzip'
                    : 'application/json',
                }),
              )
                .then(setSelected)
                .catch((e) => setError(e.message))
            e.target.value = ''
          }}
        />
      </label>
      {selected && (
        <div
          className="recording-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Interaction recording"
        >
          <header>
            <strong>{selected.title}</strong>
            <button
              onClick={() => setSelected(undefined)}
              aria-label="Close recording"
            >
              ×
            </button>
          </header>
          <RecordingPlayer recording={selected} />
        </div>
      )}
    </section>
  )
}
