import { signGameCommand } from './game-session-key'
import { economyConfigSchema, type EconomyConfig } from '@common-arcade/economy'

export const paymentService =
  process.env.NEXT_PUBLIC_ARCADE_PAYMENTS_URL ??
  (process.env.NODE_ENV === 'development' ? 'http://localhost:4021' : '')
/** The caller retains the body across retries so a lost response cannot create a second pool. */
export async function hostPaidSession(input: {
  id: string
  releaseId?: string
  economy: EconomyConfig
}) {
  const body = {
    id: input.id,
    ...(input.releaseId ? { releaseId: input.releaseId } : {}),
    economy: economyConfigSchema.parse(input.economy),
    startWhenReady: true,
  }
  if (!paymentService) throw new Error('Paid sessions are unavailable')
  const auth = await signGameCommand(
    paymentService,
    `mat_${body.id}`,
    'create',
    body,
  )
  const response = await fetch(`${paymentService}/v1/economy/matches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body, auth }),
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error ?? 'Could not host session')
  return result
}
