import {
  LocalRealtimeTicketAuthority,
  type RealtimeTicketClaims,
} from '@common-arcade/auth'
import {
  getTicTacToeManifest,
  ticTacToeGame,
  type PlaceAction,
  type TicTacToeState,
} from '@common-arcade/example-tic-tac-toe'
import { AuthoritativeMatch } from '@common-arcade/match-runtime'
import type {
  ActionResult,
  ActionSubmission,
  GameManifest,
  GameReleaseDescriptor,
  JsonValue,
  MatchDescriptor,
  MatchEvent,
  Observation,
  Replay,
} from '@common-arcade/protocol'

export type LocalMatchRuntime = AuthoritativeMatch<TicTacToeState, PlaceAction>

interface MutableSeat {
  readonly id: string
  readonly role: string
  status: 'open' | 'claimed' | 'connected' | 'disconnected'
  actorId?: string
  controllerId?: string
}

interface MatchRecord {
  readonly runtime: LocalMatchRuntime
  readonly manifest: GameManifest
  readonly createdAt: string
  updatedAt: string
  readonly seats: MutableSeat[]
}

interface SessionRecord {
  readonly sessionId: string
  readonly matchId: string
  readonly mode: 'control' | 'spectate'
  readonly actorId: string
  readonly seatId?: string
  readonly controllerId?: string
  readonly controlLease?: string
  readonly ownershipEpoch: number
  connected: boolean
}

export interface CreateMatchRequest {
  readonly releaseId: string
  readonly configuration?: JsonValue
  readonly seed?: string
  readonly idempotencyKey: string
}

export interface ClaimSeatRequest {
  readonly matchId: string
  readonly seatId: string
  readonly actorId: string
  readonly controllerId: string
}

export interface CreateSessionRequest {
  readonly matchId: string
  readonly mode: 'control' | 'spectate'
  readonly actorId: string
  readonly seatId?: string
  readonly controllerId?: string
}

export interface SessionTicketDescriptor {
  readonly sessionId: string
  readonly ticket: string
  readonly expiresInSeconds: number
}

export interface ConnectedSession {
  readonly sessionId: string
  readonly matchId: string
  readonly mode: 'control' | 'spectate'
  readonly actorId: string
  readonly seatId?: string
  readonly controllerId?: string
  readonly controlLease?: string
  readonly ownershipEpoch: number
}

export interface MatchView {
  readonly match: MatchDescriptor
  readonly publicState: JsonValue
  readonly events: readonly MatchEvent[]
}

export interface MatchUpdate extends MatchView {
  readonly actionResult?: ActionResult
}

export class LocalPlatformError extends Error {
  constructor(
    readonly code:
      | 'NOT_FOUND'
      | 'CONFLICT'
      | 'INVALID_REQUEST'
      | 'CONTROL_REVOKED'
      | 'MATCH_NOT_RUNNING',
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'LocalPlatformError'
  }
}

function opaqueId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

export class LocalArcadePlatform {
  private readonly matches = new Map<string, MatchRecord>()
  private readonly idempotency = new Map<string, string>()
  private readonly sessions = new Map<string, SessionRecord>()
  private readonly listeners = new Map<
    string,
    Set<(update: MatchUpdate) => void>
  >()

  private constructor(
    private readonly tickets: LocalRealtimeTicketAuthority,
    private readonly now: () => Date,
  ) {}

  static async create(
    options: {
      readonly ticketSecret?: Uint8Array
      readonly now?: () => Date
    } = {},
  ): Promise<LocalArcadePlatform> {
    const now = options.now ?? (() => new Date())
    const secret =
      options.ticketSecret ?? crypto.getRandomValues(new Uint8Array(32))
    const tickets = await LocalRealtimeTicketAuthority.create(secret, {
      now: () => now().getTime(),
    })
    return new LocalArcadePlatform(tickets, now)
  }

  async listGames(): Promise<readonly GameManifest[]> {
    return [await getTicTacToeManifest()]
  }

  async getGame(gameId: string): Promise<GameManifest> {
    const manifest = await getTicTacToeManifest()
    if (manifest.metadata.id !== gameId) {
      throw new LocalPlatformError('NOT_FOUND', 404, `Unknown game ${gameId}`)
    }
    return manifest
  }

