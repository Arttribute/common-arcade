import { handle } from 'hono/aws-lambda'
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda'
import { randomUUID } from 'node:crypto'
import { createApp } from './app.js'
import type { CopilotJobInvocation } from './studio.js'

const workerSecret = randomUUID()
const lambda = new LambdaClient({})
const app = createApp({
  publicBaseUrl: process.env.ARCADE_PUBLIC_BASE_URL,
  realtimeUrl:
    process.env.ARCADE_REALTIME_CONTROL_URL?.replace('https:', 'wss:') +
    '/realtime',
  workerSecret,
  dispatchCopilotJob: async (invocation) => {
    if (!process.env.AWS_LAMBDA_FUNCTION_NAME)
      throw new Error('Copilot worker is unavailable.')
    const response = await lambda.send(
      new InvokeCommand({
        FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME,
        InvocationType: 'Event',
        Payload: Buffer.from(
          JSON.stringify({ kind: 'common-arcade-copilot-job', invocation }),
        ),
      }),
    )
    if (response.StatusCode !== 202)
      throw new Error('Copilot worker could not be queued.')
  },
})
const httpHandler = handle(app)

type CopilotWorkerEvent = {
  kind: 'common-arcade-copilot-job'
  invocation: CopilotJobInvocation
}

export const handler = async (event: unknown, context: any) => {
  if (
    event &&
    typeof event === 'object' &&
    (event as CopilotWorkerEvent).kind === 'common-arcade-copilot-job'
  ) {
    const { invocation } = event as CopilotWorkerEvent
    const response = await app.request(
      `/v1/internal/copilot-jobs/${encodeURIComponent(invocation.jobId)}/run`,
      {
        method: 'POST',
        headers: {
          Authorization: invocation.authorization,
          'Content-Type': 'application/json',
          'X-Arcade-Worker-Secret': workerSecret,
        },
        body: JSON.stringify(invocation.input),
      },
    )
    if (!response.ok)
      throw new Error(`Copilot worker failed (${response.status}).`)
    return { ok: true }
  }
  return httpHandler(event as never, context)
}
