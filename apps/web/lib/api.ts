import { ControlClient } from '@common-arcade/control-client'
export class ArcadeApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ArcadeApiError'
  }
}
export async function arcade<T>(
  path: string,
  body?: unknown,
  method = body === undefined ? 'GET' : 'POST',
  headers: Record<string, string> = {},
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api/arcade/v1/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  })
  const text = await response.text()
  let result
  try {
    result = JSON.parse(text)
  } catch {
    throw new Error(
      response.ok
        ? 'Arcade returned an invalid response. Please retry.'
        : `Arcade is temporarily unavailable (HTTP ${response.status}). Please retry.`,
    )
  }
  if (!response.ok)
    throw new ArcadeApiError(
      result.detail ?? result.error ?? 'Request failed. Please retry.',
      response.status,
    )
  return result as T
}

export type CopilotActivity = {
  sequence: number
  type: 'status' | 'tool'
  label: string
  status?: string
  tool?: string
  timestamp: string
}
export type CopilotResult = {
  response: string
  projectRevision: number
  agentId: string
  sessionId?: string
  durationSeconds: number
  events: CopilotActivity[]
}
/**
 * Runs one copilot turn to completion. The build itself is a single agent run;
 * it is collected by polling because a whole game takes minutes and every CDN
 * in front of the control plane closes a response long before then.
 */
export async function arcadeCopilot(
  projectId: string,
  request: {
    message: string
    agentId: string
    attachments?: { fileId: string }[]
    model?: { provider: string; modelId: string }
  },
  options: {
    signal?: AbortSignal
    onWait?: (seconds: number) => void
    onUpdate?: (events: CopilotActivity[]) => void
  } = {},
): Promise<CopilotResult> {
  const started = await arcade<{ jobId?: string }>(
    `projects/${projectId}/copilot`,
    request,
  )
  if (!started.jobId)
    throw new Error('The build could not be started. Please retry.')
  const startedAt = Date.now()
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 2000))
    if (options.signal?.aborted) throw new Error('Build cancelled.')
    const job = await arcade<
      {
        status: 'running' | 'ready' | 'failed'
        error?: string
      } & Partial<CopilotResult>
    >(`studio/copilot-jobs/${started.jobId}`)
    options.onUpdate?.(job.events ?? [])
    if (job.status === 'ready')
      return {
        response: job.response ?? 'Done.',
        projectRevision: job.projectRevision ?? 0,
        agentId: job.agentId ?? request.agentId,
        sessionId: job.sessionId,
        durationSeconds: job.durationSeconds ?? 0,
        events: job.events ?? [],
      }
    if (job.status === 'failed')
      throw new Error(job.error ?? 'The agent could not build this game.')
    options.onWait?.(Math.round((Date.now() - startedAt) / 1000))
  }
}

export function browserControlClient() {
  return new ControlClient({
    baseUrl: 'https://arcade.invalid',
    fetch: (input, init) => {
      const url = new URL(String(input))
      return fetch(`/api/arcade${url.pathname}${url.search}`, init)
    },
  })
}
