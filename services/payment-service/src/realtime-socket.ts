import type { WebSocket } from 'ws'
import type { MatchHost } from './matches.js'
import { actionSchema } from './table-api.js'

/** Paid gameplay transport: funds are handled only through explicit onchain approvals. */
export function attachPaymentSocket(
  host: MatchHost,
  socket: WebSocket,
  id: string,
) {
  let controller: Awaited<ReturnType<MatchHost['connectRealtime']>> | undefined
  let pending = false,
    closed = false,
    windowStart = Date.now(),
    received = 0
  const send = (value: unknown) => {
    if (socket.readyState !== socket.OPEN) return
    if (socket.bufferedAmount > 1_000_000) {
      socket.close(1013, 'Slow consumer')
      return
    }
    socket.send(JSON.stringify(value))
  }
  const update = (table: unknown) => {
    send(table) // Existing read-only clients keep their table-shaped protocol.
    if (!controller)
      void host
        .publicObservation(id)
        .then((state) => {
          if (!closed && !controller) send({ type: 'presentation', state })
        })
        .catch(() => undefined)
    if (controller) {
      try {
        send({ type: 'observation', observation: controller.observation() })
      } catch (error) {
        send({
          type: 'error',
          message: error instanceof Error ? error.message : 'Reconnect to play',
        })
        socket.close(1008, 'Gameplay session ended')
      }
    }
  }
  const unsubscribe = host.subscribe(id, update)
  socket.on('close', () => {
    closed = true
    unsubscribe()
    void controller?.close().catch(() => undefined)
  })
  host
    .view(id)
    .then((value) => {
      if (!closed) update(value)
    })
    .catch(() => socket.close(1008, 'Unknown match'))
  socket.on('message', (raw) => {
    if (Date.now() - windowStart >= 1000) {
      windowStart = Date.now()
      received = 0
    }
    if (++received > 60) {
      socket.close(1008, 'Too many commands')
      return
    }
    // No unbounded queue behind slow disk/RPC work. The browser waits for each acknowledgement.
    if (pending) {
      send({ type: 'error', message: 'Wait for the previous command' })
      return
    }
    pending = true
    void (async () => {
      const message = JSON.parse(String(raw))
      if (
        message.type === 'authenticate' &&
        !controller &&
        typeof message.token === 'string'
      ) {
        controller = await host.connectRealtime(id, message.token)
        if (closed) {
          await controller.close()
          return
        }
        send({ type: 'authenticated' })
        update(await host.view(id))
      } else if (message.type === 'action' && controller) {
        const body = actionSchema.parse(message.body)
        if (body.payload === undefined)
          throw new Error('Realtime commands require an action payload')
        await controller.action({
          actionId: body.actionId,
          sequence: body.sequence,
          payload: body.payload,
        })
        send({ type: 'ack', actionId: body.actionId })
      } else throw new Error('Authenticate a seated wallet to play')
    })()
      .catch((error) =>
        send({
          type: 'error',
          message:
            error instanceof Error ? error.message : 'Invalid gameplay command',
        }),
      )
      .finally(() => {
        pending = false
      })
  })
}
