'use client'
import { useEffect, useRef, useState } from 'react'
import type { JsonValue, Observation } from '@common-arcade/protocol'

export function PaidRealtimeGame({
  service,
  table,
  account,
  authorize,
}: {
  service: string
  table: {
    id: string
    releaseId?: string
    stage: string
    runtimeError?: string
  }
  account?: string
  authorize: () => Promise<{ token: string }>
}) {
  const frame = useRef<HTMLIFrameElement>(null)
  const socket = useRef<WebSocket | undefined>(undefined)
  const observation = useRef<Observation | undefined>(undefined)
  const queue = useRef<JsonValue[]>([])
  const inFlight = useRef(false)
  const intent = useRef<string | undefined>(undefined)
  const generation = useRef(0)
  const [state, setState] = useState<'idle' | 'connecting' | 'connected'>(
    'idle',
  )
  const [error, setError] = useState('')
  const [current, setCurrent] = useState<Observation>()
  const active =
    state === 'connected' && table.stage === 'playing' && !table.runtimeError
  const enabled = useRef(active)
  enabled.current = active
  const render = () =>
    frame.current?.contentWindow?.postMessage(
      {
        type: 'arcade.authoritative-state',
        state: observation.current?.visibleState ?? null,
        observation: observation.current,
        match: {
          id: table.id,
          status:
            table.stage === 'playing' && !table.runtimeError
              ? 'running'
              : 'completed',
        },
        mode: active ? 'control' : 'spectate',
        controllerKind: 'human',
        inputEnabled: active,
      },
      '*',
    )
  useEffect(render, [
    current,
    active,
    table.id,
    table.stage,
    table.runtimeError,
  ])
  useEffect(() => {
    setState('idle')
    setCurrent(undefined)
    observation.current = undefined
    return () => {
      ++generation.current
      socket.current?.close()
      socket.current = undefined
      queue.current = []
      inFlight.current = false
    }
  }, [table.id, account])
  function flush() {
    if (
      inFlight.current ||
      !queue.current.length ||
      !observation.current ||
      socket.current?.readyState !== WebSocket.OPEN
    )
      return
    inFlight.current = true
    socket.current.send(
      JSON.stringify({
        type: 'action',
        body: {
          actionId: crypto.randomUUID(),
          sequence: observation.current.stateSequence,
          payload: queue.current.shift(),
        },
      }),
    )
  }
  function submit(payload: JsonValue) {
    if (!enabled.current) return
    if (queue.current.length >= 16) {
      setError('Connection is too slow for game controls. Reconnect to play.')
      socket.current?.close()
      return
    }
    const id =
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? payload.id
        : undefined
    const legal = observation.current?.legalActions ?? []
    const advertised = legal.find(
      (action) =>
        action &&
        typeof action === 'object' &&
        !Array.isArray(action) &&
        typeof id === 'string' &&
        action.id === id,
    )
    const control =
      advertised && typeof advertised === 'object' && !Array.isArray(advertised)
        ? (advertised.control as { mode?: string } | undefined)
        : undefined
    const isRelease =
      typeof id === 'string' &&
      legal.some(
        (action) =>
          action &&
          typeof action === 'object' &&
          !Array.isArray(action) &&
          (action.control as { releaseActionId?: string } | undefined)
            ?.releaseActionId === id,
      )
    const nextIntent =
      control?.mode === 'hold' || isRelease
        ? JSON.stringify(payload)
        : undefined
    if (nextIntent && nextIntent === intent.current) return
    intent.current = nextIntent
    queue.current.push(payload)
    flush()
  }
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || !enabled.current)
        return
      if (event.data?.type === 'arcade.action') {
        try {
          if (JSON.stringify(event.data.action).length <= 16000)
            submit(event.data.action)
        } catch {
          /* Ignore malformed renderer messages. */
        }
      } else if (event.data?.type === 'arcade.release-input') {
        const legal = observation.current?.legalActions ?? []
        const releases = new Set(
          legal.flatMap((action) => {
            if (!action || typeof action !== 'object' || Array.isArray(action))
              return []
            const control = action.control as
              { releaseActionId?: string } | undefined
            return control?.releaseActionId ? [control.releaseActionId] : []
          }),
        )
        for (const action of legal)
          if (
            action &&
            typeof action === 'object' &&
            !Array.isArray(action) &&
            releases.has(String(action.id))
          )
            submit(action)
      }
    }
    window.addEventListener('message', listener)
    return () => window.removeEventListener('message', listener)
  })
  async function connect() {
    const attempt = ++generation.current
    socket.current?.close()
    queue.current = []
    inFlight.current = false
    setState('connecting')
    setError('')
    intent.current = undefined
    try {
      const { token } = await authorize()
      if (attempt !== generation.current) return
      const ws = new WebSocket(
        `${service.replace(/^http/, 'ws')}/v1/economy/live?matchId=${encodeURIComponent(table.id)}`,
      )
      socket.current = ws
      let authenticated = false
      ws.onopen = () => ws.send(JSON.stringify({ type: 'authenticate', token }))
      ws.onmessage = (event) => {
        if (attempt !== generation.current) return
        try {
          const message = JSON.parse(event.data)
          if (message.type === 'authenticated') {
            authenticated = true
            setState('connected')
          }
          if (message.type === 'observation') {
            observation.current = message.observation
            setCurrent(message.observation)
          }
          if (message.type === 'ack') {
            inFlight.current = false
            flush()
          }
          if (message.type === 'error') {
            setError(message.message)
            intent.current = undefined
            inFlight.current = false
            queue.current = []
            if (!authenticated) ws.close()
          }
        } catch {
          setError('Invalid game update. Reconnect to play.')
          ws.close()
        }
      }
      ws.onclose = () => {
        if (attempt === generation.current) {
          setState('idle')
          inFlight.current = false
          queue.current = []
        }
      }
      ws.onerror = () => {
        if (attempt === generation.current)
          setError('Could not connect to the game. Please reconnect.')
      }
    } catch (cause) {
      if (attempt !== generation.current) return
      setState('idle')
      setError(
        cause instanceof Error ? cause.message : 'Could not enable controls',
      )
    }
  }
  return (
    <section className="paid-realtime-game" aria-label="Live paid game">
      <div className="actions">
        <button
          className="primary"
          disabled={
            !account ||
            state !== 'idle' ||
            table.stage !== 'playing' ||
            !!table.runtimeError
          }
          onClick={() => void connect()}
        >
          {state === 'connecting'
            ? 'Enabling controls…'
            : active
              ? 'Game controls enabled'
              : 'Enable game controls'}
        </button>
        <p className="field-hint">
          Approve one wallet signature to control your player. Gameplay moves do
          not request payments.
        </p>
      </div>
      {(error || table.runtimeError) && (
        <p role="status">{table.runtimeError ?? error}</p>
      )}
      <iframe
        ref={frame}
        src={`/api/arcade/v1/studio/releases/${encodeURIComponent(table.releaseId ?? '')}/preview`}
        title="Live paid game"
        sandbox="allow-scripts"
        onLoad={render}
      />
      {active && current && (
        <details className="payment-disclosure">
          <summary>Game controls</summary>
          <div className="actions">
            {current.legalActions.map((action, index) => (
              <button key={index} onClick={() => submit(action)}>
                {action && typeof action === 'object' && !Array.isArray(action)
                  ? String(
                      action.label ??
                        action.id ??
                        action.type ??
                        `Action ${index + 1}`,
                    )
                  : String(action)}
              </button>
            ))}
          </div>
        </details>
      )}
    </section>
  )
}
