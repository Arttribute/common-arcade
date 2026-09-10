import { describe, expect, it, vi } from 'vitest'
import { arcade } from '../../lib/api'
import { createPreviewTelemetryOutbox } from './use-preview-agents'

describe('preview diagnostics outbox', () => {
  it('keeps the in-flight batch immutable and retries it after network failure', async () => {
    let reject: (error: Error) => void = () => {}
    const sent: any[] = []
    const send = vi.fn(async (_run, id, body) => {
      sent.push({ id, body: JSON.parse(JSON.stringify(body)) })
      if (sent.length === 1)
        await new Promise((_resolve, fail) => {
          reject = fail
        })
    })
    const outbox = createPreviewTelemetryOutbox(send, vi.fn())
    outbox.add('run', 'epoch', { step: 0 })
    const pending = outbox.flush()
    outbox.add('run', 'epoch', { step: 1 })
    reject(new Error('offline'))
    await pending
    expect(outbox.pending).toBe(2)
    await outbox.flush()
    expect(sent[1]).toEqual(sent[0])
    await outbox.flush()
    expect(sent[2].body.events).toEqual([{ step: 1 }])
    expect(outbox.pending).toBe(0)
  })
  it('bounds its queue during an outage without blocking input producers', () => {
    const warn = vi.fn()
    const outbox = createPreviewTelemetryOutbox(async () => {}, warn)
    for (let i = 0; i < 1000; i++) outbox.add('run', 'epoch', { step: i })
    expect(outbox.pending).toBe(32)
    expect(warn).toHaveBeenCalledTimes(1)
  })
  it('never appends to a batch whose response may have been lost', async () => {
    const sent: any[] = []
    const outbox = createPreviewTelemetryOutbox(async (_run, id, body) => {
      sent.push({ id, body: JSON.parse(JSON.stringify(body)) })
      if (sent.length === 1) throw new Error('Response lost after save')
    }, vi.fn())
    outbox.add('run', 'epoch', { step: 0 })
    await outbox.flush()
    outbox.add('run', 'epoch', { step: 1 })
    await outbox.flush()
    expect(sent[1]).toEqual(sent[0])
    expect(outbox.pending).toBe(1)
  })
})

it('skips a permanently rejected batch while continuing to save later diagnostics', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: 'Invalid sample timing' }), {
        status: 422,
      }),
    )
    .mockResolvedValue(new Response('{}', { status: 200 }))
  vi.stubGlobal('fetch', fetch)
  try {
    const warn = vi.fn()
    const outbox = createPreviewTelemetryOutbox(
      (run, id, body) => arcade(`runs/${run}/${id}`, body),
      warn,
    )
    outbox.add('run', 'first', { step: 0 })
    outbox.add('run', 'second', { step: 10 })
    await outbox.flush()
    expect(outbox.pending).toBe(1)
    await outbox.flush()
    expect(outbox.pending).toBe(0)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('rejected and skipped'),
    )
  } finally {
    vi.unstubAllGlobals()
  }
})
