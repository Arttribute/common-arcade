'use client'

import { ControlClient, type TestRun } from '@common-arcade/control-client'
import { useMemo, useState } from 'react'

const apiUrl = process.env.NEXT_PUBLIC_ARCADE_API_URL ?? 'http://localhost:4100'

type LogRecord = {
  sequence: number
  type: string
  summary: string
  category: string
  source: { seatId?: string; kind: string }
  data: unknown
}

export function TestArena() {
  const [actorId, setActorId] = useState('studio_creator')
  const [seed, setSeed] = useState('studio-seed-42')
  const [run, setRun] = useState<TestRun>()
  const [selected, setSelected] = useState<LogRecord>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const client = useMemo(
    () => new ControlClient({ baseUrl: apiUrl, actorId }),
    [actorId],
  )

  async function create(execution: 'step' | 'complete') {
    setBusy(true)
    setError(undefined)
    try {
      setRun(await client.createTestRun({ seed, execution }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  async function step() {
    if (run === undefined) return
    setBusy(true)
    try {
      const response = (await client.stepTestRun(run.runId)) as { run: TestRun }
      setRun(response.run)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const logs = (run?.diagnostics ?? []) as unknown as LogRecord[]
  const lastState = run?.replay.checkpoints.at(-1)?.state as
    { board?: Array<string | null> } | undefined

  return (
    <div className="studio-shell">
      <header className="studio-toolbar">
        <div>
          <strong>{run ? `Run ${run.runId.slice(-6)}` : 'New Test Run'}</strong>
          <small> · exact Tic-tac-toe build</small>
        </div>
        <label>
          Actor
          <input
            value={actorId}
            onChange={(event) => setActorId(event.target.value)}
          />
        </label>
        <label>
          Seed
          <input
            value={seed}
            onChange={(event) => setSeed(event.target.value)}
          />
        </label>
        <button disabled={busy} onClick={() => create('step')}>
          Start paused
        </button>
        <button
          className="primary compact"
          disabled={busy}
          onClick={() => create('complete')}
        >
          Run agents
        </button>
        <button disabled={busy || run?.status !== 'running'} onClick={step}>
          Step
        </button>
      </header>
      <div className="studio-grid">
        <aside className="studio-seats">
          <span className="panel-label">SEATS / POLICIES</span>
          <article>
            <i className="agent-dot violet" />
            <strong>Center first</strong>
            <small>deterministic · seat 1</small>
          </article>
          <article>
            <i className="agent-dot orange-dot" />
            <strong>Corners first</strong>
            <small>deterministic · seat 2</small>
          </article>
          <dl>
            <dt>Status</dt>
            <dd>{run?.status ?? 'not started'}</dd>
            <dt>Decisions</dt>
            <dd>{run?.steps ?? 0}</dd>
            <dt>Diagnostics</dt>
            <dd>{logs.length}</dd>
          </dl>
        </aside>
        <section className="studio-stage">
          <div className="tic-grid test-board">
            {Array.from({ length: 9 }, (_, cell) => (
              <div key={cell}>{lastState?.board?.[cell] ?? ''}</div>
            ))}
          </div>
          <p>
            {run?.result === undefined
              ? 'Start a run to watch autonomous policies.'
              : JSON.stringify(run.result)}
          </p>
        </section>
        <aside className="studio-detail">
          <span className="panel-label">SELECTED RECORD</span>
          {selected === undefined ? (
            <p>Select a timeline event.</p>
          ) : (
            <>
              <h3>{selected.type}</h3>
              <p>{selected.summary}</p>
              <pre>{JSON.stringify(selected.data, null, 2)}</pre>
            </>
          )}
        </aside>
      </div>
      <section className="timeline">
        <div className="timeline-title">
          <strong>Structured timeline</strong>
          <span>observation · decision · authority</span>
        </div>
        <div className="timeline-records">
          {logs.length === 0 ? (
            <p>No records yet.</p>
          ) : (
            logs.map((record) => (
              <button key={record.sequence} onClick={() => setSelected(record)}>
                <time>{String(record.sequence).padStart(3, '0')}</time>
                <span>
                  {record.source.seatId?.slice(-6) ?? record.source.kind}
                </span>
                <strong>{record.type}</strong>
                <small>{record.summary}</small>
              </button>
            ))
          )}
        </div>
      </section>
      {error === undefined ? null : <p className="error-text">{error}</p>}
    </div>
  )
}
