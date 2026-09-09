import { it, expect, vi } from 'vitest'
import { createPaidAnalysisApi } from './x402.js'
import { encodePaymentSignatureHeader } from '@x402/core/http'
import type { FacilitatorClient } from '@x402/core/server'
const payTo = '0x1111111111111111111111111111111111111111'
const body = { hand: [0, 8], visibleCards: [0, 8, 12, 13] }
function facilitator(success = true): FacilitatorClient {
  return {
    getSupported: async () => ({
      kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:84532' }],
      extensions: [],
      signers: {},
    }),
    verify: async () => ({ isValid: true, payer: payTo }),
    settle: vi.fn(async () => ({
      success,
      transaction: success ? `0x${'ab'.repeat(32)}` : '',
      network: 'eip155:84532' as const,
      payer: payTo,
      ...(success ? {} : { errorReason: 'insufficient_funds' }),
    })),
  }
}
it('advertises computed per-card price and settles before delivering analysis', async () => {
  const f = facilitator(),
    app = await createPaidAnalysisApi(
      [
        {
          network: 'base-sepolia',
          payTo,
          facilitatorUrl: 'https://facilitator.test',
        },
      ],
      () => f,
    )
  const unpaid = await app.request('/v1/analysis/base-sepolia', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  expect(unpaid.status).toBe(402)
  const required = JSON.parse(
    Buffer.from(unpaid.headers.get('PAYMENT-REQUIRED')!, 'base64').toString(),
  )
  expect(required.accepts[0].amount).toBe('480')
  const paid = await app.request('/v1/analysis/base-sepolia', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'PAYMENT-SIGNATURE': encodePaymentSignatureHeader({
        x402Version: 2,
        accepted: required.accepts[0],
        payload: { test: true },
      }),
    },
    body: JSON.stringify(body),
  })
  expect(paid.status).toBe(200)
  expect(f.settle).toHaveBeenCalledOnce()
  expect(paid.headers.get('PAYMENT-RESPONSE')).toBeTruthy()
  expect((await paid.json()).evaluatedCards).toBe(48)
})
it('does not deliver paid content when settlement fails', async () => {
  const app = await createPaidAnalysisApi(
    [
      {
        network: 'base-sepolia',
        payTo,
        facilitatorUrl: 'https://facilitator.test',
      },
    ],
    () => facilitator(false),
  )
  const requirements = {
    scheme: 'exact',
    network: 'eip155:84532' as const,
    amount: '480',
    asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    payTo,
    maxTimeoutSeconds: 60,
    extra: { name: 'USDC', version: '2' },
  }
  const response = await app.request('/v1/analysis/base-sepolia', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'PAYMENT-SIGNATURE': encodePaymentSignatureHeader({
        x402Version: 2,
        accepted: requirements,
        payload: { test: true },
      }),
    },
    body: JSON.stringify(body),
  })
  expect(response.status).toBe(402)
  expect(await response.text()).not.toContain('bustProbability')
})
it('validates input before requesting money', async () => {
  const f = facilitator(),
    app = await createPaidAnalysisApi(
      [
        {
          network: 'base-sepolia',
          payTo,
          facilitatorUrl: 'https://facilitator.test',
        },
      ],
      () => f,
    )
  const response = await app.request('/v1/analysis/base-sepolia', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hand: [0, 0], visibleCards: [0] }),
  })
  expect(response.status).toBe(400)
  expect(f.settle).not.toHaveBeenCalled()
})
