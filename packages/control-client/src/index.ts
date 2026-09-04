export interface ControlClientOptions {
  baseUrl: string
  fetch?: typeof globalThis.fetch
}

export interface ArcadeBootstrapStatus {
  name: string
  phase: 'bootstrap'
  capabilities: string[]
  protocol: { namespace: string; normative: false }
  message: string
}

export class ControlClient {
  readonly #baseUrl: URL
  readonly #fetch: typeof globalThis.fetch

  constructor(options: ControlClientOptions) {
    this.#baseUrl = new URL(options.baseUrl)
    this.#fetch = options.fetch ?? globalThis.fetch
  }

  async getStatus(signal?: AbortSignal): Promise<ArcadeBootstrapStatus> {
    const response = await this.#fetch(new URL('/v1/status', this.#baseUrl), {
      signal,
      headers: { accept: 'application/json' },
    })
    if (!response.ok) {
      throw new Error(`Common Arcade status request failed: ${response.status}`)
    }
    return (await response.json()) as ArcadeBootstrapStatus
  }
}
