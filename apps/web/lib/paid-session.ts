import { createWalletClient, custom, type EIP1193Provider } from 'viem'
import { economyConfigSchema, type EconomyConfig } from '@common-arcade/economy'

export const paymentService =
  process.env.NEXT_PUBLIC_ARCADE_PAYMENTS_URL ??
  (process.env.NODE_ENV === 'development' ? 'http://localhost:4021' : '')
export function paymentProvider() {
  const provider = (window as unknown as { ethereum?: EIP1193Provider })
    .ethereum
  if (!provider) throw new Error('Connect an EVM wallet to continue.')
  return provider
}
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
  }
  if (!paymentService) throw new Error('Paid sessions are unavailable')
  const wallet = createWalletClient({ transport: custom(paymentProvider()) })
  const [address] = await wallet.requestAddresses()
  if (!address) throw new Error('Connect a wallet to host this session')
  const expiresAt = Date.now() + 60000
  const signature = await wallet.signMessage({
    account: address,
    message: JSON.stringify({
      domain: paymentService,
      matchId: `mat_${body.id}`,
      operation: 'create',
      body,
      expiresAt,
    }),
  })
  const response = await fetch(`${paymentService}/v1/economy/matches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body, auth: { address, expiresAt, signature } }),
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error ?? 'Could not host session')
  return result
}
