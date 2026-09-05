import { serve } from '@hono/node-server'
import {
  createApp,
  DynamoDocumentStore,
  MemoryDocumentStore,
} from '@common-arcade/control-api'
import {
  LocalArcadePlatform,
  LocalPlatformError,
  type ConnectedSession,
  type MatchUpdate,
  type PersistedMatch,
} from '@common-arcade/match-worker-service'
import {
  ARCADE_WIRE_VERSION,
  actionSubmissionSchema,
  realtimeEnvelopeSchema,
  type JsonValue,
  type RealtimeEnvelope,
  type RealtimeMessageType,
} from '@common-arcade/protocol'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { WebSocket, WebSocketServer, type RawData } from 'ws'

const MAX_RETAINED_MESSAGES = 256
const RESUME_WINDOW_MS = 30_000
const MAX_PAYLOAD_BYTES = 256 * 1024

interface SessionStream {
  readonly session: ConnectedSession
  nextSequence: number
  readonly history: RealtimeEnvelope[]
  resumeToken: string
  expiresAt: number
  activeSocket?: WebSocket
}

interface SocketContext {
  readonly socket: WebSocket
  readonly stream: SessionStream
  acknowledgedSequence: number
  unsubscribe?: () => void
}

export interface ArcadeServerOptions {
  readonly hostname?: string
  readonly port?: number
  readonly publicBaseUrl?: string
  readonly realtimeUrl?: string
  readonly platform?: LocalArcadePlatform
  readonly logRequests?: boolean
}

export interface RunningArcadeServer {
  readonly hostname: string
  readonly port: number
  readonly baseUrl: string
  readonly realtimeUrl: string
  readonly platform: LocalArcadePlatform
  close(): Promise<void>
}

export function arcadeServerOptionsFromEnvironment(
  environment: NodeJS.ProcessEnv,
): ArcadeServerOptions {
  return {
    hostname: environment.HOST ?? '127.0.0.1',
    port: Number(environment.PORT ?? 4100),
    ...(environment.ARCADE_PUBLIC_BASE_URL === undefined
      ? {}
      : { publicBaseUrl: environment.ARCADE_PUBLIC_BASE_URL }),
    ...(environment.ARCADE_REALTIME_URL === undefined
      ? {}
      : { realtimeUrl: environment.ARCADE_REALTIME_URL }),
    logRequests: true,
  }
}

function asJson(value: unknown): JsonValue {
  return value as JsonValue
}

function randomToken(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

function decode(data: RawData): string {
  if (typeof data === 'string') return data
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8')
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
  return data.toString('utf8')
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve()
      else reject(error)
    })
  })
}

