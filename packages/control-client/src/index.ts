import type {
  GameDocument,
  StudioProject,
  StudioRelease,
  StudioAnnotation,
} from '@common-arcade/protocol'
export type {
  GameDocument,
  StudioProject,
  StudioRelease,
  StudioAnnotation,
} from '@common-arcade/protocol'
import {
  gameManifestSchema,
  gameReleaseDescriptorSchema,
  matchDescriptorSchema,
  problemDetailsSchema,
  replaySchema,
  type GameManifest,
  type GameReleaseDescriptor,
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

export interface ReleaseList {
  readonly releases: readonly GameReleaseDescriptor[]
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

export interface CreateTestRunInput {
  readonly seed?: string
  readonly firstPreference?: readonly number[]
  readonly secondPreference?: readonly number[]
  readonly execution?: 'step' | 'complete'
  readonly idempotencyKey?: string
}

export interface TestRun {
  readonly runId: string
  readonly matchId: string
  readonly status: string
  readonly result?: JsonValue
  readonly steps: number
  readonly replay: Replay
  readonly diagnostics: readonly JsonValue[]
}

export interface DiagnosticList {
  readonly records: readonly JsonValue[]
  readonly nextCursor: string | null
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

  async listGameReleases(
    gameId: string,
    signal?: AbortSignal,
  ): Promise<ReleaseList> {
    const body = (await this.request(
      `/v1/games/${encodeURIComponent(gameId)}/releases`,
      { signal },
    )) as { releases: unknown[]; nextCursor: string | null }
    return {
      releases: body.releases.map((release) =>
        gameReleaseDescriptorSchema.parse(release),
      ),
      nextCursor: body.nextCursor,
    }
  }

  async getRelease(
    releaseId: string,
    signal?: AbortSignal,
  ): Promise<GameReleaseDescriptor> {
    return gameReleaseDescriptorSchema.parse(
      await this.request(`/v1/releases/${encodeURIComponent(releaseId)}`, {
        signal,
      }),
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

  async createTestRun(
    input: CreateTestRunInput = {},
    signal?: AbortSignal,
  ): Promise<TestRun> {
    const { idempotencyKey = randomIdempotencyKey(), ...body } = input
    return (await this.request('/v1/test-runs', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body,
      signal,
    })) as TestRun
  }

  async getTestRun(runId: string, signal?: AbortSignal): Promise<TestRun> {
    return (await this.request(`/v1/test-runs/${encodeURIComponent(runId)}`, {
      signal,
    })) as TestRun
  }

  async stepTestRun(runId: string, signal?: AbortSignal): Promise<unknown> {
    return this.request(`/v1/test-runs/${encodeURIComponent(runId)}/step`, {
      method: 'POST',
      body: {},
      signal,
    })
  }

  async getTestDiagnostics(
    runId: string,
    query: {
      readonly category?: string
      readonly seatId?: string
      readonly level?: string
      readonly type?: string
      readonly afterSequence?: number
    } = {},
    signal?: AbortSignal,
  ): Promise<DiagnosticList> {
    const parameters = new URLSearchParams()
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) parameters.set(key, String(value))
    }
    const suffix = parameters.size === 0 ? '' : `?${parameters.toString()}`
    return (await this.request(
      `/v1/test-runs/${encodeURIComponent(runId)}/diagnostics${suffix}`,
      { signal },
    )) as DiagnosticList
  }

  async listProjects(): Promise<{ projects: StudioProject[] }> {
    return this.request('/v1/projects') as Promise<{
      projects: StudioProject[]
    }>
  }
  async createProject(document?: GameDocument): Promise<StudioProject> {
    return this.request('/v1/projects', {
      method: 'POST',
      body: { document },
    }) as Promise<StudioProject>
  }
  async getProject(id: string): Promise<StudioProject> {
    return this.request(
      `/v1/projects/${encodeURIComponent(id)}`,
    ) as Promise<StudioProject>
  }
  async updateProject(
    id: string,
    document: GameDocument,
    revision: number,
  ): Promise<StudioProject> {
    return this.request(`/v1/projects/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: document,
      headers: { 'If-Match': String(revision) },
    }) as Promise<StudioProject>
  }
  async publishProject(id: string, revision: number): Promise<StudioRelease> {
    return this.request(`/v1/projects/${encodeURIComponent(id)}/publish`, {
      method: 'POST',
      body: {},
      headers: { 'If-Match': String(revision) },
    }) as Promise<StudioRelease>
  }
  async annotateProject(
    id: string,
    annotation: Omit<
      StudioAnnotation,
      'id' | 'digest' | 'status' | 'createdAt'
    >,
  ): Promise<StudioProject> {
    return this.request(`/v1/projects/${encodeURIComponent(id)}/annotations`, {
      method: 'POST',
      body: annotation,
    }) as Promise<StudioProject>
  }
  async createProjectRun(
    id: string,
    input: { seed?: string; preferences?: number[][] } = {},
  ): Promise<TestRun> {
    return this.request(`/v1/projects/${encodeURIComponent(id)}/runs`, {
      method: 'POST',
      body: input,
    }) as Promise<TestRun>
  }
  async stepProjectRun(id: string, steps: number): Promise<TestRun> {
    return this.request(`/v1/studio/runs/${encodeURIComponent(id)}/step`, {
      method: 'POST',
      body: { steps },
    }) as Promise<TestRun>
  }

  async createBrowserRun(
    projectId: string,
    agentId?: string,
  ): Promise<{ id: string; step: number; revision: number }> {
    return this.request(
      `/v1/projects/${encodeURIComponent(projectId)}/browser-runs`,
      { method: 'POST', body: { agentId } },
    ) as Promise<{ id: string; step: number; revision: number }>
  }
  async decideBrowserAction(
    runId: string,
    input: {
      step: number
      observation: { state: unknown; actions: { id: string; label: string }[] }
      actionId?: string
    },
  ): Promise<{ step: number; decision: { actionId: string; reason: string } }> {
    return this.request(
      `/v1/studio/browser-runs/${encodeURIComponent(runId)}/decide`,
      { method: 'POST', body: input },
    ) as Promise<{
      step: number
      decision: { actionId: string; reason: string }
    }>
  }
  async getBrowserRun(runId: string): Promise<unknown> {
    return this.request(`/v1/studio/browser-runs/${encodeURIComponent(runId)}`)
  }
  async listRecordings(projectId: string): Promise<unknown> {
    return this.request(
      `/v1/projects/${encodeURIComponent(projectId)}/recordings`,
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
    const response = await this.#fetch(
      new URL(path.replace(/^\//, ''), this.#baseUrl.href.replace(/\/?$/, '/')),
      {
        method: options.method,
        headers,
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: options.signal,
      },
    )
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
