import {
  gameManifestSchema,
  matchDescriptorSchema,
  problemDetailsSchema,
  replaySchema,
  type GameManifest,
  type JsonValue,
  type MatchDescriptor,
  type MatchEvent,
  type ProblemDetails,
  type Replay,
} from '@common-arcade/protocol'

export interface ControlClientOptions {
  readonly baseUrl: string
  readonly fetch?: typeof globalThis.fetch
  readonly actorId?: string
  readonly bearerToken?: string
}

export interface ArcadeStatus {
  readonly name: string
  readonly phase: string
  readonly capabilities: readonly string[]
  readonly protocol: { readonly namespace: string; readonly normative: boolean }
  readonly message: string
}

export interface GameList {
  readonly games: readonly GameManifest[]
  readonly nextCursor: string | null
}

export interface CreateMatchInput {
  readonly releaseId: string
  readonly configuration?: JsonValue
  readonly seed?: string
  readonly idempotencyKey?: string
}

export interface MatchView {
  readonly match: MatchDescriptor
  readonly publicState: JsonValue
  readonly events: readonly MatchEvent[]
}

export interface ClaimSeatInput {
  readonly matchId: string
  readonly seatId: string
  readonly controllerId: string
}

export interface CreateSessionInput {
  readonly matchId: string
  readonly mode: 'control' | 'spectate'
  readonly seatId?: string
  readonly controllerId?: string
}

export interface SessionTicket {
  readonly sessionId: string
  readonly ticket: string
  readonly expiresInSeconds: number
  readonly realtimeUrl: string
}

export class ArcadeApiError extends Error {
  constructor(readonly problem: ProblemDetails) {
    super(problem.detail)
    this.name = 'ArcadeApiError'
  }
}

function randomIdempotencyKey(): string {
  return `sdk-${crypto.randomUUID()}`
}

export class ControlClient {
  readonly #baseUrl: URL
  readonly #fetch: typeof globalThis.fetch
  readonly #authorization?: string

  constructor(options: ControlClientOptions) {
    this.#baseUrl = new URL(options.baseUrl)
    this.#fetch = options.fetch ?? globalThis.fetch
    this.#authorization =
      options.bearerToken === undefined
        ? options.actorId === undefined
          ? undefined
          : `Bearer local:${options.actorId}`
        : `Bearer ${options.bearerToken}`
  }

  async getStatus(signal?: AbortSignal): Promise<ArcadeStatus> {
    return (await this.request('/v1/status', { signal })) as ArcadeStatus
  }

  async listGames(signal?: AbortSignal): Promise<GameList> {
    const body = (await this.request('/v1/games', { signal })) as {
      games: unknown[]
      nextCursor: string | null
    }
    return {
      games: body.games.map((game) => gameManifestSchema.parse(game)),
      nextCursor: body.nextCursor,
    }
  }

  async getGame(gameId: string, signal?: AbortSignal): Promise<GameManifest> {
    return gameManifestSchema.parse(
      await this.request(`/v1/games/${encodeURIComponent(gameId)}`, { signal }),
    )
  }

  async createMatch(
    input: CreateMatchInput,
    signal?: AbortSignal,
  ): Promise<MatchDescriptor> {
    const { idempotencyKey = randomIdempotencyKey(), ...body } = input
    return matchDescriptorSchema.parse(
      await this.request('/v1/matches', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body,
        signal,
      }),
    )
  }

  async getMatch(
    matchId: string,
    signal?: AbortSignal,
  ): Promise<MatchDescriptor> {
    return matchDescriptorSchema.parse(
      await this.request(`/v1/matches/${encodeURIComponent(matchId)}`, {
        signal,
      }),
    )
  }

  async getMatchState(
    matchId: string,
    afterEventSequence = 0,
    signal?: AbortSignal,
  ): Promise<MatchView> {
    return (await this.request(
      `/v1/matches/${encodeURIComponent(matchId)}/state?afterEventSequence=${afterEventSequence}`,
      { signal },
    )) as MatchView
  }

  async claimSeat(
    input: ClaimSeatInput,
    signal?: AbortSignal,
  ): Promise<MatchDescriptor> {
    return matchDescriptorSchema.parse(
      await this.request(
        `/v1/matches/${encodeURIComponent(input.matchId)}/seats/${encodeURIComponent(input.seatId)}/claim`,
        { method: 'POST', body: { controllerId: input.controllerId }, signal },
      ),
    )
  }

  async createSession(
    input: CreateSessionInput,
    signal?: AbortSignal,
  ): Promise<SessionTicket> {
    const { matchId, ...body } = input
    return (await this.request(
      `/v1/matches/${encodeURIComponent(matchId)}/sessions`,
      { method: 'POST', body, signal },
    )) as SessionTicket
  }

  async getReplay(matchId: string, signal?: AbortSignal): Promise<Replay> {
    return replaySchema.parse(
      await this.request(`/v1/matches/${encodeURIComponent(matchId)}/replay`, {
        signal,
      }),
    )
  }

  private async request(
    path: string,
    options: {
      readonly method?: string
      readonly headers?: Record<string, string>
      readonly body?: unknown
      readonly signal?: AbortSignal
    } = {},
  ): Promise<unknown> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      ...options.headers,
    }
    if (options.body !== undefined) headers['content-type'] = 'application/json'
    if (this.#authorization !== undefined)
      headers.authorization = this.#authorization
    const response = await this.#fetch(new URL(path, this.#baseUrl), {
      method: options.method,
      headers,
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    })
    const body: unknown = await response.json()
    if (!response.ok) {
      const parsed = problemDetailsSchema.safeParse(body)
      if (parsed.success) throw new ArcadeApiError(parsed.data)
      throw new Error(`Common Arcade request failed: ${response.status}`)
    }
    return body
  }
}

/** @deprecated Use ArcadeStatus. */
export type ArcadeBootstrapStatus = ArcadeStatus