  async listGameReleases(
    gameId: string,
  ): Promise<readonly GameReleaseDescriptor[]> {
    return [await this.getRelease(ticTacToeGame.releaseId, gameId)]
  }

  async getRelease(
    releaseId: string,
    expectedGameId?: string,
  ): Promise<GameReleaseDescriptor> {
    const manifest = await getTicTacToeManifest()
    if (
      releaseId !== ticTacToeGame.releaseId ||
      (expectedGameId !== undefined && expectedGameId !== manifest.metadata.id)
    ) {
      throw new LocalPlatformError(
        'NOT_FOUND',
        404,
        `Unknown release ${releaseId}`,
      )
    }
    return {
      id: ticTacToeGame.releaseId,
      gameId: manifest.metadata.id,
      version: manifest.metadata.version,
      digest: manifest.metadata.digest,
      status: 'published',
      profiles: manifest.spec.profiles,
    }
  }

  async createMatch(request: CreateMatchRequest): Promise<MatchDescriptor> {
    if (
      request.idempotencyKey.length < 8 ||
      request.idempotencyKey.length > 200
    ) {
      throw new LocalPlatformError(
        'INVALID_REQUEST',
        400,
        'An idempotency key between 8 and 200 characters is required',
      )
    }
    const existingId = this.idempotency.get(request.idempotencyKey)
    if (existingId !== undefined) return this.describe(this.record(existingId))

    const manifest = await getTicTacToeManifest()
    if (request.releaseId !== ticTacToeGame.releaseId) {
      throw new LocalPlatformError(
        'NOT_FOUND',
        404,
        `Unknown release ${request.releaseId}`,
      )
    }
    const matchId = opaqueId('mat')
    const suffix = matchId.slice(4)
    const seats: MutableSeat[] = [
      { id: `sea_${suffix}_1`, role: 'player', status: 'open' },
      { id: `sea_${suffix}_2`, role: 'player', status: 'open' },
    ]
    const runtime = await AuthoritativeMatch.create({
      matchId,
      game: ticTacToeGame,
      seed: request.seed ?? opaqueId('seed'),
      configuration: request.configuration ?? {},
      roster: seats.map((seat) => ({ seatId: seat.id, role: seat.role })),
      now: this.now,
    })
    const timestamp = this.now().toISOString()
    const record: MatchRecord = {
      runtime,
      manifest,
      createdAt: timestamp,
      updatedAt: timestamp,
      seats,
    }
    this.matches.set(matchId, record)
    this.idempotency.set(request.idempotencyKey, matchId)
    return this.describe(record)
  }

  async getMatch(matchId: string): Promise<MatchDescriptor> {
    return this.describe(this.record(matchId))
  }

  async getMatchView(
    matchId: string,
    afterEventSequence = 0,
  ): Promise<MatchView> {
    const record = this.record(matchId)
    return {
      match: await this.describe(record),
      publicState: record.runtime.publicState(),
      events: record.runtime.eventLog(afterEventSequence),
    }
  }

  async claimSeat(request: ClaimSeatRequest): Promise<MatchDescriptor> {
    const record = this.record(request.matchId)
    const seat = record.seats.find(
      (candidate) => candidate.id === request.seatId,
    )
    if (seat === undefined) {
      throw new LocalPlatformError(
        'NOT_FOUND',
        404,
        `Unknown seat ${request.seatId}`,
      )
    }
    if (
      seat.status !== 'open' &&
      (seat.actorId !== request.actorId ||
        seat.controllerId !== request.controllerId)
    ) {
      throw new LocalPlatformError(
        'CONFLICT',
        409,
        'Seat is already controlled',
      )
    }
    seat.actorId = request.actorId
    seat.controllerId = request.controllerId
    seat.status = 'claimed'
    if (
      record.seats.every((candidate) => candidate.status !== 'open') &&
      record.runtime.getStatus() === 'lobby'
    ) {
      record.runtime.start()
    }
    record.updatedAt = this.now().toISOString()
    const descriptor = await this.describe(record)
    await this.notify(request.matchId)
    return descriptor
  }

