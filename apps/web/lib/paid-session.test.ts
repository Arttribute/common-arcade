// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { verifyMessage } from 'viem'
vi.stubEnv('NEXT_PUBLIC_ARCADE_PAYMENTS_URL', 'https://payments.test')
const { hostPaidSession, paymentService } = await import('./paid-session')

afterEach(() => {
  vi.unstubAllGlobals()
  sessionStorage.clear()
})
it('hosts a game without connecting a payment wallet or asking the user to sign', async () => {
  const wallet = { request: vi.fn() }
  Object.assign(window, { ethereum: wallet })
  const fetch = vi.fn(async (_url: unknown, _init?: RequestInit) => ({
    ok: true,
    json: async () => ({ id: 'mat_host' }),
  }))
  vi.stubGlobal('fetch', fetch)
  const body = {
    id: 'c4ae02a8-8dd1-4600-a08c-5c247cf797ed',
    economy: {
      mode: 'escrow' as const,
      network: 'base-sepolia' as const,
      stakeUnits: '1000000',
      bounties: false,
      spectatorBets: true,
      feeBps: 250 as const,
      fundingSeconds: 600,
      settlementSeconds: 3600,
    },
  }
  await hostPaidSession(body)
  expect(wallet.request).not.toHaveBeenCalled()
  const sent = JSON.parse(
    (fetch.mock.calls[0]?.[1] as RequestInit).body as string,
  )
  expect(
    await verifyMessage({
      address: sent.auth.address,
      signature: sent.auth.signature,
      message: JSON.stringify({
        domain: paymentService,
        matchId: `mat_${body.id}`,
        operation: 'create',
        body: sent.body,
        expiresAt: sent.auth.expiresAt,
      }),
    }),
  ).toBe(true)
})
