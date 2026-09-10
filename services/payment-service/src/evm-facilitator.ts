import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { x402Facilitator } from '@x402/core/facilitator'
import { ExactEvmScheme } from '@x402/evm/exact/facilitator'
import { toFacilitatorEvmSigner } from '@x402/evm'
import { createWalletClient, http, publicActions, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { NETWORKS, type PaymentNetwork } from '@common-arcade/economy'
/** Optional single-instance Arc/Base testnet facilitator. Hedera always uses Blocky402. */
export function createEvmFacilitator(
  networkId: PaymentNetwork,
  key: Hex,
  rpcUrl?: string,
) {
  const network = NETWORKS[networkId]
  if (!network.testnet || networkId === 'hedera-testnet')
    throw new Error(
      'Only Arc and Base testnet EVM rails may be self-hosted here',
    )
  const account = privateKeyToAccount(key),
    client = createWalletClient({
      account,
      chain: network.chain,
      transport: http(rpcUrl),
    }).extend(publicActions)
  const signer = toFacilitatorEvmSigner({
    ...client,
    address: account.address,
    verifyTypedData: (args) =>
      client.verifyTypedData({ ...args, blockTag: 'latest' } as Parameters<
        typeof client.verifyTypedData
      >[0]),
  })
  const facilitator = new x402Facilitator().register(
    network.x402Network,
    new ExactEvmScheme(signer),
  )
  const app = new Hono()
  app.use('*', bodyLimit({ maxSize: 65536 }))
  app.get('/supported', (c) => c.json(facilitator.getSupported()))
  app.post('/verify', async (c) => {
    const body = await c.req.json()
    return c.json(
      await facilitator.verify(body.paymentPayload, body.paymentRequirements),
    )
  })
  app.post('/settle', async (c) => {
    const body = await c.req.json()
    // Only sponsor the configured canonical USDC on this testnet.
    if (
      body.paymentRequirements?.network !== network.x402Network ||
      body.paymentRequirements?.asset?.toLowerCase() !==
        network.token.toLowerCase()
    )
      return c.json(
        {
          success: false,
          errorReason: 'unsupported_asset',
          transaction: '',
          network: network.x402Network,
        },
        400,
      )
    return c.json(
      await facilitator.settle(body.paymentPayload, body.paymentRequirements),
    )
  })
  return app
}
