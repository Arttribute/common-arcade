import { it, expect } from 'vitest'
import { Hono } from 'hono'
import { readFile } from 'node:fs/promises'
import { createWalletClient, http, publicActions, erc20Abi } from 'viem'
import { mnemonicToAccount } from 'viem/accounts'
import { foundry } from 'viem/chains'
import { x402Client, x402HTTPClient } from '@x402/core/client'
import type { SupportedResponse } from '@x402/core/types'
import { x402ResourceServer } from '@x402/core/server'
import { x402Facilitator } from '@x402/core/facilitator'
import { ExactEvmScheme as FacilitatorScheme } from '@x402/evm/exact/facilitator'
import { ExactEvmScheme as ClientScheme } from '@x402/evm/exact/client'
import { ExactEvmScheme as ServerScheme } from '@x402/evm/exact/server'
import { toFacilitatorEvmSigner } from '@x402/evm'
import { paymentMiddleware } from '@x402/hono'
const rpc = process.env.ARCADE_ANVIL_URL
it.skipIf(!rpc)(
  'signs and settles an actual x402 EIP-3009 USDC request with official SDKs',
  async () => {
    if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(rpc!))
      throw new Error('Local Anvil required')
    const accounts = [7, 8, 9].map((addressIndex) =>
      mnemonicToAccount(
        'test test test test test test test test test test test junk',
        { addressIndex },
      ),
    )
    const client = createWalletClient({
      account: accounts[0]!,
      chain: foundry,
      transport: http(rpc),
      pollingInterval: 50,
    }).extend(publicActions)
    const artifact = JSON.parse(
      await readFile(
        new URL(
          '../../../packages/contracts/out/TestUSDC.sol/TestUSDC.json',
          import.meta.url,
        ),
        'utf8',
      ),
    )
    const deployment = await client.deployContract({
      abi: artifact.abi,
      bytecode: artifact.bytecode.object,
    })
    const token = (await client.waitForTransactionReceipt({ hash: deployment }))
      .contractAddress!
    const mint = await client.writeContract({
      address: token,
      abi: artifact.abi,
      functionName: 'mint',
      args: [accounts[1]!.address, 1000000n],
    })
    await client.waitForTransactionReceipt({ hash: mint })
    const facilitator = new x402Facilitator().register(
      'eip155:31337',
      new FacilitatorScheme(
        toFacilitatorEvmSigner({
          ...client,
          address: accounts[0]!.address,
          verifyTypedData: (args) =>
            client.verifyTypedData({
              ...args,
              blockTag: 'latest',
            } as Parameters<typeof client.verifyTypedData>[0]),
        }),
      ),
    )
    const server = new x402ResourceServer({
      getSupported: async () => facilitator.getSupported() as SupportedResponse,
      verify: (p, r) => facilitator.verify(p, r),
      settle: (p, r) => facilitator.settle(p, r),
    }).register('eip155:31337', new ServerScheme())
    await server.initialize()
    const app = new Hono()
    app.use(
      '*',
      paymentMiddleware(
        {
          'GET /paid': {
            accepts: {
              scheme: 'exact',
              network: 'eip155:31337',
              payTo: accounts[2]!.address,
              price: {
                asset: token,
                amount: '480',
                extra: { name: 'USDC', version: '2' },
              },
              maxTimeoutSeconds: 60,
            },
          },
        },
        server,
        undefined,
        undefined,
        false,
      ),
    )
    app.get('/paid', (c) => c.json({ analysis: 'delivered' }))
    const unpaid = await app.request('/paid')
    expect(unpaid.status).toBe(402)
    const payer = new x402Client()
        .setSpendControls({
          allowedAssets: [
            {
              network: 'eip155:31337',
              asset: token,
              maxAmountPerPayment: '480',
            },
          ],
        })
        .register('eip155:31337', new ClientScheme(accounts[1]!)),
      httpClient = new x402HTTPClient(payer)
    const required = httpClient.getPaymentRequiredResponse((name) =>
        unpaid.headers.get(name),
      ),
      payload = await httpClient.createPaymentPayload(required)
    const paid = await app.request('/paid', {
      headers: httpClient.encodePaymentSignatureHeader(payload),
    })
    expect(paid.status).toBe(200)
    const receipt = httpClient.getPaymentSettleResponse((name) =>
      paid.headers.get(name),
    )
    expect(receipt?.success).toBe(true)
    expect(receipt?.transaction).toMatch(/^0x/)
    expect(
      await client.readContract({
        address: token,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [accounts[2]!.address],
      }),
    ).toBe(480n)
    const replay = await app.request('/paid', {
      headers: httpClient.encodePaymentSignatureHeader(payload),
    })
    expect(replay.status).toBe(402)
    expect(
      await client.readContract({
        address: token,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [accounts[2]!.address],
      }),
    ).toBe(480n)
  },
  60000,
)
