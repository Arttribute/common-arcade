import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { createPublicClient, http, parseAbi, parseEventLogs } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { x402Client, x402HTTPClient } from '@x402/core/client'
import { ExactEvmScheme } from '@x402/evm/exact/client'
import { NETWORKS } from '@common-arcade/economy'
import { createPaidAnalysisApi } from '../src/x402.ts'
import { createEvmFacilitator } from '../src/evm-facilitator.ts'

// Runs the real service and facilitator handlers in-process against canonical
// public testnet USDC. Payer and payee are the same temporary test wallet.
try {
  const networkId = process.argv[2]
  if (
    !['base-sepolia', 'arc-testnet'].includes(networkId) ||
    !process.argv.includes('--broadcast')
  )
    throw new Error(
      'Select base-sepolia or arc-testnet and explicitly pass --broadcast',
    )
  const network = NETWORKS[networkId]
  const key = process.env.ARCADE_DEPLOYER_KEY
  const account = privateKeyToAccount(key)
  const rpcUrl =
    process.env.ARCADE_DEPLOY_RPC_URL ?? network.chain.rpcUrls.default.http[0]
  const reader = createPublicClient({
    chain: network.chain,
    transport: http(rpcUrl),
  })
  assert.equal(await reader.getChainId(), network.chain.id)
  const facilitator = createEvmFacilitator(networkId, key, rpcUrl)
  const adapter = {
    getSupported: async () => (await facilitator.request('/supported')).json(),
    verify: async (paymentPayload, paymentRequirements) =>
      (
        await facilitator.request('/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paymentPayload, paymentRequirements }),
        })
      ).json(),
    settle: async (paymentPayload, paymentRequirements) =>
      (
        await facilitator.request('/settle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paymentPayload, paymentRequirements }),
        })
      ).json(),
  }
  const app = await createPaidAnalysisApi(
    [
      {
        network: networkId,
        payTo: account.address,
        facilitatorUrl: 'http://localhost',
      },
    ],
    () => adapter,
  )
  const body = JSON.stringify({ hand: [0, 8], visibleCards: [0, 8, 12, 13] })
  const path = `/v1/analysis/${networkId}`
  const unpaid = await app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  })
  assert.equal(unpaid.status, 402)
  const payer = new x402Client()
    .setSpendControls({
      allowedAssets: [
        {
          network: network.x402Network,
          asset: network.token,
          maxAmountPerPayment: '480',
        },
      ],
    })
    .register(network.x402Network, new ExactEvmScheme(account))
  const client = new x402HTTPClient(payer)
  const required = client.getPaymentRequiredResponse((name) =>
    unpaid.headers.get(name),
  )
  const payload = await client.createPaymentPayload(required)
  const headers = {
    'Content-Type': 'application/json',
    ...client.encodePaymentSignatureHeader(payload),
  }
  const paid = await app.request(path, { method: 'POST', headers, body })
  assert.equal(paid.status, 200, 'Paid analysis did not settle')
  assert.equal((await paid.json()).evaluatedCards, 48)
  const settlement = client.getPaymentSettleResponse((name) =>
    paid.headers.get(name),
  )
  assert.equal(settlement.success, true)
  const receipt = await reader.waitForTransactionReceipt({
    hash: settlement.transaction,
    confirmations: 2,
  })
  assert.equal(receipt.status, 'success')
  const transferAbi = parseAbi([
    'event Transfer(address indexed from, address indexed to, uint256 value)',
  ])
  const transfers = parseEventLogs({
    abi: transferAbi,
    logs: receipt.logs,
  }).filter(
    (event) => event.address.toLowerCase() === network.token.toLowerCase(),
  )
  assert.ok(
    transfers.some(
      (event) =>
        event.args.from.toLowerCase() === account.address.toLowerCase() &&
        event.args.to.toLowerCase() === account.address.toLowerCase() &&
        event.args.value === 480n,
    ),
  )
  const replay = await app.request(path, { method: 'POST', headers, body })
  assert.equal(replay.status, 402, 'Replayed payment must be rejected')
  const evidence = {
    network: networkId,
    chainId: network.chain.id,
    asset: network.token,
    payer: account.address,
    payTo: account.address,
    amount: '480',
    transaction: settlement.transaction,
    blockNumber: String(receipt.blockNumber),
    verifiedAt: new Date().toISOString(),
    checks: [
      'unpaid response 402',
      'official x402 client authorization',
      'canonical USDC EIP-3009 transfer',
      'analysis delivered after settlement',
      'replay rejected',
    ],
    transport:
      'in-process real payment-service and EVM facilitator handlers; public testnet RPC',
  }
  await writeFile(
    new URL(
      `../../../packages/contracts/deployments/${networkId}-x402.json`,
      import.meta.url,
    ),
    JSON.stringify(evidence, null, 2) + '\n',
  )
  console.log(
    `Verified ${networkId} x402 settlement: ${settlement.transaction}`,
  )
} catch (error) {
  console.error(error.shortMessage ?? error.message)
  process.exitCode = 1
}
