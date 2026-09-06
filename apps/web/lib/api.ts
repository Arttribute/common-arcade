import { ControlClient } from '@common-arcade/control-client'
export async function arcade<T>(
  path: string,
  body?: unknown,
  method = body === undefined ? 'GET' : 'POST',
  headers: Record<string, string> = {},
): Promise<T> {
  const response = await fetch(`/api/arcade/v1/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const result = await response.json()
  if (!response.ok)
    throw new Error(
      result.detail ?? result.error ?? 'Request failed. Please retry.',
    )
  return result as T
}

export type CopilotProposal = {
  summary: string
  document: unknown
  baseRevision: number
  agentId: string
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
  options: { signal?: AbortSignal; onWait?: (seconds: number) => void } = {},
): Promise<CopilotProposal> {
  const started = await arcade<{ jobId: string }>(
    `projects/${projectId}/copilot`,
    request,
  )
  const startedAt = Date.now()
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 2000))
    if (options.signal?.aborted) throw new Error('Build cancelled.')
    const job = await arcade<
      {
        status: 'running' | 'ready' | 'failed'
        error?: string
      } & Partial<CopilotProposal>
    >(`studio/copilot-jobs/${started.jobId}`)
    if (job.status === 'ready')
      return {
        summary: job.summary ?? '',
        document: job.document,
        baseRevision: job.baseRevision ?? 0,
        agentId: job.agentId ?? request.agentId,
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
