import { describe, expect, it } from 'vitest'
import {
  ARCADE_WIRE_VERSION,
  type RealtimeEnvelope,
} from '@common-arcade/protocol'
import {
  RealtimeClient,
  type CloseEventLike,
  type MessageEventLike,
  type WebSocketLike,
} from './index.js'

class FakeSocket implements WebSocketLike {
  readyState = 0
  readonly sent: RealtimeEnvelope[] = []
  private readonly listeners = new Map<string, Set<(event?: unknown) => void>>()

  constructor(private readonly number: number) {
    queueMicrotask(() => {
      this.readyState = 1
      this.emit('open')
    })
  }

  addEventListener(
    type: 'open' | 'message' | 'close' | 'error',
    listener:
      | (() => void)
      | ((event: MessageEventLike) => void)
      | ((event: CloseEventLike) => void),
  ): void {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener as (event?: unknown) => void)
    this.listeners.set(type, listeners)
  }

  send(data: string): void {
    const message = JSON.parse(data) as RealtimeEnvelope
    this.sent.push(message)
    if (message.type !== 'hello' && message.type !== 'resume') return
    this.serverMessage({
      v: ARCADE_WIRE_VERSION,
      type: 'welcome',
      session: 'ses_clientsession1',
      match: 'mat_clientmatch01',
      seq: this.number === 1 ? 1 : 3,
      sentAt: new Date().toISOString(),
      payload: {
        resumeToken: `resume-token-${this.number}`,
        resumed: this.number > 1,
      },
    })
  }

  close(code = 1000, reason = ''): void {
    this.readyState = 3
    this.emit('close', { code, reason })
  }

  serverMessage(message: RealtimeEnvelope): void {
    this.emit('message', { data: JSON.stringify(message) })
  }

  private emit(type: string, event?: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

describe('RealtimeClient', () => {
  it('negotiates, acknowledges, and resumes from the last sequence', async () => {
    const sockets: FakeSocket[] = []
    const client = new RealtimeClient({
      url: 'wss://realtime.example/realtime?match=mat_clientmatch01',
      matchId: 'mat_clientmatch01',
      webSocketFactory: () => {
        const socket = new FakeSocket(sockets.length + 1)
        sockets.push(socket)
        return socket
      },
    })

    await expect(client.connect('one-use-ticket')).resolves.toMatchObject({
      type: 'welcome',
      seq: 1,
    })
    expect(client.state).toBe('connected')
    const first = sockets[0]
    if (first === undefined) throw new Error('Expected first socket')
    first.serverMessage({
      v: ARCADE_WIRE_VERSION,
      type: 'observation.full',
      session: 'ses_clientsession1',
      match: 'mat_clientmatch01',
      seq: 2,
      sentAt: new Date().toISOString(),
      payload: { stateSequence: 4 },
    })
    expect(first.sent.at(-1)).toMatchObject({
      type: 'ack',
      payload: { sequence: 2 },
    })
    first.close(1006, 'network-lost')
    expect(client.state).toBe('disconnected')

    await expect(client.resume()).resolves.toMatchObject({
      type: 'welcome',
      seq: 3,
      payload: { resumed: true },
    })
    expect(sockets[1]?.sent[0]).toMatchObject({
      type: 'resume',
      payload: {
        sessionId: 'ses_clientsession1',
        resumeToken: 'resume-token-1',
        lastSequence: 2,
      },
    })
    expect(client.state).toBe('connected')
  })
})
