import {
  ARCADE_WIRE_VERSION,
  realtimeEnvelopeSchema,
  type ActionSubmission,
  type JsonValue,
  type RealtimeEnvelope,
  type RealtimeMessageType,
} from '@common-arcade/protocol'

export type RealtimeTransportName = 'websocket' | 'webtransport'
export type RealtimeConnectionState =
  'idle' | 'connecting' | 'connected' | 'resuming' | 'disconnected' | 'closed'

export interface MessageEventLike {
  readonly data: unknown
}

export interface CloseEventLike {
  readonly code: number
  readonly reason: string
}

export interface WebSocketLike {
  readonly readyState: number
  send(data: string): void
  close(code?: number, reason?: string): void
  addEventListener(type: 'open', listener: () => void): void
  addEventListener(
    type: 'message',
    listener: (event: MessageEventLike) => void,
  ): void
  addEventListener(
    type: 'close',
    listener: (event: CloseEventLike) => void,
  ): void
  addEventListener(type: 'error', listener: () => void): void
}

export interface RealtimeClientOptions {
  readonly url: string
  readonly matchId: string
  readonly webSocketFactory?: (url: string) => WebSocketLike
}

export interface RealtimeClientSupport {
  readonly status: 'v0alpha1'
  readonly implementedTransports: readonly RealtimeTransportName[]
  readonly capabilities: readonly string[]
}

export const realtimeClientSupport: RealtimeClientSupport = {
  status: 'v0alpha1',
  implementedTransports: ['websocket'],
  capabilities: ['sequence', 'ack', 'resume', 'resync', 'idempotent-actions'],
}

type MessageListener = (message: RealtimeEnvelope) => void
type StateListener = (state: RealtimeConnectionState) => void

function textData(data: unknown): string {
  if (typeof data === 'string') return data
  if (data instanceof ArrayBuffer)
    return new TextDecoder().decode(new Uint8Array(data))
  if (ArrayBuffer.isView(data))
    return new TextDecoder().decode(
      new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    )
  throw new TypeError('Realtime client only accepts JSON text frames')
}

function defaultFactory(url: string): WebSocketLike {
  if (globalThis.WebSocket === undefined) {
    throw new Error(
      'A WebSocket implementation must be provided in this runtime',
    )
  }
  return new globalThis.WebSocket(url) as WebSocketLike
}

export class RealtimeClient {
  readonly #url: string
  readonly #matchId: string
  readonly #factory: (url: string) => WebSocketLike
  readonly #messageListeners = new Set<MessageListener>()
  readonly #stateListeners = new Set<StateListener>()
  #socket?: WebSocketLike
  #state: RealtimeConnectionState = 'idle'
  #sessionId?: string
  #resumeToken?: string
  #lastServerSequence = 0
  #clientSequence = 0

  constructor(options: RealtimeClientOptions) {
    this.#url = options.url
    this.#matchId = options.matchId
    this.#factory = options.webSocketFactory ?? defaultFactory
  }

  get state(): RealtimeConnectionState {
    return this.#state
  }

  get sessionId(): string | undefined {
    return this.#sessionId
  }

  get lastServerSequence(): number {
    return this.#lastServerSequence
  }

  onMessage(listener: MessageListener): () => void {
    this.#messageListeners.add(listener)
    return () => this.#messageListeners.delete(listener)
  }

  onStateChange(listener: StateListener): () => void {
    this.#stateListeners.add(listener)
    return () => this.#stateListeners.delete(listener)
  }

  async connect(ticket: string): Promise<RealtimeEnvelope> {
    this.setState('connecting')
    const socket = await this.openSocket()
    const welcome = this.waitFor('welcome')
    this.sendEnvelope('hello', { ticket }, socket)
    return welcome
  }

  async resume(): Promise<RealtimeEnvelope> {
    if (this.#sessionId === undefined || this.#resumeToken === undefined) {
      throw new Error('No resumable realtime session is available')
    }
    this.setState('resuming')
    const socket = await this.openSocket()
    const welcome = this.waitFor('welcome')
    this.sendEnvelope(
      'resume',
      {
        sessionId: this.#sessionId,
        resumeToken: this.#resumeToken,
        lastSequence: this.#lastServerSequence,
      },
      socket,
    )
    return welcome
  }

  submitAction(action: ActionSubmission): void {
    this.sendEnvelope('action.submit', action as unknown as JsonValue)
  }

  setFlowPreference(preference: JsonValue): void {
    this.sendEnvelope('flow.preference', preference)
  }

  ping(payload: JsonValue = {}): void {
    this.sendEnvelope('ping', payload)
  }

  close(): void {
    if (this.#socket !== undefined && this.#socket.readyState === 1) {
      this.sendEnvelope('session.close', {})
      this.#socket.close(1000, 'client-close')
    }
    this.setState('closed')
  }

  private async openSocket(): Promise<WebSocketLike> {
    const socket = this.#factory(this.#url)
    this.#socket = socket
    socket.addEventListener('message', (event) => {
      if (this.#socket === socket && this.#state !== 'closed')
        this.receive(event)
    })
    socket.addEventListener('close', () => {
      if (this.#state !== 'closed') this.setState('disconnected')
    })
    const opened = new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', resolve)
      socket.addEventListener('error', () =>
        reject(new Error('Realtime WebSocket failed to open')),
      )
    })
    await opened
    return socket
  }

  private receive(event: MessageEventLike): void {
    let message: RealtimeEnvelope
    try {
      message = realtimeEnvelopeSchema.parse(JSON.parse(textData(event.data)))
    } catch {
      return
    }
    if (message.match !== this.#matchId) return
    if (message.seq <= this.#lastServerSequence && this.#state !== 'resuming')
      return
    this.#lastServerSequence = Math.max(this.#lastServerSequence, message.seq)
    if (message.session !== undefined) this.#sessionId = message.session
    if (message.type === 'welcome') {
      const payload = message.payload as { resumeToken?: unknown }
      if (typeof payload.resumeToken === 'string')
        this.#resumeToken = payload.resumeToken
      this.setState('connected')
    }
    if (
      message.type !== 'goodbye' &&
      message.type !== 'error' &&
      this.#socket?.readyState === 1
    ) {
      this.sendEnvelope('ack', { sequence: this.#lastServerSequence })
    }
    // A completion listener may close the socket. Acknowledge before notifying it.
    for (const listener of this.#messageListeners) listener(message)
  }

  private waitFor(type: RealtimeMessageType): Promise<RealtimeEnvelope> {
    return new Promise((resolve, reject) => {
      const timeout = globalThis.setTimeout(() => {
        unsubscribe()
        reject(new Error(`Timed out waiting for realtime ${type}`))
      }, 5_000)
      const unsubscribe = this.onMessage((message) => {
        if (message.type !== type) return
        globalThis.clearTimeout(timeout)
        unsubscribe()
        resolve(message)
      })
    })
  }

  private sendEnvelope(
    type: RealtimeMessageType,
    payload: JsonValue,
    socket = this.#socket,
  ): void {
    if (socket === undefined || socket.readyState !== 1) {
      throw new Error('Realtime connection is not open')
    }
    this.#clientSequence += 1
    socket.send(
      JSON.stringify({
        v: ARCADE_WIRE_VERSION,
        type,
        ...(this.#sessionId === undefined ? {} : { session: this.#sessionId }),
        match: this.#matchId,
        seq: this.#clientSequence,
        sentAt: new Date().toISOString(),
        payload,
      }),
    )
  }

  private setState(state: RealtimeConnectionState): void {
    if (state === this.#state) return
    this.#state = state
    for (const listener of this.#stateListeners) listener(state)
  }
}