export async function startArcadeServer(
  options: ArcadeServerOptions = {},
): Promise<RunningArcadeServer> {
  const hostname = options.hostname ?? '127.0.0.1'
  const requestedPort = options.port ?? 4100
  const store = process.env.ARCADE_STUDIO_TABLE
    ? new DynamoDocumentStore(process.env.ARCADE_STUDIO_TABLE)
    : new MemoryDocumentStore()
  const platform =
    options.platform ??
    (await LocalArcadePlatform.create({
      savedMatches: store
        ? (
            await store.list<{ version: number; match: PersistedMatch }>(
              'matches',
            )
          ).map((r) => r.match)
        : undefined,
      persistMatch: store
        ? (match, expectedVersion) =>
            store.put(
              'matches',
              match.replay.matchId,
              { version: match.version, match },
              expectedVersion,
            )
        : undefined,
      loadRelease: store
        ? async (id) =>
            (
              await store.get<{
                version: number
                release: import('@common-arcade/studio').StudioRelease
              }>('releases', id)
            )?.release
        : undefined,
    }))
  const streams = new Map<string, SessionStream>()
  const resumeTokens = new Map<string, string>()
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_PAYLOAD_BYTES,
  })

  let baseUrl = options.publicBaseUrl ?? `http://${hostname}:${requestedPort}`
  let realtimeUrl =
    options.realtimeUrl ?? `ws://${hostname}:${requestedPort}/realtime`
  const app = createApp({
    platform,
    store,
    publicBaseUrl: baseUrl,
    realtimeUrl,
    logRequests: options.logRequests ?? false,
  })
  const server = serve({
    fetch: app.fetch,
    hostname,
    port: requestedPort,
  }) as Server
  server.on('upgrade', (request, socket, head) => {
    const requestUrl = new URL(request.url ?? '/', baseUrl)
    if (requestUrl.pathname !== '/realtime') {
      socket.destroy()
      return
    }
    wss.handleUpgrade(request, socket, head, (websocket) => {
      wss.emit('connection', websocket, request)
    })
  })

  await new Promise<void>((resolve, reject) => {
    if (server.listening) {
      resolve()
      return
    }
    server.once('listening', resolve)
    server.once('error', reject)
  })
  const address = server.address() as AddressInfo
  const port = address.port
  if (options.publicBaseUrl === undefined)
    baseUrl = `http://${hostname}:${port}`
  if (options.realtimeUrl === undefined)
    realtimeUrl = `ws://${hostname}:${port}/realtime`

  function envelope(
    stream: SessionStream,
    type: RealtimeMessageType,
    payload: JsonValue,
  ): RealtimeEnvelope {
    const message: RealtimeEnvelope = {
      v: ARCADE_WIRE_VERSION,
      type,
      session: stream.session.sessionId,
      match: stream.session.matchId,
      seq: stream.nextSequence,
      sentAt: new Date().toISOString(),
      payload,
    }
    stream.nextSequence += 1
    stream.history.push(message)
    if (stream.history.length > MAX_RETAINED_MESSAGES) stream.history.shift()
    return message
  }

  function send(
    context: SocketContext,
    type: RealtimeMessageType,
    payload: JsonValue,
  ): void {
    if (context.socket.readyState !== WebSocket.OPEN) return
    context.socket.send(JSON.stringify(envelope(context.stream, type, payload)))
  }

  function issueResumeToken(stream: SessionStream): string {
    if (stream.resumeToken.length > 0) resumeTokens.delete(stream.resumeToken)
    const token = randomToken('resume')
    stream.resumeToken = token
    stream.expiresAt = Date.now() + RESUME_WINDOW_MS
    resumeTokens.set(token, stream.session.sessionId)
    return token
  }

  async function sendProjection(
    context: SocketContext,
    type: 'snapshot' | 'observation.full' = 'snapshot',
  ): Promise<void> {
    if (context.stream.session.mode === 'control') {
      send(
        context,
        'observation.full',
        asJson(platform.observation(context.stream.session.sessionId)),
      )
      return
    }
    send(
      context,
      type,
      asJson(await platform.getMatchView(context.stream.session.matchId)),
    )
  }

  function subscribe(context: SocketContext): void {
    context.unsubscribe = platform.subscribe(
      context.stream.session.matchId,
      (update: MatchUpdate) => {
        if (context.socket.readyState !== WebSocket.OPEN) return
        if (context.stream.session.mode === 'control') {
          send(
            context,
            'observation.full',
            asJson(platform.observation(context.stream.session.sessionId)),
          )
        } else {
          send(context, 'snapshot', asJson(update))
        }
        if (update.events.length > 0) {
          send(context, 'event.batch', asJson(update.events))
        }
        send(context, 'match.transition', asJson(update.match))
      },
    )
  }

  async function welcome(
    context: SocketContext,
    resumed: boolean,
  ): Promise<void> {
    const resumeToken = issueResumeToken(context.stream)
    send(
      context,
      'welcome',
      asJson({
        protocol: ARCADE_WIRE_VERSION,
        profile: 'turn-based-v1',
        compression: 'none',
        heartbeatSeconds: 15,
        maxPayloadBytes: MAX_PAYLOAD_BYTES,
        retainedMessages: MAX_RETAINED_MESSAGES,
        resumeWindowSeconds: RESUME_WINDOW_MS / 1000,
        resumeToken,
        resumed,
      }),
    )
    if (context.stream.session.mode === 'control') {
      send(
        context,
        'control.granted',
        asJson({
          seatId: context.stream.session.seatId,
          controlLease: context.stream.session.controlLease,
          ownershipEpoch: context.stream.session.ownershipEpoch,
        }),
      )
    }
  }

  function attach(socket: WebSocket, stream: SessionStream): SocketContext {
    stream.activeSocket = socket
    const context: SocketContext = {
      socket,
      stream,
      acknowledgedSequence: 0,
    }
    subscribe(context)
    return context
  }

  function wireActiveConnection(context: SocketContext): void {
    context.socket.on('message', (data) => {
      void (async () => {
        let incoming: RealtimeEnvelope
        try {
          incoming = realtimeEnvelopeSchema.parse(JSON.parse(decode(data)))
        } catch {
          send(context, 'error', {
            code: 'INVALID_ENVELOPE',
            detail: 'Message does not match the realtime envelope schema',
            retryable: false,
          })
          return
        }

        if (
          incoming.session !== undefined &&
          incoming.session !== context.stream.session.sessionId
        ) {
          send(context, 'error', {
            code: 'SESSION_MISMATCH',
            detail: 'Envelope session does not match this connection',
            retryable: false,
          })
          return
        }

        switch (incoming.type) {
          case 'action.submit': {
            if (context.stream.session.mode !== 'control') {
              send(context, 'error', {
                code: 'CONTROL_REVOKED',
                detail: 'Spectators cannot submit actions',
                retryable: false,
              })
              return
            }
            const parsed = actionSubmissionSchema.safeParse(incoming.payload)
            if (!parsed.success) {
              send(context, 'error', {
                code: 'INVALID_SCHEMA',
                detail: 'Action does not match the release action schema',
                retryable: false,
              })
              return
            }
            const result = await platform.submitAction(
              context.stream.session.sessionId,
              parsed.data,
            )
            send(context, 'action.result', asJson(result))
            return
          }
          case 'ack': {
            const payload = incoming.payload as { sequence?: unknown }
            if (
              typeof payload === 'object' &&
              payload !== null &&
              Number.isInteger(payload.sequence)
            ) {
              context.acknowledgedSequence = Math.max(
                context.acknowledgedSequence,
                payload.sequence as number,
              )
            }
            return
          }
          case 'ping':
            send(context, 'pong', incoming.payload)
            return
          case 'flow.preference':
            send(context, 'flow.notice', {
              compression: 'none',
              spectatorRate: 'event-driven',
            })
            return
          case 'session.close':
            send(context, 'goodbye', { reason: 'client-request' })
            context.socket.close(1000, 'client-request')
            return
          default:
            send(context, 'error', {
              code: 'UNSUPPORTED_MESSAGE',
              detail: `Client cannot send ${incoming.type} after connection`,
              retryable: false,
            })
        }
      })().catch((error: unknown) => {
        const detail =
          error instanceof Error ? error.message : 'Realtime failure'
        const code =
          error instanceof LocalPlatformError ? error.code : 'INTERNAL_ERROR'
        send(context, 'error', { code, detail, retryable: false })
      })
    })

    context.socket.on('close', () => {
      context.unsubscribe?.()
      if (context.stream.activeSocket !== context.socket) return
      context.stream.activeSocket = undefined
      context.stream.expiresAt = Date.now() + RESUME_WINDOW_MS
      platform.suspendSession(context.stream.session.sessionId)
    })
  }

  wss.on('connection', (socket, request) => {
    const requestUrl = new URL(request.url ?? '/', baseUrl)
    if (requestUrl.pathname !== '/realtime') {
      socket.close(1008, 'unknown-path')
      return
    }

    const handshakeTimer = setTimeout(() => {
      socket.close(1008, 'handshake-timeout')
    }, 5_000)

    socket.once('message', (data) => {
      void (async () => {
        clearTimeout(handshakeTimer)
        const parsed = realtimeEnvelopeSchema.safeParse(
          JSON.parse(decode(data)),
        )
        if (
          !parsed.success ||
          !['hello', 'resume'].includes(parsed.data.type)
        ) {
          socket.close(1008, 'invalid-handshake')
          return
        }
        const incoming = parsed.data
        const matchId = incoming.match ?? requestUrl.searchParams.get('match')
        if (matchId === null || matchId === undefined) {
          socket.close(1008, 'match-required')
          return
        }

        let stream: SessionStream
        let resumed = false
        if (incoming.type === 'hello') {
          const payload = incoming.payload as { ticket?: unknown }
          if (typeof payload.ticket !== 'string') {
            socket.close(1008, 'ticket-required')
            return
          }
          const session = await platform.connectWithTicket(
            payload.ticket,
            matchId,
          )
          stream = {
            session,
            nextSequence: 1,
            history: [],
            resumeToken: '',
            expiresAt: Date.now() + RESUME_WINDOW_MS,
          }
          streams.set(session.sessionId, stream)
        } else {
          const payload = incoming.payload as {
            sessionId?: unknown
            resumeToken?: unknown
            lastSequence?: unknown
          }
          if (
            typeof payload.sessionId !== 'string' ||
            typeof payload.resumeToken !== 'string' ||
            resumeTokens.get(payload.resumeToken) !== payload.sessionId
          ) {
            socket.close(1008, 'invalid-resume')
            return
          }
          const existing = streams.get(payload.sessionId)
          if (
            existing === undefined ||
            existing.resumeToken !== payload.resumeToken ||
            existing.expiresAt < Date.now() ||
            existing.activeSocket !== undefined
          ) {
            socket.close(1008, 'resume-unavailable')
            return
          }
          resumeTokens.delete(payload.resumeToken)
          platform.resumeSession(payload.sessionId, matchId)
          stream = existing
          resumed = true
        }

        const context = attach(socket, stream)
        await welcome(context, resumed)
        if (resumed) {
          send(context, 'resync.required', {
            reason: 'fresh-authoritative-projection',
          })
        }
        await sendProjection(context)
        wireActiveConnection(context)
      })().catch((error: unknown) => {
        clearTimeout(handshakeTimer)
        const reason =
          error instanceof LocalPlatformError
            ? error.code.toLowerCase()
            : 'handshake-failed'
        socket.close(1008, reason)
      })
    })
  })

  const cleanup = setInterval(() => {
    const now = Date.now()
    for (const [sessionId, stream] of streams) {
      if (stream.activeSocket !== undefined || stream.expiresAt >= now) continue
      resumeTokens.delete(stream.resumeToken)
      streams.delete(sessionId)
      platform.disconnectSession(sessionId)
    }
  }, 5_000)
  cleanup.unref()

  return {
    hostname,
    port,
    baseUrl,
    realtimeUrl,
    platform,
    async close() {
      clearInterval(cleanup)
      for (const socket of wss.clients) socket.close(1001, 'server-shutdown')
      wss.close()
      await closeServer(server)
    },
  }
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href

if (isMain) {
  const server = await startArcadeServer(
    arcadeServerOptionsFromEnvironment(process.env),
  )
  console.log(`Common Arcade local stack: ${server.baseUrl}`)
  console.log(`Realtime: ${server.realtimeUrl}`)
}