  async createSession(
    request: CreateSessionRequest,
  ): Promise<SessionTicketDescriptor> {
    const record = this.record(request.matchId)
    if (request.mode === 'control') {
      const seat = record.seats.find(
        (candidate) => candidate.id === request.seatId,
      )
      if (
        seat === undefined ||
        seat.actorId !== request.actorId ||
        seat.controllerId !== request.controllerId
      ) {
        throw new LocalPlatformError(
          'CONTROL_REVOKED',
          403,
          'The actor does not hold the requested seat',
        )
      }
    }
    const sessionId = opaqueId('ses')
    const scopes =
      request.mode === 'control' && request.seatId !== undefined
        ? [`seats:control:${request.matchId}:${request.seatId}`]
        : [`matches:spectate:${request.matchId}`]
    const ticket = await this.tickets.mint({
      mode: request.mode,
      matchId: request.matchId,
      ...(request.seatId === undefined ? {} : { seatId: request.seatId }),
      sessionId,
      actorId: request.actorId,
      ...(request.controllerId === undefined
        ? {}
        : { controllerId: request.controllerId }),
      scopes,
      ttlSeconds: 30,
    })
    return { sessionId, ticket, expiresInSeconds: 30 }
  }

  async connectWithTicket(
    ticket: string,
    expectedMatchId: string,
  ): Promise<ConnectedSession> {
    const claims = await this.tickets.redeem(ticket, {
      audience: 'arcade-realtime',
      matchId: expectedMatchId,
    })
    if (this.sessions.has(claims.sessionId)) {
      throw new LocalPlatformError(
        'CONFLICT',
        409,
        'Session has already connected',
      )
    }
    const record = this.record(claims.matchId)
    this.assertTicketBinding(record, claims)
    const controlLease =
      claims.mode === 'control' ? opaqueId('lease') : undefined
    const session: SessionRecord = {
      sessionId: claims.sessionId,
      matchId: claims.matchId,
      mode: claims.mode,
      actorId: claims.actorId,
      ...(claims.seatId === undefined ? {} : { seatId: claims.seatId }),
      ...(claims.controllerId === undefined
        ? {}
        : { controllerId: claims.controllerId }),
      ...(controlLease === undefined ? {} : { controlLease }),
      ownershipEpoch: record.runtime.getOwnershipEpoch(),
      connected: true,
    }
    this.sessions.set(session.sessionId, session)
    if (session.seatId !== undefined) {
      const seat = record.seats.find(
        (candidate) => candidate.id === session.seatId,
      )
      if (seat !== undefined) seat.status = 'connected'
    }
    record.updatedAt = this.now().toISOString()
    await this.notify(record.runtime.matchId)
    return session
  }

  disconnectSession(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (session === undefined) return
    this.sessions.delete(sessionId)
    if (session.seatId !== undefined) {
      const record = this.record(session.matchId)
      const seat = record.seats.find(
        (candidate) => candidate.id === session.seatId,
      )
      if (seat !== undefined) seat.status = 'disconnected'
      record.updatedAt = this.now().toISOString()
      void this.notify(session.matchId)
    }
  }

  suspendSession(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (session === undefined || !session.connected) return
    session.connected = false
    if (session.seatId !== undefined) {
      const record = this.record(session.matchId)
      const seat = record.seats.find(
        (candidate) => candidate.id === session.seatId,
      )
      if (seat !== undefined) seat.status = 'disconnected'
      record.updatedAt = this.now().toISOString()
      void this.notify(session.matchId)
    }
  }

  resumeSession(sessionId: string, expectedMatchId: string): ConnectedSession {
    const session = this.sessionRecord(sessionId)
    if (session.matchId !== expectedMatchId) {
      throw new LocalPlatformError(
        'CONTROL_REVOKED',
        403,
        'Resume session is bound to a different match',
      )
    }
    session.connected = true
    if (session.seatId !== undefined) {
      const record = this.record(session.matchId)
      const seat = record.seats.find(
        (candidate) => candidate.id === session.seatId,
      )
      if (seat !== undefined) seat.status = 'connected'
      record.updatedAt = this.now().toISOString()
      void this.notify(session.matchId)
    }
    return session
  }

  getSession(sessionId: string): ConnectedSession {
    const session = this.sessionRecord(sessionId)
    if (!session.connected) {
      throw new LocalPlatformError('NOT_FOUND', 404, 'Session is not connected')
    }
    return session
  }

