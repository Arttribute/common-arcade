import { Hono } from 'hono'
import {
  HTTPFacilitatorClient,
  x402ResourceServer,
  type FacilitatorClient,
} from '@x402/core/server'
import { paymentMiddleware } from '@x402/hono'
import { ExactEvmScheme } from '@x402/evm/exact/server'
import { ExactHederaScheme } from '@x402/hedera/exact/server'
import { NETWORKS, type PaymentNetwork } from '@common-arcade/economy'
import { analysisSchema, analyze } from './analysis.js'
export interface PaidServiceRail {
  network: PaymentNetwork
  payTo: string
  facilitatorUrl: string
}
export async function createPaidAnalysisApi(
  rails: PaidServiceRail[],
  facilitatorFactory: (url: string) => FacilitatorClient = (url) =>
    new HTTPFacilitatorClient({ url }),
) {
  const app = new Hono()
  const discovery: unknown[] = []
  for (const rail of rails) {
    const config = NETWORKS[rail.network]
    if (!config?.testnet)
      throw new Error('Paid analysis rollout is testnet only')
    if (config.id === 'hedera-testnet' && !/^0\.0\.[1-9]\d*$/.test(rail.payTo))
      throw new Error('Hedera requires a numeric payee account ID')
    if (
      config.id !== 'hedera-testnet' &&
      !/^0x[0-9a-fA-F]{40}$/.test(rail.payTo)
    )
      throw new Error('Invalid EVM payee')
    const scheme =
      config.id === 'hedera-testnet'
        ? new ExactHederaScheme()
        : new ExactEvmScheme()
    const facilitator = facilitatorFactory(rail.facilitatorUrl)
    const supported = await facilitator.getSupported()
    if (
      !supported.kinds.some(
        (kind) =>
          kind.x402Version === 2 &&
          kind.network === config.x402Network &&
          kind.scheme === 'exact',
      )
    )
      throw new Error(
        `Facilitator does not support ${config.x402Network} exact v2`,
      )
    const server = new x402ResourceServer(facilitator).register(
      config.x402Network,
      scheme,
    )
    // /supported is checked before advertising a rail. Arc requires a facilitator explicitly supporting its chain.
    await server.initialize()
    const path = `/v1/analysis/${rail.network}`
    app.use(path, async (c, next) => {
      const parsed = analysisSchema.safeParse(
        await c.req.json().catch(() => null),
      )
      if (!parsed.success)
        return c.json({ error: 'Invalid visible-card analysis request' }, 400)
      await next()
    })
    app.use(
      path,
      paymentMiddleware(
        {
          [`POST ${path}`]: {
            accepts: {
              scheme: 'exact',
              network: config.x402Network,
              payTo: rail.payTo,
              maxTimeoutSeconds: 60,
              price: async (context) => {
                const input = analysisSchema.parse(
                  await context.adapter.getBody?.(),
                )
                return {
                  asset: config.asset,
                  amount: String((52 - input.visibleCards.length) * 10),
                  extra:
                    config.id === 'hedera-testnet'
                      ? {}
                      : { name: 'USDC', version: '2' },
                }
              },
            },
            description:
              'Blackjack risk analysis: 10 atomic USDC units per unseen card evaluated',
            mimeType: 'application/json',
          },
        },
        server,
        undefined,
        undefined,
        false,
      ),
    )
    app.post(path, async (c) =>
      c.json(analyze(analysisSchema.parse(await c.req.json()))),
    )
    discovery.push({
      path,
      network: config.x402Network,
      asset: config.asset,
      payTo: rail.payTo,
      scheme: 'exact',
      unitsPerCard: '10',
      facilitator: rail.facilitatorUrl,
    })
  }
  app.get('/.well-known/x402', (c) =>
    c.json({ x402Version: 2, services: discovery }),
  )
  return app
}
