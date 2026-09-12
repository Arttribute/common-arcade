'use client'
import { useEffect, useRef, useState } from 'react'
import {
  AnnotationLayer,
  RecordingPlayer,
  type AnnotationGeometry,
  type CanvasRecording,
} from '@agent-commons/ui'
import { X } from 'lucide-react'
import { arcade } from '../../lib/api'

type RecordingSummary = {
  id: string
  title: string
  durationMs: number
  revision: number
  public: boolean
}
type RecordingAnnotation = AnnotationGeometry & {
  id: string
  body: string
  status?: 'open' | 'resolved'
  context?: {
    moment?: unknown
  }
}
type RecordingAnnotate = (
  recordingId: string,
  timeMs: number,
  revision: number,
  geometry: AnnotationGeometry,
  body: string,
) => Promise<void>
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
  annotations = [],
  onAnnotate,
}: {
  projectId?: string
  gameId?: string
  refresh?: number
  annotations?: RecordingAnnotation[]
  onAnnotate?: RecordingAnnotate
}) {
  const [recordings, setRecordings] = useState<RecordingSummary[]>([]),
    [selected, setSelected] = useState<{
      recording: CanvasRecording
      summary?: RecordingSummary
    }>(),
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
      const summary = recordings.find((candidate) => candidate.id === id)
      setSelected({
        summary,
        recording: await decodeRecording(
          new Blob([await response.arrayBuffer()], {
            type: 'application/gzip',
          }),
        ),
      })
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
                .then((recording) => setSelected({ recording }))
                .catch((e) => setError(e.message))
            e.target.value = ''
          }}
        />
      </label>
      {selected && (
        <AnnotatedRecording
          selected={selected}
          annotations={annotations}
          onAnnotate={onAnnotate}
          onClose={() => setSelected(undefined)}
        />
      )}
    </section>
  )
}

function AnnotatedRecording({
  selected,
  annotations,
  onAnnotate,
  onClose,
}: {
  selected: { recording: CanvasRecording; summary?: RecordingSummary }
  annotations: RecordingAnnotation[]
  onAnnotate?: RecordingAnnotate
  onClose: () => void
}) {
  const { recording, summary } = selected
  const root = useRef<HTMLDivElement>(null)
  const [timeMs, setTimeMs] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [tool, setTool] = useState<'select' | 'point' | 'region'>('select')
  const [draft, setDraft] = useState<AnnotationGeometry>()
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!playing) return
    const timer = setInterval(
      () =>
        setTimeMs((current) => {
          const next = Math.min(current + 100, recording.durationMs)
          if (next >= recording.durationMs) setPlaying(false)
          return next
        }),
      100,
    )
    return () => clearInterval(timer)
  }, [playing, recording.durationMs])
  const recordingId = summary?.id
  const recordingNotes = recordingId
    ? annotations.filter(
        (annotation) =>
          annotationMoment(annotation)?.recordingId === recordingId,
      )
    : []
  const visibleNotes = recordingNotes.filter((annotation) => {
    const at = annotationMoment(annotation)?.timeMs
    return typeof at === 'number' && Math.abs(at - timeMs) <= 750
  })
  function seek(next: number) {
    setTimeMs(next)
    setPlaying(false)
    const input = root.current?.querySelector<HTMLInputElement>(
      'input[aria-label="Recording timeline"]',
    )
    if (!input) return
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set
    setter?.call(input, String(next))
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }
  return (
    <div
      ref={root}
      className="recording-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Interaction recording"
      onClickCapture={(event) => {
        const target = event.target
        if (!(target instanceof HTMLButtonElement)) return
        if (target.textContent?.trim() === 'Play') setPlaying(true)
        if (target.textContent?.trim() === 'Pause') setPlaying(false)
      }}
      onChangeCapture={(event) => {
        const target = event.target
        if (
          target instanceof HTMLInputElement &&
          target.getAttribute('aria-label') === 'Recording timeline'
        ) {
          setTimeMs(Number(target.value))
          setPlaying(false)
        }
      }}
    >
      <header>
        <div>
          <strong>{recording.title}</strong>
          <small>
            {(timeMs / 1000).toFixed(1)}s · {recordingNotes.length} annotations
          </small>
        </div>
        <div className="recording-annotation-tools">
          {onAnnotate && recordingId ? (
            <>
              <button
                className={tool === 'point' ? 'is-active' : ''}
                onClick={() => setTool(tool === 'point' ? 'select' : 'point')}
              >
                Pin note
              </button>
              <button
                className={tool === 'region' ? 'is-active' : ''}
                onClick={() => setTool(tool === 'region' ? 'select' : 'region')}
              >
                Mark region
              </button>
            </>
          ) : null}
          <button onClick={onClose} aria-label="Close recording">
            <X size={16} aria-hidden />
          </button>
        </div>
      </header>
      <div className="recording-annotated-stage">
        <RecordingPlayer recording={recording} />
        {onAnnotate && recordingId ? (
          <AnnotationLayer
            tool={tool}
            notes={visibleNotes}
            onCreate={(geometry) => {
              setPlaying(false)
              setDraft(geometry)
              setTool('select')
            }}
            onSelect={(annotation) => {
              const match = recordingNotes.find(
                (candidate) => candidate.id === annotation.id,
              )
              if (match) seek(annotationMoment(match)?.timeMs ?? timeMs)
            }}
          />
        ) : null}
        {draft && recordingId && onAnnotate ? (
          <form
            className="recording-annotation-form"
            onSubmit={(event) => {
              event.preventDefault()
              if (!note.trim()) return
              setSaving(true)
              setError('')
              void onAnnotate(
                recordingId,
                timeMs,
                summary.revision,
                draft,
                note.trim(),
              )
                .then(() => {
                  setDraft(undefined)
                  setNote('')
                })
                .catch((cause) =>
                  setError(
                    cause instanceof Error ? cause.message : String(cause),
                  ),
                )
                .finally(() => setSaving(false))
            }}
          >
            <strong>Note at {(timeMs / 1000).toFixed(1)}s</strong>
            <textarea
              autoFocus
              rows={3}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="What should change here?"
            />
            {error ? <small className="error-text">{error}</small> : null}
            <div>
              <button disabled={saving || !note.trim()} type="submit">
                {saving ? 'Saving…' : 'Save annotation'}
              </button>
              <button type="button" onClick={() => setDraft(undefined)}>
                Cancel
              </button>
            </div>
          </form>
        ) : null}
      </div>
      {recordingNotes.length ? (
        <nav className="recording-annotation-markers" aria-label="Annotations">
          {recordingNotes.map((annotation) => (
            <button
              key={annotation.id}
              onClick={() => seek(annotationMoment(annotation)?.timeMs ?? 0)}
            >
              <time>
                {((annotationMoment(annotation)?.timeMs ?? 0) / 1000).toFixed(
                  1,
                )}
                s
              </time>
              <span>{annotation.body}</span>
            </button>
          ))}
        </nav>
      ) : null}
    </div>
  )
}

function annotationMoment(annotation: RecordingAnnotation) {
  const moment = annotation.context?.moment
  if (!moment || typeof moment !== 'object') return undefined
  const { recordingId, timeMs } = moment as Record<string, unknown>
  return {
    ...(typeof recordingId === 'string' ? { recordingId } : {}),
    ...(typeof timeMs === 'number' ? { timeMs } : {}),
  }
}