  observation(sessionId: string): Observation {
    const session = this.getSession(sessionId)
    if (session.mode !== 'control' || session.seatId === undefined) {
      throw new LocalPlatformError(
        'CONTROL_REVOKED',
        403,
        'Spectator sessions do not receive private seat observations',
      )
    }
    return this.record(session.matchId).runtime.observation(session.seatId)
  }

  async submitAction(
    sessionId: string,
    action: ActionSubmission,
  ): Promise<ActionResult> {
    const session = this.getSession(sessionId)
    if (
      session.mode !== 'control' ||
      session.seatId === undefined ||
      session.controlLease === undefined ||
      action.matchId !== session.matchId ||
      action.seatId !== session.seatId ||
      action.controlLease !== session.controlLease
    ) {
      throw new LocalPlatformError(
        'CONTROL_REVOKED',
        403,
        'Action is not bound to the active control lease',
      )
    }
    const record = this.record(session.matchId)
    const result = await record.runtime.submitAction(
      action,
      session.ownershipEpoch,
    )
    record.updatedAt = this.now().toISOString()
    await this.notify(session.matchId, result)
    return result
  }

  getReplay(matchId: string): Replay {
    return this.record(matchId).runtime.exportReplay()
  }

  async pauseMatch(matchId: string): Promise<MatchDescriptor> {
    const record = this.record(matchId)
    record.runtime.pause()
    record.updatedAt = this.now().toISOString()
    await this.notify(matchId)
    return this.describe(record)
  }

  async resumeMatch(matchId: string): Promise<MatchDescriptor> {
    const record = this.record(matchId)
    record.runtime.resume()
    record.updatedAt = this.now().toISOString()
    await this.notify(matchId)
    return this.describe(record)
  }

  subscribe(
    matchId: string,
    listener: (update: MatchUpdate) => void,
  ): () => void {
    this.record(matchId)
    const listeners = this.listeners.get(matchId) ?? new Set()
    listeners.add(listener)
    this.listeners.set(matchId, listeners)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) this.listeners.delete(matchId)
    }
  }

  private record(matchId: string): MatchRecord {
    const record = this.matches.get(matchId)
    if (record === undefined) {
      throw new LocalPlatformError('NOT_FOUND', 404, `Unknown match ${matchId}`)
    }
    return record
  }

  private sessionRecord(sessionId: string): SessionRecord {
    const session = this.sessions.get(sessionId)
    if (session === undefined) {
      throw new LocalPlatformError('NOT_FOUND', 404, 'Session does not exist')
    }
    return session
  }

  private async describe(record: MatchRecord): Promise<MatchDescriptor> {
    const snapshot = await record.runtime.snapshot()
    return {
      id: record.runtime.matchId,
      releaseId: record.runtime.game.releaseId,
      releaseDigest: record.manifest.metadata.digest,
      mode: record.runtime.game.mode,
      status: snapshot.status,
      ownershipEpoch: snapshot.ownershipEpoch,
      stateSequence: snapshot.stateSequence,
      eventSequence: snapshot.eventSequence,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      seats: record.seats.map((seat) => ({
        id: seat.id,
        role: seat.role,
        status: seat.status,
        ...(seat.actorId === undefined ? {} : { actorId: seat.actorId }),
      })),
      ...(snapshot.result === undefined ? {} : { result: snapshot.result }),
    }
  }

  private assertTicketBinding(
    record: MatchRecord,
    claims: RealtimeTicketClaims,
  ): void {
    if (claims.mode !== 'control') return
    const seat = record.seats.find(
      (candidate) => candidate.id === claims.seatId,
    )
    if (
      seat === undefined ||
      seat.actorId !== claims.actorId ||
      seat.controllerId !== claims.controllerId
    ) {
      throw new LocalPlatformError(
        'CONTROL_REVOKED',
        403,
        'Ticket no longer matches the active seat controller',
      )
    }
  }

  private async notify(
    matchId: string,
    actionResult?: ActionResult,
  ): Promise<void> {
    const listeners = this.listeners.get(matchId)
    if (listeners === undefined || listeners.size === 0) return
    const view = await this.getMatchView(matchId)
    const update: MatchUpdate = {
      ...view,
      ...(actionResult === undefined ? {} : { actionResult }),
    }
    for (const listener of listeners) listener(update)
  }
}
