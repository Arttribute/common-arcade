'use client'
import { useEffect, useRef, type RefObject } from 'react'
import type { ExecutableStrategy } from '@common-arcade/studio'
import { arcade } from '../../lib/api'

type Controller = {
  seatId: string
  label: string
  kind: 'human' | 'agent'
  strategy: string
  strategyEpoch?: number
  executableStrategy?: ExecutableStrategy
  agentId?: string
}
type Options = {
  root: RefObject<HTMLDivElement | null>
  active: boolean
  runId?: string
  previewRevision: string
  controllers: Controller[]
  decisionsPerSecond: number
  onSample(event: any, epoch: string, decisions: number): void
  onStrategyApplied?(seatId: string, epoch: number): void
  onStop(reason: string): void
  onWarning(reason: string): void
}

/** A bounded, retryable diagnostics outbox. Never awaited by the frame loop. */
export function createPreviewTelemetryOutbox(
  send: (runId: string, batchId: string, body: unknown) => Promise<unknown>,
  warn: (reason: string) => void,
) {
  const queue: {
    runId: string
    batchId: string
    sealed?: boolean
    body: { epoch: string; events: any[] }
  }[] = []
  let inFlight = false
  let counter = 0
  let dropped = 0
  return {
    add(runId: string, epoch: string, event: any) {
      const last = queue.at(-1)
      if (
        last &&
        !last.sealed &&
        last.runId === runId &&
        last.body.epoch === epoch &&
        last.body.events.length < 4 &&
        JSON.stringify(last.body).length + JSON.stringify(event).length < 30000
      ) {
        last.body.events.push(event)
        return
      }
      if (queue.length >= 32) {
        dropped++
        if (dropped === 1)
          warn(
            'Diagnostic uploads are behind; some samples were dropped. Controls continue locally.',
          )
        return
      }
      queue.push({
        runId,
        batchId: epoch + '-' + counter++,
        body: { epoch, events: [event] },
      })
    },
    async flush() {
      if (inFlight || !queue.length) return
      inFlight = true
      const next = queue[0]!
      next.sealed = true
      try {
        await send(next.runId, next.batchId, next.body)
        queue.shift()
      } catch {
        warn(
          'Diagnostic upload delayed. The same batch will be retried; controls continue locally.',
        )
      } finally {
        inFlight = false
      }
    },
    get pending() {
      return queue.length
    },
  }
}

export function usePreviewAgents(options: Options) {
  const latest = useRef(options)
  latest.current = options
  const outbox = useRef<
    ReturnType<typeof createPreviewTelemetryOutbox> | undefined
  >(undefined)
  if (!outbox.current)
    outbox.current = createPreviewTelemetryOutbox(
      (runId, batchId, body) =>
        arcade(
          `studio/browser-runs/${runId}/telemetry/${batchId}`,
          body,
          'POST',
          {},
          AbortSignal.timeout(10000),
        ),
      (reason) => latest.current.onWarning(reason),
    )
  useEffect(() => {
    const timer = setInterval(() => {
      void outbox.current?.flush()
    }, 500)
    return () => {
      clearInterval(timer)
      void outbox.current?.flush()
    }
  }, [])
  const current = useRef<{ frame: Window; epoch: string } | undefined>(
    undefined,
  )
  const strategies = JSON.stringify(
    options.controllers.map((c) => ({
      seatId: c.seatId,
      kind: c.kind,
      strategy: c.strategy,
      strategyEpoch: c.strategyEpoch,
      executableStrategy: c.executableStrategy,
    })),
  )
  useEffect(() => {
    if (!options.active || !options.runId) return
    const frame = options.root.current?.querySelector('iframe')?.contentWindow
    if (!frame) {
      latest.current.onStop('Preview frame unavailable')
      return
    }
    const epoch = crypto.randomUUID()
    const runId = options.runId
    let acknowledged = false
    let finished = false
    current.current = { frame, epoch }
    const send = (type: string, extra: Record<string, unknown> = {}) =>
      frame.postMessage({ type, runId, epoch, ...extra }, '*')
    const start = () =>
      send('arcade.preview-policy.start', {
        controllers: latest.current.controllers,
        decisionsPerSecond: latest.current.decisionsPerSecond,
      })
    const receive = (message: MessageEvent) => {
      const data = message.data
      if (
        message.source !== frame ||
        data?.runId !== runId ||
        data?.epoch !== epoch
      )
        return
      if (data.type === 'arcade.preview-policy.started') acknowledged = true
      if (data.type === 'arcade.preview-policy.strategy-applied')
        latest.current.onStrategyApplied?.(data.seatId, data.strategyEpoch)
      if (data.type === 'arcade.preview-policy.sample' && data.event) {
        latest.current.onSample(data.event, epoch, data.decisions)
        outbox.current?.add(runId, epoch, data.event)
      }
      if (data.type === 'arcade.preview-policy.warning')
        latest.current.onWarning(String(data.reason))
      if (data.type === 'arcade.preview-policy.stopped') {
        finished = true
        latest.current.onStop(String(data.reason))
      }
    }
    window.addEventListener('message', receive)
    start()
    const heartbeat = setInterval(() => {
      if (finished) return
      if (!acknowledged) start()
      else send('arcade.preview-policy.heartbeat')
    }, 750)
    const timeout = setTimeout(() => {
      if (!acknowledged && !finished)
        latest.current.onStop(
          'Preview controller did not start. Restart the preview.',
        )
    }, 5000)
    return () => {
      clearInterval(heartbeat)
      clearTimeout(timeout)
      send('arcade.preview-policy.stop')
      window.removeEventListener('message', receive)
      current.current = undefined
    }
  }, [options.active, options.runId, options.previewRevision])
  useEffect(() => {
    const running = current.current
    if (running)
      running.frame.postMessage(
        {
          type: 'arcade.preview-policy.start',
          epoch: running.epoch,
          runId: options.runId,
          controllers: options.controllers,
          decisionsPerSecond: options.decisionsPerSecond,
        },
        '*',
      )
  }, [strategies, options.decisionsPerSecond])
}
