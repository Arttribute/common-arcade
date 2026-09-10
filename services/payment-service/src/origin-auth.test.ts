import { expect, it } from 'vitest'
import { createApp } from './app.js'
import { trustedOrigin } from './origin-auth.js'

it('requires the CloudFront origin credential while preserving load-balancer health checks', async () => {
  const app = await createApp([], undefined, 'test-origin-token')
  expect((await app.request('/healthz')).status).toBe(200)
  expect((await app.request('/.well-known/x402')).status).toBe(403)
  expect(
    (
      await app.request('/.well-known/x402', {
        headers: { 'X-Arcade-Origin': 'wrong' },
      })
    ).status,
  ).toBe(403)
  expect(
    (
      await app.request('/.well-known/x402', {
        headers: { 'X-Arcade-Origin': 'test-origin-token' },
      })
    ).status,
  ).toBe(200)
})

it('uses the same credential check for WebSocket upgrade requests', () => {
  expect(trustedOrigin('test-origin-token', undefined)).toBe(false)
  expect(trustedOrigin('test-origin-token', 'wrong')).toBe(false)
  expect(trustedOrigin('test-origin-token', 'test-origin-token')).toBe(true)
  expect(trustedOrigin(undefined, undefined)).toBe(true)
})
