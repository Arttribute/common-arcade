import { releaseLoader } from './releases.js'
import { serve } from '@hono/node-server'
import { WebSocketServer } from 'ws'
import {
  createPublicClient,
  createWalletClient,
  http,
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
const rails: PaidServiceRail[] = JSON.parse(
  process.env.ARCADE_X402_RAILS ?? '[]',
)
const deployments: Partial<
  Record<PaymentNetwork, { contract: Address; safe: Address; rpcUrl?: string }>
> = JSON.parse(process.env.ARCADE_ESCROW_DEPLOYMENTS ?? '{}')
const adapters: Record<string, MatchSettlementAdapter> = {}
for (const [id, deployment] of Object.entries(deployments)) {
  const network = NETWORKS[id as PaymentNetwork]
  if (!network?.testnet) throw new Error('Escrow service is testnet only')
  const key = process.env[`ARCADE_RESOLVER_KEY_${network.chain.id}`] as
    Hex | undefined
  if (!key) throw new Error(`Missing resolver key for ${id}`)
  const reader = createPublicClient({
    chain: network.chain,
    transport: http(deployment.rpcUrl),
  })
  const wallet = createWalletClient({
    chain: network.chain,
    transport: http(deployment.rpcUrl),
    account: privateKeyToAccount(key),
  })
  adapters[id] = createSettlementAdapter(
    {
      chainId: network.chain.id,
      contract: deployment.contract,
      token: network.token,
    },
    reader,
    wallet,
    deployment.safe,
  )
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
const server = serve({
  fetch: app.fetch,
  port: Number(process.env.PORT ?? 4021),
})
const wss = new WebSocketServer({
  server: server as import('node:http').Server,
  path: '/v1/economy/live',
  maxPayload: 32768,
})
wss.on('connection', (socket, request) => {
  const id =
    new URL(request.url ?? '/', 'http://localhost').searchParams.get(
      'matchId',
    ) ?? ''
  let closed = false
  const send = (value: unknown) => {
    if (socket.readyState === socket.OPEN) {
      if (socket.bufferedAmount > 1_000_000) {
        socket.close(1013, 'Slow consumer')
        return
      }
      socket.send(JSON.stringify(value))
    }
  }
  const unsubscribe = host.subscribe(id, send)
  socket.on('close', () => {
    closed = true
    unsubscribe()
  })
  host
    .view(id)
    .then((value) => {
      if (!closed) send(value)
    })
    .catch(() => socket.close(1008, 'Unknown match'))
  // Spectator channel is read-only; signed actions share the HTTP capability boundary.
  socket.on('message', () => socket.close(1008, 'Use signed action endpoint'))
})
