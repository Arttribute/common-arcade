import { describe, expect, it } from 'vitest'
import { createApp } from './app.js'

describe('x402 coaching service', () => {
  it('requires a payee account id', () => {
    expect(() =>
      createApp({ facilitatorUrl: 'https://example.invalid' }),
    ).toThrow(/X402_HEDERA_PAYEE_ACCOUNT_ID/)
  })

  it('requires a facilitator url', () => {
    expect(() => createApp({ payToAccountId: '0.0.1234' })).toThrow(
      /X402_FACILITATOR_URL_HEDERA/,
    )
  })

  it('exposes an unauthenticated health check', async () => {
    const app = createApp({
      payToAccountId: '0.0.1234',
      facilitatorUrl: 'https://example.invalid',
    })
    const response = await app.request('/healthz')
    expect(response.status).toBe(200)
    const body = (await response.json()) as { ok: boolean; network: string }
    expect(body.ok).toBe(true)
    expect(body.network).toMatch(/^hedera:/)
  })
})
