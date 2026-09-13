import { attachPaymentSocket } from './realtime-socket.js'
import { releaseLoader } from './releases.js'
import { serve } from '@hono/node-server'
import { WebSocketServer } from 'ws'
import {
  createPublicClient,
  createWalletClient,
  http,
  isAddress,
  type Hex,
  type Address,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { NETWORKS, type PaymentNetwork } from '@common-arcade/economy'
import { createApp } from './app.js'
import { MatchHost } from './matches.js'
import { FileMatchStore } from './store.js'
import {
  createSettlementAdapter,
  type MatchSettlementAdapter,
} from './escrow.js'
import type { PaidServiceRail } from './x402.js'
import { trustedOrigin } from './origin-auth.js'
const rails: PaidServiceRail[] = JSON.parse(
  process.env.ARCADE_X402_RAILS ?? '[]',
)
const deployments: Partial<
  Record<
    PaymentNetwork,
    {
      contract: Address
      treasury?: Address
      safe?: Address
      rpcUrl?: string
      openSeats?: boolean
    }
  >
> = JSON.parse(process.env.ARCADE_ESCROW_DEPLOYMENTS ?? '{}')
const legacyDeployments: typeof deployments = JSON.parse(
  process.env.ARCADE_ESCROW_LEGACY_DEPLOYMENTS ?? '{}',
)
const adapters: Record<string, MatchSettlementAdapter> = {}
for (const [key, deployment] of [
  ...Object.entries(deployments),
  ...Object.entries(legacyDeployments).map(
    ([id, value]) => [`${id}:legacy`, value] as const,
  ),
]) {
  const id = key.split(':')[0]!
  const network = NETWORKS[id as PaymentNetwork]
  if (!network?.testnet) throw new Error('Escrow service is testnet only')
  const treasury = deployment.treasury ?? deployment.safe
  if (!treasury || !isAddress(treasury) || /^0x0{40}$/i.test(treasury))
    throw new Error(`Missing or invalid treasury for ${id}`)
  const signingKey = process.env[`ARCADE_RESOLVER_KEY_${network.chain.id}`] as
    Hex | undefined
  if (!signingKey) throw new Error(`Missing resolver key for ${id}`)
  const reader = createPublicClient({
    chain: network.chain,
    transport: http(deployment.rpcUrl),
  })
  const wallet = createWalletClient({
    chain: network.chain,
    transport: http(deployment.rpcUrl),
    account: privateKeyToAccount(signingKey),
  })
  adapters[key] = createSettlementAdapter(
    {
      chainId: network.chain.id,
      contract: deployment.contract,
      token: network.token,
      openSeats: deployment.openSeats,
    },
    reader,
    wallet,
    treasury,
  )
  adapters[`${id}:${deployment.contract.toLowerCase()}`] = adapters[key]!
}
const host = new MatchHost(
  new FileMatchStore(process.env.ARCADE_PAYMENT_DATA_DIR ?? './.payment-data'),
  adapters,
  process.env.ARCADE_PAYMENT_DOMAIN ?? 'http://localhost:4021',
  undefined,
  new Set(
    (process.env.ARCADE_PAYMENT_CREATORS ?? '')
      .split(',')
      .map((a) => a.trim().toLowerCase())
      .filter(Boolean),
  ),
  process.env.ARCADE_REGISTRY_URL
    ? releaseLoader(process.env.ARCADE_REGISTRY_URL)
    : undefined,
)
const app = await createApp(rails, host)
await host.recoverRealtime()
const server = serve({
  fetch: app.fetch,
  port: Number(process.env.PORT ?? 4021),
})
const wss = new WebSocketServer({
  server: server as import('node:http').Server,
  path: '/v1/economy/live',
  maxPayload: 32768,
  verifyClient: ({ req }: { req: import('node:http').IncomingMessage }) =>
    trustedOrigin(
      process.env.ARCADE_ORIGIN_TOKEN,
      typeof req.headers['x-arcade-origin'] === 'string'
        ? req.headers['x-arcade-origin']
        : undefined,
    ),
})
wss.on('connection', (socket, request) => {
  const id =
    new URL(request.url ?? '/', 'http://localhost').searchParams.get(
      'matchId',
    ) ?? ''
  attachPaymentSocket(host, socket, id)
})
let shuttingDown = false
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.on(signal, () => {
    if (shuttingDown) return
    shuttingDown = true
    // Preserve the single-writer handoff and the last confirmed game state.
    for (const socket of wss.clients)
      socket.close(1012, 'Worker restarting; reconnect')
    wss.close()
    server.close()
    void host
      .close()
      .then(() => process.exit(0))
      .catch((error) => {
        console.error('Payment worker shutdown failed', error)
        process.exit(1)
      })
  })
