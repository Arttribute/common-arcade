import {
  createBrowserPolicy,
  livePolicyObservation,
  coachedStrategySchema,
  isBrowserGame,
  resolveGameConfiguration,
  type ExecutableStrategy,
} from '@common-arcade/studio'
import { assessLiveReadiness, type StudioRelease } from '@common-arcade/studio'
import { compileGame } from '@common-arcade/studio/runtime'
import {
  LocalRealtimeTicketAuthority,
  type RealtimeTicketClaims,
} from '@common-arcade/auth'
import {
  getTicTacToeManifest,
  ticTacToeGame,
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

export type LocalMatchRuntime = AuthoritativeMatch<any, any>

interface MutableSeat {
  readonly id: string
  readonly role: string
  readonly team?: string
  status: 'open' | 'claimed' | 'connected' | 'disconnected'
  actorId?: string
  controllerId?: string
  controllerKind?: 'human' | 'agent'
  controlGeneration?: number
  released?: boolean
  heldReleaseAction?: JsonValue
}

export interface MatchLobbyRules {
  readonly joinPolicy: 'open' | 'invite-only'
  readonly allowedControllers: ('human' | 'agent')[]
  readonly invitedActorIds: string[]
  readonly spectating: 'enabled' | 'disabled'
}

export interface MatchSeriesRules {
  readonly maximumRounds: number
  readonly restartPolicy: 'automatic' | 'owner' | 'unanimous'
}

interface MatchSeriesState extends MatchSeriesRules {
  currentRound: number
  status: 'active' | 'awaiting-restart' | 'complete'
  scores: Record<string, number>
  restartVotes: string[]
}

export interface PersistedMatch {
  version: number
  idempotencyKey: string
  replay: Replay
  manifest: GameManifest
  seats: MutableSeat[]
  status: MatchDescriptor['status']
  ownershipEpoch: number
  createdAt: string
  updatedAt: string
  ownerId?: string
  visibility?: 'public' | 'unlisted' | 'private'
  lobby?: MatchLobbyRules
  series?: MatchSeriesState
  completedRounds?: Replay[]
}

interface MatchRecord {
  version: number
  idempotencyKey: string
  runtime: LocalMatchRuntime
  readonly manifest: GameManifest
  readonly createdAt: string
  updatedAt: string
  readonly seats: MutableSeat[]
  readonly ownerId?: string
  readonly visibility: 'public' | 'unlisted' | 'private'
  readonly lobby: MatchLobbyRules
  readonly series: MatchSeriesState
  readonly completedRounds: Replay[]
  lastActiveAt: number
}

interface SessionRecord {
  readonly sessionId: string
  readonly matchId: string
  readonly mode: 'control' | 'spectate'
  readonly actorId: string
  readonly seatId?: string
  readonly controllerId?: string
  readonly controlLease?: string
  ownershipEpoch: number
  connected: boolean
}

export interface CreateMatchRequest {
  readonly releaseId: string
  readonly configuration?: JsonValue
  readonly roleCounts?: Readonly<Record<string, number>>
  readonly seed?: string
  readonly idempotencyKey: string
  readonly ownerId?: string
  readonly visibility?: 'public' | 'unlisted' | 'private'
  readonly lobby?: Partial<MatchLobbyRules>
  readonly series?: Partial<MatchSeriesRules>
}

export interface RestartRoundInput {
  readonly configuration?: JsonValue
  readonly roleCounts?: Readonly<Record<string, number>>
}

export interface ClaimSeatRequest {
  readonly matchId: string
  readonly seatId: string
  readonly actorId: string
  readonly controllerId: string
  readonly controllerKind?: 'human' | 'agent'
}

export interface SeatControlRequest {
  readonly matchId: string
  readonly seatId: string
  readonly actorId: string
  readonly expectedControllerId: string
}

export interface ChangeSeatControllerRequest extends SeatControlRequest {
  readonly controllerId: string
  readonly controllerKind: 'human' | 'agent'
}

export interface JoinMatchRequest {
  readonly matchId: string
  readonly actorId: string
  readonly controllerId: string
  readonly controllerKind: 'human' | 'agent'
}

export interface FindMatchRequest extends Omit<
  CreateMatchRequest,
  'visibility' | 'ownerId'
> {
  readonly actorId: string
  readonly controllerId: string
  readonly controllerKind: 'human' | 'agent'
}

export interface JoinedMatch {
  readonly match: MatchDescriptor
  readonly seatId: string
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

type ResolvedRole = GameManifest['spec']['seats']['roles'][number] & {
  readonly resolvedCount: number
}

function resolveRoleAllocation(
  manifest: GameManifest,
  roleCounts?: Readonly<Record<string, number>>,
): ResolvedRole[] {
  if (roleCounts !== undefined) {
    if (
      roleCounts === null ||
      typeof roleCounts !== 'object' ||
      Array.isArray(roleCounts) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(roleCounts))
    )
      throw new LocalPlatformError(
        'INVALID_REQUEST',
        422,
        'Role counts must be an object keyed by role id.',
      )
    const names = Object.keys(roleCounts)
    if (names.length > 16)
      throw new LocalPlatformError(
        'INVALID_REQUEST',
        422,
        'Role counts support at most 16 roles.',
      )
    const malformed = names
      .sort()
      .find((name) => !/^[a-z][a-z0-9-]{0,62}$/.test(name))
    if (malformed !== undefined)
      throw new LocalPlatformError(
        'INVALID_REQUEST',
        422,
        `Invalid role id "${malformed}".`,
      )
    const known = new Set(manifest.spec.seats.roles.map((role) => role.id))
    const unknown = names.find((name) => !known.has(name))
    if (unknown !== undefined)
      throw new LocalPlatformError(
        'INVALID_REQUEST',
        422,
        `Unknown role "${unknown}".`,
      )
  }

  const resolved = manifest.spec.seats.roles.map((role) => {
    const count =
      roleCounts !== undefined && Object.hasOwn(roleCounts, role.id)
        ? roleCounts[role.id]
        : role.count
    if (
      !Number.isInteger(count) ||
      count === undefined ||
      count < 0 ||
      count > 16
    )
      throw new LocalPlatformError(
        'INVALID_REQUEST',
        422,
        `Role "${role.id}" must have an integer count between 0 and 16.`,
      )
    const minimum = role.minCount ?? role.count
    const maximum = role.maxCount ?? role.count
    if (count < minimum || count > maximum)
      throw new LocalPlatformError(
        'INVALID_REQUEST',
        422,
        `Role "${role.id}" must have between ${minimum} and ${maximum} seats.`,
      )
    return { ...role, resolvedCount: count }
  })
  const total = resolved.reduce((sum, role) => sum + role.resolvedCount, 0)
  if (total < manifest.spec.seats.min || total > manifest.spec.seats.max)
    throw new LocalPlatformError(
      'INVALID_REQUEST',
      422,
      `Resolved role counts must total between ${manifest.spec.seats.min} and ${manifest.spec.seats.max} seats.`,
    )
  return resolved
}

function resolveConfiguration(
  release: StudioRelease | undefined,
  configuration: JsonValue | undefined,
): Record<string, JsonValue> {
  try {
    return resolveGameConfiguration(
      release && isBrowserGame(release.document)
        ? release.document.configurationSchema
        : undefined,
      configuration === undefined ? {} : configuration,
    )
  } catch (error) {
    throw new LocalPlatformError(
      'INVALID_REQUEST',
      422,
      `Invalid match configuration: ${error instanceof Error ? error.message : 'validation failed.'}`,
    )
  }
}

function canonicalJson(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(',')}}`
  return JSON.stringify(value)
}

function roleAllocation(record: MatchRecord): string {
  const counts = new Map<string, number>()
  for (const seat of record.runtime.roster)
    counts.set(seat.role, (counts.get(seat.role) ?? 0) + 1)
  return JSON.stringify(
    record.manifest.spec.seats.roles.map((role) => [
      role.id,
      counts.get(role.id) ?? 0,
    ]),
  )
}

function resolvedRoleAllocation(roles: readonly ResolvedRole[]): string {
  return JSON.stringify(roles.map((role) => [role.id, role.resolvedCount]))
}

function reconciledSeats(
  record: MatchRecord,
  roles: readonly ResolvedRole[],
): MutableSeat[] {
  for (const role of roles) {
    const occupied = record.seats.filter(
      (seat) => seat.role === role.id && seat.actorId !== undefined,
    ).length
    if (role.resolvedCount < occupied)
      throw new LocalPlatformError(
        'INVALID_REQUEST',
        422,
        `Role "${role.id}" cannot be reduced below its ${occupied} occupied seats.`,
      )
  }

  return roles.flatMap((role) => {
    const existing = record.seats.filter((seat) => seat.role === role.id)
    const remove = Math.max(0, existing.length - role.resolvedCount)
    const removable = existing
      .filter(
        (seat) =>
          seat.actorId === undefined &&
          (record.series.scores[seat.id] ?? 0) === 0,
      )
      .reverse()
    if (removable.length < remove)
      throw new LocalPlatformError(
        'INVALID_REQUEST',
        422,
        `Role "${role.id}" cannot remove occupied or scored seats during a series.`,
      )
    const removed = new Set(removable.slice(0, remove))
    const kept = existing.filter((seat) => !removed.has(seat))
    return [
      ...kept,
      ...Array.from(
        { length: Math.max(0, role.resolvedCount - kept.length) },
        (): MutableSeat => ({
          id: opaqueId('sea'),
          role: role.id,
          ...(role.team === undefined ? {} : { team: role.team }),
          status: 'open',
        }),
      ),
    ]
  })
}

function startThresholdReached(record: MatchRecord): boolean {
  return record.manifest.spec.seats.lateJoin
    ? record.seats.filter((seat) => seat.status !== 'open').length >=
        record.manifest.spec.seats.min
    : record.seats.every((seat) => seat.status !== 'open')
}

function opaqueId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

function lobbyRules(request: CreateMatchRequest): MatchLobbyRules {
  const allowedControllers = request.lobby?.allowedControllers ?? [
    'human',
    'agent',
  ]
  if (allowedControllers.length === 0)
    throw new LocalPlatformError(
      'INVALID_REQUEST',
      400,
      'At least one controller type must be allowed.',
    )
  return {
    joinPolicy: request.lobby?.joinPolicy ?? 'open',
    allowedControllers: [...new Set(allowedControllers)],
    invitedActorIds: [...new Set(request.lobby?.invitedActorIds ?? [])],
    spectating: request.lobby?.spectating ?? 'enabled',
  }
}

function seriesState(request: CreateMatchRequest): MatchSeriesState {
  const maximumRounds = request.series?.maximumRounds ?? 1
  if (
    !Number.isInteger(maximumRounds) ||
    maximumRounds < 1 ||
    maximumRounds > 99
  )
    throw new LocalPlatformError(
      'INVALID_REQUEST',
      400,
      'A series must contain between 1 and 99 rounds.',
    )
  return {
    maximumRounds,
    restartPolicy: request.series?.restartPolicy ?? 'owner',
    currentRound: 1,
    status: 'active',
    scores: {},
    restartVotes: [],
  }
}

type ManagedAgentPolicy = {
  sessionId: string
  actorId: string
  controllerId: string
  strategy: string
  executableStrategy: ExecutableStrategy
  strategyEpoch: number
  sequence: number
  nextDecision: number
  lastStateSequence?: number
  held?: {
    id: string
    payload: JsonValue
    mode: string
    refreshMs: number
    releaseActionId?: string
  }
  lastApply?: number
  prior?: { state: unknown; actionId: string; at: number }
  policyMemory?: Parameters<
    ReturnType<typeof createBrowserPolicy>['choose']
  >[1]['policyMemory']
}

export class LocalArcadePlatform {
  private readonly coachingRequests = new Map<string, string>()
  private readonly agentPolicies = new Map<string, ManagedAgentPolicy>()
  private readonly agentTimers = new Map<
    string,
    ReturnType<typeof setInterval>
  >()
  private readonly playerPolicy = createBrowserPolicy()
  private readonly operations = new Map<string, Promise<unknown>>()
  private readonly matches = new Map<string, MatchRecord>()
  private readonly idempotency = new Map<string, string>()
  private readonly sessions = new Map<string, SessionRecord>()
  private maintenance?: ReturnType<typeof setInterval>
  private readonly clocks = new Map<string, ReturnType<typeof setInterval>>()
  private readonly listeners = new Map<
    string,
    Set<(update: MatchUpdate) => void>
  >()

  private constructor(
    private readonly tickets: LocalRealtimeTicketAuthority,
    private readonly now: () => Date,
    private readonly loadRelease?: (
      id: string,
    ) => Promise<StudioRelease | undefined>,
    private readonly persistMatch?: (
      record: PersistedMatch,
      expectedVersion?: number,
    ) => Promise<void>,
  ) {}

  static async create(
    options: {
      readonly savedMatches?: PersistedMatch[]
      readonly persistMatch?: (
        record: PersistedMatch,
        expectedVersion?: number,
      ) => Promise<void>
      readonly loadRelease?: (id: string) => Promise<StudioRelease | undefined>
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
    const platform = new LocalArcadePlatform(
      tickets,
      now,
      options.loadRelease,
      options.persistMatch,
    )
    for (const saved of options.savedMatches ?? []) {
      try {
        const release = await options.loadRelease?.(saved.replay.releaseId)
        if (!release && saved.replay.releaseId !== ticTacToeGame.releaseId)
          throw new Error(
            'The saved release is unavailable; refusing to substitute another game.',
          )
        const game = release
          ? await compileGame(release.document, release.id, release.digest)
          : ticTacToeGame
        const runtime = await AuthoritativeMatch.restoreCheckpoint(
          game,
          saved.replay,
          saved.status,
          saved.ownershipEpoch + 1,
          now,
        )
        const record: MatchRecord = {
          runtime,
          version: saved.version,
          idempotencyKey: saved.idempotencyKey,
          manifest: saved.manifest,
          seats: saved.seats.map((s) => ({
            ...s,
            status: s.status === 'open' ? 'open' : 'disconnected',
          })),
          createdAt: saved.createdAt,
          updatedAt: saved.updatedAt,
          ownerId: saved.ownerId,
          visibility: saved.visibility ?? 'unlisted',
          lobby:
            saved.lobby ??
            lobbyRules({
              releaseId: saved.replay.releaseId,
              idempotencyKey: saved.idempotencyKey,
            }),
          series: saved.series ?? {
            ...seriesState({
              releaseId: saved.replay.releaseId,
              idempotencyKey: saved.idempotencyKey,
            }),
            status: saved.status === 'completed' ? 'complete' : 'active',
          },
          completedRounds: saved.completedRounds ?? [],
          lastActiveAt: now().getTime(),
        }
        await platform.persist(record)
        platform.matches.set(saved.replay.matchId, record)
        platform.idempotency.set(
          JSON.stringify([saved.ownerId ?? null, saved.idempotencyKey]),
          saved.replay.matchId,
        )
        if (runtime.getStatus() === 'running') platform.startClock(record)
      } catch (error) {
        console.error('Match recovery failed', saved.replay.matchId, error)
      }
    }
    platform.startMaintenance()
    return platform
  }

  async listGames(): Promise<readonly GameManifest[]> {
    return []
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

  private async resolveRelease(releaseId: string): Promise<{
    readonly custom?: StudioRelease
    readonly manifest: GameManifest
  }> {
    const custom = await this.loadRelease?.(releaseId)
    if (custom && !assessLiveReadiness(custom.document).liveReady)
      throw new LocalPlatformError(
        'INVALID_REQUEST',
        422,
        'This release has no authoritative runtime. Open it in Studio and publish a live-ready release.',
      )
    if (custom) return { custom, manifest: custom.manifest }
    if (releaseId !== ticTacToeGame.releaseId)
      throw new LocalPlatformError(
        'NOT_FOUND',
        404,
        `Unknown release ${releaseId}`,
      )
    return { manifest: await getTicTacToeManifest() }
  }

  async createMatch(request: CreateMatchRequest): Promise<MatchDescriptor> {
    return this.exclusive('create-match', () =>
      this.createMatchInternal(request),
    )
  }
  private async createMatchInternal(
    request: CreateMatchRequest,
  ): Promise<MatchDescriptor> {
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
    const requestKey = JSON.stringify([
      request.ownerId ?? null,
      request.idempotencyKey,
    ])
    const existingId = this.idempotency.get(requestKey)
    if (existingId !== undefined) return this.describe(this.record(existingId))

    const active = [...this.matches.values()].filter((record) =>
      ['lobby', 'ready', 'running', 'paused'].includes(
        record.runtime.getStatus(),
      ),
    )
    if (
      active.length >= 24 ||
      active.filter((record) => record.ownerId === request.ownerId).length >=
        4 ||
      active.filter(
        (record) => record.runtime.game.releaseId === request.releaseId,
      ).length >= 12
    )
      throw new LocalPlatformError(
        'CONFLICT',
        429,
        'Active match capacity reached. End an existing match before creating another.',
      )
    const { custom, manifest } = await this.resolveRelease(request.releaseId)
    const roles = resolveRoleAllocation(manifest, request.roleCounts)
    const configuration = resolveConfiguration(custom, request.configuration)
    const matchId = `mat_${Buffer.from(
      await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(requestKey),
      ),
    )
      .toString('hex')
      .slice(0, 32)}`
    const suffix = matchId.slice(4)
    const declaredRoles = roles.flatMap((role) =>
      Array.from({ length: role.resolvedCount }, () => ({
        role: role.id,
        ...(role.team === undefined ? {} : { team: role.team }),
      })),
    )
    const seats: MutableSeat[] = declaredRoles.map((seat, index) => ({
      id: `sea_${suffix}_${index + 1}`,
      role: seat.role,
      ...(seat.team === undefined ? {} : { team: seat.team }),
      status: 'open',
    }))
    const game = custom
      ? await compileGame(custom.document, custom.id, custom.digest)
      : ticTacToeGame
    let runtime: LocalMatchRuntime
    try {
      runtime = await AuthoritativeMatch.create({
        matchId,
        game,
        seed: request.seed ?? opaqueId('seed'),
        configuration,
        roster: seats.map((seat) => ({
          seatId: seat.id,
          role: seat.role,
          ...(seat.team === undefined ? {} : { team: seat.team }),
        })),
        now: this.now,
      })
    } catch (error) {
      throw new LocalPlatformError(
        'INVALID_REQUEST',
        422,
        `The release could not initialize this match setup: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    const timestamp = this.now().toISOString()
    const record: MatchRecord = {
      version: 0,
      idempotencyKey: request.idempotencyKey,
      runtime,
      manifest,
      createdAt: timestamp,
      updatedAt: timestamp,
      seats,
      ownerId: request.ownerId,
      visibility: request.visibility ?? 'unlisted',
      lobby: {
        ...lobbyRules(request),
        ...(manifest.spec.seats.spectators
          ? {}
          : { spectating: 'disabled' as const }),
      },
      series: seriesState(request),
      completedRounds: [],
      lastActiveAt: this.now().getTime(),
    }
    await this.persist(record)
    this.matches.set(matchId, record)
    this.startMaintenance()
    this.idempotency.set(requestKey, matchId)
    return this.describe(record)
  }

  async getMatch(matchId: string, actorId?: string): Promise<MatchDescriptor> {
    const record = this.record(matchId)
    this.assertViewAccess(record, actorId)
    return this.describe(record)
  }

  async listPublicMatches(actorId?: string): Promise<
    readonly (MatchDescriptor & {
      gameId: string
      gameTitle: string
      summary: string
    })[]
  > {
    // Reverse insertion order first so matches created within the same
    // millisecond still appear newest-first under the stable timestamp sort.
    const matches = [...this.matches.values()]
      .reverse()
      .filter(
        (record) =>
          (actorId === undefined
            ? record.visibility === 'public'
            : record.ownerId === actorId ||
              record.seats.some((seat) => seat.actorId === actorId)) &&
          record.series.status !== 'complete' &&
          !['canceled', 'expired', 'failed', 'invalidated'].includes(
            record.runtime.getStatus(),
          ),
      )
    return Promise.all(
      matches
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .map(async (record) => ({
          ...(await this.describe(record)),
          gameId: record.manifest.metadata.id,
          gameTitle: record.manifest.metadata.title,
          summary: record.manifest.metadata.summary,
        })),
    )
  }

  async findOrCreateMatch(request: FindMatchRequest): Promise<JoinedMatch> {
    return this.exclusive(`queue:${request.releaseId}`, async () => {
      const { custom, manifest } = await this.resolveRelease(request.releaseId)
      const roles = resolveRoleAllocation(manifest, request.roleCounts)
      const configuration = resolveConfiguration(custom, request.configuration)
      const candidate = [...this.matches.values()]
        .filter(
          (record) =>
            record.runtime.game.releaseId === request.releaseId &&
            record.visibility === 'public' &&
            record.runtime.getStatus() === 'lobby' &&
            record.lobby.joinPolicy === 'open' &&
            record.lobby.allowedControllers.includes(request.controllerKind) &&
            record.series.maximumRounds ===
              (request.series?.maximumRounds ?? 1) &&
            record.series.restartPolicy ===
              (request.series?.restartPolicy ?? 'owner') &&
            canonicalJson(record.runtime.configuration) ===
              canonicalJson(configuration) &&
            roleAllocation(record) === resolvedRoleAllocation(roles) &&
            record.seats.some((seat) => seat.status === 'open'),
        )
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0]
      const match =
        candidate === undefined
          ? await this.createMatch({
              releaseId: request.releaseId,
              configuration,
              roleCounts: Object.fromEntries(
                roles.map((role) => [role.id, role.resolvedCount]),
              ),
              seed: request.seed,
              idempotencyKey: request.idempotencyKey,
              ownerId: request.actorId,
              visibility: 'public',
              lobby: {
                joinPolicy: 'open',
                allowedControllers: request.lobby?.allowedControllers ?? [
                  'human',
                  'agent',
                ],
                invitedActorIds: [],
                spectating: request.lobby?.spectating ?? 'enabled',
              },
              series: request.series,
            })
          : await this.describe(candidate)
      return this.joinMatch({
        matchId: match.id,
        actorId: request.actorId,
        controllerId: request.controllerId,
        controllerKind: request.controllerKind,
      })
    })
  }

  async getMatchView(
    matchId: string,
    afterEventSequence = 0,
    actorId?: string,
  ): Promise<MatchView> {
    const record = this.record(matchId)
    this.assertViewAccess(record, actorId)
    this.assertSpectateAccess(record, actorId)
    return {
      match: await this.describe(record),
      publicState: record.runtime.publicState(),
      events: record.runtime.eventLog(afterEventSequence),
    }
  }

  async claimSeat(request: ClaimSeatRequest): Promise<MatchDescriptor> {
    return this.exclusive(request.matchId, () =>
      this.claimSeatInternal(request),
    )
  }
  private async claimSeatInternal(
    request: ClaimSeatRequest,
  ): Promise<MatchDescriptor> {
    const record = this.record(request.matchId)
    this.assertJoinAccess(
      record,
      request.actorId,
      request.controllerKind ?? 'human',
    )
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
      seat.actorId === request.actorId &&
      seat.controllerId === request.controllerId
    )
      return this.describe(record)
    if (
      record.runtime.getStatus() !== 'lobby' &&
      !(
        (record.manifest.spec.seats.lateJoin || seat.released) &&
        record.runtime.getStatus() === 'running'
      )
    )
      throw new LocalPlatformError(
        'CONFLICT',
        409,
        'This match does not allow joining after the lobby.',
      )
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
    seat.controllerKind = request.controllerKind ?? 'human'
    seat.status = 'claimed'
    seat.released = false
    if (
      startThresholdReached(record) &&
      record.runtime.getStatus() === 'lobby'
    ) {
      record.runtime.start()
      this.startClock(record)
    }
    record.updatedAt = this.now().toISOString()
    await this.persist(record)
    const descriptor = await this.describe(record)
    await this.notify(request.matchId)
    return descriptor
  }

  async releaseSeat(request: SeatControlRequest): Promise<MatchDescriptor> {
    return this.exclusive(request.matchId, async () => {
      const record = this.record(request.matchId)
      const seat = this.ownedSeat(record, request)
      await this.stopSeatInput(record, seat)
      this.revokeSeatSessions(record, seat)
      seat.status = 'open'
      seat.released = true
      delete seat.actorId
      delete seat.controllerId
      delete seat.controllerKind
      record.updatedAt = this.now().toISOString()
      await this.persist(record)
      await this.notify(request.matchId)
      return this.describe(record)
    })
  }

  async changeSeatController(
    request: ChangeSeatControllerRequest,
  ): Promise<MatchDescriptor> {
    return this.exclusive(request.matchId, async () => {
      const record = this.record(request.matchId)
      const seat = this.ownedSeat(record, request)
      this.assertJoinAccess(record, request.actorId, request.controllerKind)
      if (!['lobby', 'running'].includes(record.runtime.getStatus()))
        throw new LocalPlatformError('CONFLICT', 409, 'This round has ended.')
      await this.stopSeatInput(record, seat)
      this.revokeSeatSessions(record, seat)
      seat.controllerId = request.controllerId
      seat.controllerKind = request.controllerKind
      seat.status = 'claimed'
      record.updatedAt = this.now().toISOString()
      await this.persist(record)
      await this.notify(request.matchId)
      return this.describe(record)
    })
  }

  private ownedSeat(
    record: MatchRecord,
    request: SeatControlRequest,
  ): MutableSeat {
    const seat = record.seats.find(
      (candidate) => candidate.id === request.seatId,
    )
    if (!seat) throw new LocalPlatformError('NOT_FOUND', 404, 'Seat not found.')
    if (seat.actorId !== request.actorId)
      throw new LocalPlatformError(
        'CONTROL_REVOKED',
        403,
        'Only the seat owner can release it or change its controller.',
      )
    if (seat.controllerId !== request.expectedControllerId)
      throw new LocalPlatformError(
        'CONFLICT',
        409,
        'The seat controller changed. Refresh before trying again.',
      )
    return seat
  }

  private revokeSeatSessions(record: MatchRecord, seat: MutableSeat): void {
    this.agentPolicies.delete(`${record.runtime.matchId}/${seat.id}`)
    this.coachingRequests.delete(`${record.runtime.matchId}/${seat.id}`)
    seat.controlGeneration = (seat.controlGeneration ?? 0) + 1
    for (const [id, session] of this.sessions)
      if (
        session.matchId === record.runtime.matchId &&
        session.seatId === seat.id
      )
        this.sessions.delete(id)
  }

  private async stopSeatInput(
    record: MatchRecord,
    seat: MutableSeat,
  ): Promise<void> {
    if (
      seat.heldReleaseAction !== undefined &&
      record.runtime.getStatus() === 'running'
    ) {
      const observation = record.runtime.observation(seat.id)
      await record.runtime.submitAction(
        {
          actionId: opaqueId('act'),
          matchId: record.runtime.matchId,
          seatId: seat.id,
          controlLease: opaqueId('lease'),
          clientSequence: 1,
          basedOnStateSequence: observation.stateSequence,
          payload: seat.heldReleaseAction,
        },
        record.runtime.getOwnershipEpoch(),
      )
    }
    delete seat.heldReleaseAction
  }

  async joinMatch(request: JoinMatchRequest): Promise<JoinedMatch> {
    return this.exclusive(request.matchId, async () => {
      const record = this.record(request.matchId)
      const existing = record.seats.find(
        (seat) =>
          seat.actorId === request.actorId &&
          seat.controllerId === request.controllerId,
      )
      if (existing)
        return { match: await this.describe(record), seatId: existing.id }
      const seat = record.seats.find((candidate) => candidate.status === 'open')
      if (!seat)
        throw new LocalPlatformError('CONFLICT', 409, 'This lobby is full.')
      const match = await this.claimSeatInternal({
        ...request,
        seatId: seat.id,
      })
      return { match, seatId: seat.id }
    })
  }

  async createSession(
    request: CreateSessionRequest,
  ): Promise<SessionTicketDescriptor> {
    const record = this.record(request.matchId)
    if (request.mode === 'spectate' && record.lobby.spectating === 'disabled')
      throw new LocalPlatformError(
        'CONTROL_REVOKED',
        403,
        'Spectating is disabled for this session.',
      )
    if (
      record.visibility === 'private' &&
      record.ownerId !== undefined &&
      record.ownerId !== request.actorId
    )
      throw new LocalPlatformError(
        'CONTROL_REVOKED',
        403,
        'This private match is available only to its owner.',
      )
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
      ...(request.mode === 'control'
        ? {
            controlGeneration:
              record.seats.find((seat) => seat.id === request.seatId)
                ?.controlGeneration ?? 0,
          }
        : {}),
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
    const record = this.record(session.matchId)
    if (session.seatId !== undefined) {
      const seat = record.seats.find(
        (candidate) => candidate.id === session.seatId,
      )
      const other = [...this.sessions.values()].some(
        (candidate) =>
          candidate.matchId === session.matchId &&
          candidate.seatId === session.seatId,
      )
      if (seat !== undefined && !other) {
        seat.status = 'disconnected'
        if (record.manifest.spec.seats.lateJoin) {
          seat.status = 'open'
          delete seat.actorId
          delete seat.controllerId
          delete seat.controllerKind
        }
      }
    }
    record.updatedAt = this.now().toISOString()
    void this.notify(session.matchId)
  }

  suspendSession(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (session === undefined || !session.connected) return
    session.connected = false
    const record = this.record(session.matchId)
    if (session.seatId !== undefined) {
      const seat = record.seats.find(
        (candidate) => candidate.id === session.seatId,
      )
      const connected = [...this.sessions.values()].some(
        (candidate) =>
          candidate.matchId === session.matchId &&
          candidate.seatId === session.seatId &&
          candidate.connected,
      )
      if (seat !== undefined && !connected) seat.status = 'disconnected'
    }
    record.updatedAt = this.now().toISOString()
    void this.notify(session.matchId)
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

  private ownedAgent(matchId: string, seatId: string, actorId: string) {
    const record = this.record(matchId)
    const seat = record.seats.find((s) => s.id === seatId)
    if (
      !seat ||
      seat.actorId !== actorId ||
      seat.controllerKind !== 'agent' ||
      !seat.controllerId
    )
      throw new LocalPlatformError(
        'CONTROL_REVOKED',
        403,
        'Only the owner of this agent seat can coach it.',
      )
    if (!['running', 'lobby'].includes(record.runtime.getStatus()))
      throw new LocalPlatformError(
        'MATCH_NOT_RUNNING',
        409,
        'This match is no longer active.',
      )
    return { record, seat }
  }

  beginCoaching(
    matchId: string,
    seatId: string,
    actorId: string,
    agentId?: string,
  ) {
    const { record, seat } = this.ownedAgent(matchId, seatId, actorId)
    if (
      agentId &&
      seat.controllerId !== agentId &&
      seat.controllerId !== `agent:${agentId}` &&
      seat.controllerId !== `commons-agent-${agentId}`
    )
      throw new LocalPlatformError(
        'CONTROL_REVOKED',
        403,
        'The selected agent does not control this seat.',
      )
    const key = `${matchId}/${seatId}`
    const requestId = opaqueId('coach')
    this.coachingRequests.set(key, requestId)
    const current = this.agentPolicies.get(key)
    return {
      requestId,
      controllerId: seat.controllerId!,
      strategy: current?.strategy ?? 'Play to win legally.',
      strategyEpoch: current?.strategyEpoch ?? 0,
      observation: livePolicyObservation(record.runtime.observation(seatId))
        .observation,
    }
  }

  async applyCoaching(
    matchId: string,
    seatId: string,
    actorId: string,
    requestId: string,
    controllerId: string,
    proposal: unknown,
  ) {
    const planned = coachedStrategySchema.parse(proposal)
    return this.exclusive(matchId, async () => {
      const { record, seat } = this.ownedAgent(matchId, seatId, actorId)
      const key = `${matchId}/${seatId}`
      if (
        this.coachingRequests.get(key) !== requestId ||
        seat.controllerId !== controllerId
      )
        throw new LocalPlatformError(
          'CONFLICT',
          409,
          'This coaching request was superseded.',
        )
      const previous = this.agentPolicies.get(key)
      // A fresh control lease fences every old runner and queued submission.
      const ticket = await this.createSession({
        matchId,
        seatId,
        actorId,
        controllerId,
        mode: 'control',
      })
      const session = await this.connectWithTicket(ticket.ticket, matchId)
      if (
        this.coachingRequests.get(key) !== requestId ||
        seat.controllerId !== controllerId
      ) {
        this.sessions.delete(session.sessionId)
        throw new LocalPlatformError(
          'CONFLICT',
          409,
          'This coaching request was superseded.',
        )
      }
      if (previous?.held?.releaseActionId)
        await this.releaseAgentInput(record, seat.id, previous)
      else await this.stopSeatInput(record, seat)
      if (this.coachingRequests.get(key) !== requestId) {
        this.sessions.delete(session.sessionId)
        throw new LocalPlatformError(
          'CONFLICT',
          409,
          'This coaching request was superseded.',
        )
      }
      const epoch = (previous?.strategyEpoch ?? 0) + 1
      this.agentPolicies.set(key, {
        sessionId: session.sessionId,
        actorId,
        controllerId,
        strategy: planned.strategy,
        executableStrategy: planned.executableStrategy,
        strategyEpoch: epoch,
        sequence: 0,
        nextDecision: 0,
        policyMemory: { actions: {} },
      })
      if (previous) this.sessions.delete(previous.sessionId)
      this.coachingRequests.delete(key)
      if (!this.agentTimers.has(matchId)) {
        let pending = false
        const timer = setInterval(() => {
          if (pending) return
          pending = true
          void this.exclusive(matchId, () => this.runAgentPolicies(matchId))
            .catch(() => {
              // A failure stops agent control, never the simulation clock.
              const active = this.agentTimers.get(matchId)
              if (active) clearInterval(active)
              this.agentTimers.delete(matchId)
            })
            .finally(() => {
              pending = false
            })
        }, 16)
        timer.unref()
        this.agentTimers.set(matchId, timer)
      }
      // Do not wait for the old decision cadence or for the coaching HTTP response.
      await this.runAgentPolicies(matchId)
      return {
        seatId,
        strategy: planned.strategy,
        strategyEpoch: epoch,
        reason: planned.reason,
        executableStrategy: planned.executableStrategy,
        status: 'applied',
        requestId,
        stateSequence: record.runtime.observation(seatId).stateSequence,
      }
    })
  }

  private async runAgentPolicies(matchId: string) {
    const record = this.record(matchId)
    if (record.runtime.getStatus() === 'completed') {
      const timer = this.agentTimers.get(matchId)
      if (timer) clearInterval(timer)
      this.agentTimers.delete(matchId)
      return
    }
    if (record.runtime.getStatus() !== 'running') return
    const now = this.now().getTime()
    for (const seat of record.seats) {
      const agent = this.agentPolicies.get(`${matchId}/${seat.id}`)
      if (!agent) continue
      if (
        seat.actorId !== agent.actorId ||
        seat.controllerId !== agent.controllerId ||
        seat.controllerKind !== 'agent'
      ) {
        this.agentPolicies.delete(`${matchId}/${seat.id}`)
        continue
      }
      // A held intent needs no new projection until its next decision or pulse.
      // Sandboxed observations are expensive; do not evaluate them every timer tick.
      if (
        now < agent.nextDecision &&
        !(
          agent.held?.mode === 'pulse' &&
          now - (agent.lastApply ?? 0) >= agent.held.refreshMs
        )
      )
        continue
      const observation = record.runtime.observation(seat.id)
      if (!observation.legalActions.length) {
        agent.held = undefined
        continue
      }
      if (now < agent.nextDecision) {
        if (
          agent.held?.mode === 'pulse' &&
          now - (agent.lastApply ?? 0) >= agent.held.refreshMs
        ) {
          const input = livePolicyObservation(observation)
          const payload = input.payloads.get(agent.held.id)
          if (payload !== undefined)
            await this.submitPolicyAction(record, seat.id, agent, payload)
          else agent.held = undefined
        }
        continue
      }
      if (
        !record.runtime.game.advanceTick &&
        observation.stateSequence === agent.lastStateSequence
      )
        continue
      const input = livePolicyObservation(observation)
      const feedback = agent.prior
        ? this.playerPolicy.feedback(
            agent.prior.state,
            input.observation.state,
            agent.prior.actionId,
            now - agent.prior.at,
          )
        : undefined
      agent.policyMemory = this.playerPolicy.learn(
        { seatId: seat.id, ...agent },
        feedback,
      ).memory
      const decision = this.playerPolicy.choose(
        {
          ...input.observation,
          state: this.playerPolicy.enrich(input.observation.state),
        },
        { seatId: seat.id, ...agent },
        agent.sequence,
      )
      const payload = input.payloads.get(decision.actionId)
      if (payload === undefined) continue
      agent.nextDecision =
        now +
        1000 /
          Math.max(
            1,
            Math.min(20, record.manifest.spec.policy.maxDecisionsPerSecond),
          )
      agent.lastStateSequence = observation.stateSequence
      const raw =
        payload && typeof payload === 'object' && !Array.isArray(payload)
          ? payload
          : {}
      const control =
        raw.control &&
        typeof raw.control === 'object' &&
        !Array.isArray(raw.control)
          ? raw.control
          : undefined
      const changed = agent.held?.id !== decision.actionId
      if (changed) await this.releaseAgentInput(record, seat.id, agent)
      if (!changed && agent.held?.mode === 'hold') continue
      const result = await this.submitPolicyAction(
        record,
        seat.id,
        agent,
        payload,
      )
      if (
        result.disposition === 'accepted' &&
        (control?.mode === 'hold' || control?.mode === 'pulse')
      )
        agent.held = {
          id: decision.actionId,
          payload,
          mode: control.mode,
          refreshMs: Math.max(
            16,
            Math.min(250, Number(control.refreshMs) || 50),
          ),
          ...(typeof control.releaseActionId === 'string'
            ? { releaseActionId: control.releaseActionId }
            : {}),
        }
      if (result.disposition === 'accepted')
        agent.prior = {
          state: structuredClone(input.observation.state),
          actionId: decision.actionId,
          at: now,
        }
    }
  }

  private async releaseAgentInput(
    record: MatchRecord,
    seatId: string,
    agent: ManagedAgentPolicy,
  ) {
    const releaseId = agent.held?.releaseActionId
    agent.held = undefined
    if (!releaseId) return
    const observation = record.runtime.observation(seatId)
    const input = livePolicyObservation(observation)
    const payload =
      input.payloads.get(releaseId) ??
      observation.legalActions.find(
        (action) =>
          action &&
          typeof action === 'object' &&
          !Array.isArray(action) &&
          action.id === releaseId,
      )
    if (payload !== undefined)
      await this.submitPolicyAction(record, seatId, agent, payload)
  }

  private async submitPolicyAction(
    record: MatchRecord,
    seatId: string,
    agent: ManagedAgentPolicy,
    payload: JsonValue,
  ) {
    const observation = record.runtime.observation(seatId)
    const session = this.getSession(agent.sessionId)
    agent.lastApply = this.now().getTime()
    return this.submitActionInternal(agent.sessionId, {
      actionId: opaqueId('act'),
      matchId: record.runtime.matchId,
      seatId,
      controlLease: session.controlLease!,
      clientSequence: ++agent.sequence,
      basedOnStateSequence: observation.stateSequence,
      ...(observation.turn === undefined
        ? {}
        : { targetTurn: observation.turn }),
      ...(observation.tick === undefined
        ? {}
        : { targetTick: observation.tick + 1 }),
      policyExecutionId: `coached-strategy-${agent.strategyEpoch}`,
      payload,
    })
  }

  async submitAction(
    sessionId: string,
    action: ActionSubmission,
  ): Promise<ActionResult> {
    const session = this.getSession(sessionId)
    return this.exclusive(session.matchId, () =>
      this.submitActionInternal(sessionId, action),
    )
  }

  private async submitActionInternal(
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
    const managed = this.agentPolicies.get(
      `${session.matchId}/${session.seatId}`,
    )
    if (managed && managed.sessionId !== sessionId)
      throw new LocalPlatformError(
        'CONTROL_REVOKED',
        403,
        'This controller was replaced by a coached strategy.',
      )
    const before = record.runtime.observation(session.seatId)
    const result = await record.runtime.submitAction(
      action,
      session.ownershipEpoch,
    )
    record.updatedAt = this.now().toISOString()
    if (result.disposition === 'accepted') {
      const seat = record.seats.find(
        (candidate) => candidate.id === session.seatId,
      )!
      const payload = action.payload as { id?: string } | null
      const advertised = before.legalActions.find(
        (candidate) =>
          JSON.stringify(candidate) === JSON.stringify(action.payload) ||
          (payload &&
            typeof payload === 'object' &&
            payload.id !== undefined &&
            candidate &&
            typeof candidate === 'object' &&
            !Array.isArray(candidate) &&
            candidate.id === payload.id),
      )
      const control =
        advertised &&
        typeof advertised === 'object' &&
        !Array.isArray(advertised)
          ? (advertised.control as
              { mode?: string; releaseActionId?: string } | undefined)
          : undefined
      const release =
        control?.mode === 'hold'
          ? before.legalActions.find(
              (candidate) =>
                candidate &&
                typeof candidate === 'object' &&
                !Array.isArray(candidate) &&
                candidate.id === control.releaseActionId,
            )
          : undefined
      if (release !== undefined) seat.heldReleaseAction = release
      else delete seat.heldReleaseAction
      if (record.runtime.getStatus() === 'completed') {
        this.finishRound(record)
        if (
          record.series.status === 'awaiting-restart' &&
          record.series.restartPolicy === 'automatic'
        )
          await this.advanceRound(record)
      }
      await this.persist(record)
    }
    await this.notify(session.matchId, result)
    return result
  }

  getReplay(matchId: string, actorId?: string): Replay {
    const record = this.record(matchId)
    this.assertViewAccess(record, actorId)
    this.assertSpectateAccess(record, actorId)
    return record.runtime.exportReplay()
  }

  getRoundReplay(
    matchId: string,
    roundNumber: number,
    actorId?: string,
  ): Replay {
    const record = this.record(matchId)
    this.assertViewAccess(record, actorId)
    this.assertSpectateAccess(record, actorId)
    if (roundNumber === record.series.currentRound)
      return record.runtime.exportReplay()
    const replay = record.completedRounds[roundNumber - 1]
    if (!replay)
      throw new LocalPlatformError(
        'NOT_FOUND',
        404,
        `Round ${roundNumber} does not exist.`,
      )
    return replay
  }

  async restartRound(
    matchId: string,
    actorId: string,
    input: RestartRoundInput = {},
  ): Promise<MatchDescriptor> {
    return this.exclusive(matchId, async () => {
      const record = this.record(matchId)
      if (record.series.status === 'complete')
        throw new LocalPlatformError('CONFLICT', 409, 'The series is complete.')
      if (record.series.status !== 'awaiting-restart')
        throw new LocalPlatformError(
          'CONFLICT',
          409,
          'The current round has not finished.',
        )
      if (record.series.restartPolicy === 'automatic')
        throw new LocalPlatformError(
          'CONFLICT',
          409,
          'This series restarts automatically.',
        )
      const hasOverrides =
        input.configuration !== undefined || input.roleCounts !== undefined
      if (hasOverrides && record.series.restartPolicy !== 'owner')
        throw new LocalPlatformError(
          'INVALID_REQUEST',
          422,
          'Only owner-controlled restarts may override match setup.',
        )
      if (record.series.restartPolicy === 'owner') {
        if (record.ownerId !== actorId)
          throw new LocalPlatformError(
            'CONTROL_REVOKED',
            403,
            'Only the session owner may start the next round.',
          )
      } else {
        if (!record.seats.some((seat) => seat.actorId === actorId))
          throw new LocalPlatformError(
            'CONTROL_REVOKED',
            403,
            'Only a seated player may vote to restart.',
          )
        record.series.restartVotes = [
          ...new Set([...record.series.restartVotes, actorId]),
        ]
        const players = new Set(
          record.seats.flatMap((seat) => (seat.actorId ? [seat.actorId] : [])),
        )
        if (
          ![...players].every((player) =>
            record.series.restartVotes.includes(player),
          )
        ) {
          record.updatedAt = this.now().toISOString()
          await this.persist(record)
          await this.notify(matchId)
          return this.describe(record)
        }
      }
      let configuration = record.runtime.configuration
      let seats: MutableSeat[] | undefined
      if (hasOverrides) {
        if (input.configuration !== undefined) {
          const { custom } = await this.resolveRelease(
            record.runtime.game.releaseId,
          )
          configuration = resolveConfiguration(custom, input.configuration)
        }
        if (input.roleCounts !== undefined)
          seats = reconciledSeats(
            record,
            resolveRoleAllocation(record.manifest, input.roleCounts),
          )
      }
      await this.advanceRound(record, configuration, seats)
      record.updatedAt = this.now().toISOString()
      await this.persist(record)
      await this.notify(matchId)
      return this.describe(record)
    })
  }

  async pauseMatch(matchId: string): Promise<MatchDescriptor> {
    return this.exclusive(matchId, async () => {
      const record = this.record(matchId)
      for (const seat of record.seats) {
        const agent = this.agentPolicies.get(`${matchId}/${seat.id}`)
        if (agent) await this.releaseAgentInput(record, seat.id, agent)
      }
      record.runtime.pause()
      this.stopClock(matchId)
      record.updatedAt = this.now().toISOString()
      await this.notify(matchId)
      return this.describe(record)
    })
  }

  async resumeMatch(matchId: string): Promise<MatchDescriptor> {
    const record = this.record(matchId)
    record.runtime.resume()
    this.startClock(record)
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

  private async exclusive<T>(
    matchId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const prior = this.operations.get(matchId) ?? Promise.resolve()
    const next = prior.catch(() => {}).then(operation)
    this.operations.set(matchId, next)
    try {
      return await next
    } finally {
      if (this.operations.get(matchId) === next) this.operations.delete(matchId)
    }
  }

  async abandonMatch(
    matchId: string,
    actorId: string,
  ): Promise<MatchDescriptor> {
    return this.exclusive(matchId, async () => {
      const record = this.record(matchId)
      if (record.ownerId !== actorId)
        throw new LocalPlatformError(
          'CONTROL_REVOKED',
          403,
          'Only the match owner can end this match.',
        )
      record.runtime.end('canceled', 'Ended by the match owner.')
      record.series.status = 'complete'
      this.stopClock(matchId)
      record.updatedAt = this.now().toISOString()
      await this.persist(record)
      await this.notify(matchId)
      return this.describe(record)
    })
  }

  close(): void {
    if (this.maintenance) clearInterval(this.maintenance)
    this.maintenance = undefined
    for (const timer of this.agentTimers.values()) clearInterval(timer)
    this.agentTimers.clear()
    this.agentPolicies.clear()
    this.coachingRequests.clear()
    for (const matchId of this.clocks.keys()) this.stopClock(matchId)
  }

  private startMaintenance(): void {
    if (this.maintenance) return
    const timer = setInterval(() => {
      if (
        ![...this.matches.values()].some((record) =>
          ['lobby', 'ready', 'running', 'paused'].includes(
            record.runtime.getStatus(),
          ),
        )
      ) {
        clearInterval(timer)
        this.maintenance = undefined
        return
      }
      for (const record of this.matches.values()) {
        if (
          !['lobby', 'ready', 'running', 'paused'].includes(
            record.runtime.getStatus(),
          )
        )
          continue
        const connected = [...this.sessions.values()].some(
          (session) =>
            session.matchId === record.runtime.matchId &&
            session.connected &&
            session.mode === 'control',
        )
        if (connected) record.lastActiveAt = this.now().getTime()
        const idle = this.now().getTime() - record.lastActiveAt
        const age = this.now().getTime() - Date.parse(record.createdAt)
        const maxDuration =
          (record.manifest.spec.clock.maxDurationSeconds ?? 600) *
          1000 *
          record.series.maximumRounds
        if (
          idle < (record.runtime.getStatus() === 'lobby' ? 300_000 : 60_000) &&
          age < maxDuration
        )
          continue
        void this.exclusive(record.runtime.matchId, async () => {
          record.runtime.end(
            'expired',
            idle >= 60_000
              ? 'No connected players.'
              : 'Maximum match duration reached.',
          )
          record.series.status = 'complete'
          this.stopClock(record.runtime.matchId)
          record.updatedAt = this.now().toISOString()
          await this.persist(record)
          await this.notify(record.runtime.matchId)
        }).catch((error) =>
          console.error('Match cleanup failed', record.runtime.matchId, error),
        )
      }
    }, 5000)
    this.maintenance = timer
    timer.unref()
  }

  private startClock(record: MatchRecord): void {
    this.stopClock(record.runtime.matchId)
    const hz = record.manifest.spec.clock.simulationHz
    if (
      !hz ||
      !record.runtime.game.advanceTick ||
      record.runtime.getStatus() !== 'running'
    )
      return
    const deltaMs = Math.max(1, Math.round(1000 / hz))
    const networkHz = Math.min(hz, record.manifest.spec.clock.networkHz ?? hz)
    const broadcastEvery = Math.max(1, Math.round(hz / networkHz))
    let ticks = 0
    let lastTickAt = this.now().getTime()
    let lastPersistAt = lastTickAt
    let pending = false
    const timer = setInterval(() => {
      if (pending) return
      pending = true
      void this.exclusive(record.runtime.matchId, async () => {
        // Catch up a bounded number of fixed simulation steps after slow I/O.
        // Replays retain every original delta; observers receive one final frame.
        const now = this.now().getTime()
        lastTickAt = Math.max(lastTickAt, now - 1000)
        const due = Math.min(
          8,
          Math.max(1, Math.floor((now - lastTickAt) / deltaMs)),
        )
        for (let step = 0; step < due; step++) {
          if (!(await record.runtime.advanceTick(deltaMs))) {
            this.stopClock(record.runtime.matchId)
            break
          }
          ticks += 1
          lastTickAt += deltaMs
          if (record.runtime.getStatus() !== 'running') break
        }
        record.updatedAt = this.now().toISOString()
        if (record.runtime.getStatus() === 'completed') {
          this.stopClock(record.runtime.matchId)
          this.finishRound(record)
          if (
            record.series.status === 'awaiting-restart' &&
            record.series.restartPolicy === 'automatic'
          )
            await this.advanceRound(record)
          await this.persist(record)
        } else if (now - lastPersistAt >= 1000) {
          await this.persist(record)
          lastPersistAt = now
        }
        if (
          record.runtime.getStatus() === 'completed' ||
          ticks % broadcastEvery === 0
        )
          await this.notify(record.runtime.matchId)
      })
        .catch(async (error) => {
          console.error('Match clock failed', record.runtime.matchId, error)
          this.stopClock(record.runtime.matchId)
          record.runtime.end(
            'failed',
            'The runtime could not continue. Inspect the replay and runtime diagnostics.',
          )
          await this.persist(record).catch((error) =>
            console.error('Failed to persist match failure', error),
          )
          await this.notify(record.runtime.matchId).catch(() => {})
        })
        .finally(() => {
          pending = false
        })
    }, deltaMs)
    timer.unref()
    this.clocks.set(record.runtime.matchId, timer)
  }

  private stopClock(matchId: string): void {
    const timer = this.clocks.get(matchId)
    if (timer) clearInterval(timer)
    this.clocks.delete(matchId)
  }
  private async persist(record: MatchRecord) {
    if (!this.persistMatch) return
    const saved: PersistedMatch = {
      version: record.version + 1,
      idempotencyKey: record.idempotencyKey,
      replay: record.runtime.exportReplay(),
      manifest: record.manifest,
      seats: record.seats,
      status: record.runtime.getStatus(),
      ownershipEpoch: record.runtime.getOwnershipEpoch(),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      ownerId: record.ownerId,
      visibility: record.visibility,
      lobby: record.lobby,
      series: record.series,
      completedRounds: record.completedRounds,
    }
    try {
      await this.persistMatch(saved, record.version || undefined)
      record.version = saved.version
    } catch (error) {
      this.stopClock(record.runtime.matchId)
      if (record.runtime.getStatus() === 'running') record.runtime.pause()
      throw error
    }
  }

  private record(matchId: string): MatchRecord {
    const record = this.matches.get(matchId)
    if (record === undefined) {
      throw new LocalPlatformError('NOT_FOUND', 404, `Unknown match ${matchId}`)
    }
    return record
  }

  private assertViewAccess(record: MatchRecord, actorId?: string): void {
    if (record.visibility !== 'private' || record.ownerId === actorId) return
    throw new LocalPlatformError(
      'CONTROL_REVOKED',
      403,
      'This private match is available only to its owner.',
    )
  }

  private assertJoinAccess(
    record: MatchRecord,
    actorId: string,
    controllerKind: 'human' | 'agent',
  ): void {
    if (record.series.status === 'complete')
      throw new LocalPlatformError('CONFLICT', 409, 'The series is complete.')
    if (!record.lobby.allowedControllers.includes(controllerKind))
      throw new LocalPlatformError(
        'CONTROL_REVOKED',
        403,
        `${controllerKind === 'agent' ? 'Agent' : 'Human'} controllers are disabled for this lobby.`,
      )
    if (
      record.visibility === 'private' &&
      record.ownerId !== undefined &&
      record.ownerId !== actorId
    )
      throw new LocalPlatformError(
        'CONTROL_REVOKED',
        403,
        'This private match is available only to its owner.',
      )
    if (
      record.lobby.joinPolicy === 'invite-only' &&
      record.ownerId !== actorId &&
      !record.lobby.invitedActorIds.includes(actorId)
    )
      throw new LocalPlatformError(
        'CONTROL_REVOKED',
        403,
        'This lobby accepts invited players only.',
      )
  }

  private assertSpectateAccess(record: MatchRecord, actorId?: string): void {
    if (
      record.lobby.spectating === 'enabled' ||
      record.ownerId === actorId ||
      record.seats.some((seat) => seat.actorId === actorId)
    )
      return
    throw new LocalPlatformError(
      'CONTROL_REVOKED',
      403,
      'Spectating is disabled for this session.',
    )
  }

  private finishRound(record: MatchRecord): void {
    if (record.series.status !== 'active') return
    const result = record.runtime.exportReplay().events.at(-1)?.payload
    if (
      typeof result === 'object' &&
      result !== null &&
      'winnerSeatId' in result
    ) {
      const winnerSeatId = result.winnerSeatId
      if (typeof winnerSeatId === 'string')
        record.series.scores[winnerSeatId] =
          (record.series.scores[winnerSeatId] ?? 0) + 1
    }
    record.series.status =
      record.series.currentRound >= record.series.maximumRounds
        ? 'complete'
        : 'awaiting-restart'
    record.series.restartVotes = []
  }

  private async advanceRound(
    record: MatchRecord,
    configuration: JsonValue = record.runtime.configuration,
    seats: MutableSeat[] = record.seats,
  ): Promise<void> {
    this.stopClock(record.runtime.matchId)
    const prior = record.runtime
    const completed = prior.exportReplay()
    const nextRound = record.series.currentRound + 1
    let runtime: LocalMatchRuntime
    try {
      runtime = await AuthoritativeMatch.create({
        matchId: prior.matchId,
        game: prior.game,
        seed: `${prior.matchId}:round:${nextRound}`,
        configuration,
        roster: seats.map((seat) => ({
          seatId: seat.id,
          role: seat.role,
          ...(seat.team === undefined ? {} : { team: seat.team }),
        })),
        ownershipEpoch: prior.getOwnershipEpoch() + 1,
        now: this.now,
      })
    } catch (error) {
      throw new LocalPlatformError(
        'INVALID_REQUEST',
        422,
        `The release could not initialize the next-round setup: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    record.completedRounds.push(completed)
    record.series.currentRound = nextRound
    record.series.status = 'active'
    record.series.restartVotes = []
    for (const seat of record.seats) {
      const agent = this.agentPolicies.get(
        `${record.runtime.matchId}/${seat.id}`,
      )
      if (agent) {
        agent.held = undefined
        agent.prior = undefined
        agent.nextDecision = 0
        agent.lastStateSequence = undefined
      }
    }
    record.seats.splice(0, record.seats.length, ...seats)
    record.runtime = runtime
    for (const session of this.sessions.values())
      if (session.matchId === record.runtime.matchId)
        session.ownershipEpoch = record.runtime.getOwnershipEpoch()
    for (const seat of record.seats) {
      const connected = [...this.sessions.values()].some(
        (session) =>
          session.matchId === record.runtime.matchId &&
          session.seatId === seat.id &&
          session.connected,
      )
      seat.status =
        seat.actorId === undefined
          ? 'open'
          : connected
            ? 'connected'
            : 'claimed'
    }
    if (startThresholdReached(record)) record.runtime.start()
    this.startClock(record)
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
      ...(record.ownerId === undefined ? {} : { ownerId: record.ownerId }),
      configuration: record.runtime.configuration,
      visibility: record.visibility,
      lobby: record.lobby,
      series: record.series,
      viewerCount: [...this.sessions.values()].filter(
        (session) =>
          session.matchId === record.runtime.matchId &&
          session.mode === 'spectate' &&
          session.connected,
      ).length,
      seats: record.seats.map((seat, index) => ({
        id: seat.id,
        role: seat.role,
        label: `${record.manifest.spec.seats.roles.find((role) => role.id === seat.role)?.title ?? seat.role} · Seat ${index + 1}`,
        joinable:
          seat.status === 'open' &&
          (snapshot.status === 'lobby' ||
            (snapshot.status === 'running' &&
              (record.manifest.spec.seats.lateJoin || seat.released === true))),
        ...(seat.controllerId === undefined
          ? {}
          : { controllerId: seat.controllerId }),
        ...(seat.team === undefined ? {} : { team: seat.team }),
        status: seat.status,
        ...(seat.actorId === undefined ? {} : { actorId: seat.actorId }),

        ...(seat.controllerKind === undefined
          ? {}
          : { controllerKind: seat.controllerKind }),
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
      seat.controllerId !== claims.controllerId ||
      (seat.controlGeneration ?? 0) !== (claims.controlGeneration ?? 0)
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
    const record = this.record(matchId)
    const view = await this.getMatchView(matchId, 0, record.ownerId)
    const update: MatchUpdate = {
      ...view,
      ...(actionResult === undefined ? {} : { actionResult }),
    }
    for (const listener of listeners) listener(update)
  }
}
