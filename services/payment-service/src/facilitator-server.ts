import { serve } from '@hono/node-server'
import type { Hex } from 'viem'
import type { PaymentNetwork } from '@common-arcade/economy'
import { createEvmFacilitator } from './evm-facilitator.js'
if (!process.env.ARCADE_FACILITATOR_PRIVATE_KEY)
  throw new Error('A funded testnet facilitator key is required')
const app = createEvmFacilitator(
  (process.env.ARCADE_FACILITATOR_NETWORK ?? 'arc-testnet') as PaymentNetwork,
  process.env.ARCADE_FACILITATOR_PRIVATE_KEY as Hex,
  process.env.ARCADE_FACILITATOR_RPC_URL,
)
// Bind behind a private reverse proxy; public clients pay the resource service, not this signer.
serve({
  fetch: app.fetch,
  hostname: process.env.ARCADE_FACILITATOR_HOST ?? '127.0.0.1',
  port: Number(process.env.ARCADE_FACILITATOR_PORT ?? 4022),
})
