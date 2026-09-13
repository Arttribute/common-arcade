import { describe, expect, it } from 'vitest'
import { NETWORKS, type PaymentNetwork } from '@common-arcade/economy'
import { analysisGrantProblem, analysisRecipient } from './x402-service'

const origin = 'https://payments.example'
const address = `0x${'1'.repeat(40)}`
const services = Object.values(NETWORKS).map((network) => ({
  path: `/v1/analysis/${network.id}`,
  network: network.x402Network,
  asset: network.asset,
  scheme: 'exact',
  payTo: network.id === 'hedera-testnet' ? '0.0.10456930' : address,
}))

describe('analysis service discovery', () => {
  it.each(Object.keys(NETWORKS) as PaymentNetwork[])(
    'selects the advertised recipient on %s',
    (network) => {
      expect(analysisRecipient({ x402Version: 2, services }, network)).toBe(
        network === 'hedera-testnet' ? '0.0.10456930' : address,
      )
    },
  )
  it('rejects a different asset, service path, or malformed discovery', () => {
    for (const override of [
      { asset: 'wrong' },
      { asset: 1 },
      { path: '/another-service' },
      { payTo: '0.0.1' },
    ]) {
      expect(
        analysisRecipient(
          { x402Version: 2, services: [{ ...services[0], ...override }] },
          'base-sepolia',
        ),
      ).toBeUndefined()
    }
    expect(analysisRecipient({ services }, 'base-sepolia')).toBeUndefined()
    expect(analysisRecipient(null, 'base-sepolia')).toBeUndefined()
  })
})

describe('analysis budget eligibility', () => {
  const grant = {
    expires_at: '2030-01-01T00:00:00Z',
    revoked_at: null,
    policy: { origin, network: 'hedera:testnet' },
  }
  const now = Date.parse('2026-09-13T00:00:00Z')
  it('allows an active service budget and normalizes origins', () => {
    expect(analysisGrantProblem(grant, `${origin}/`, now)).toBeUndefined()
  })
  it('requires a selection and rejects expired, revoked, match and other-service budgets', () => {
    expect(analysisGrantProblem(undefined, origin, now)).toContain(
      'Create a Paid services budget',
    )
    for (const invalid of [
      { ...grant, expires_at: new Date(now).toISOString() },
      { ...grant, revoked_at: new Date(now).toISOString() },
      { ...grant, policy: { ...grant.policy, arcade: { matchId: 'mat_1' } } },
      {
        ...grant,
        policy: { ...grant.policy, origin: 'https://other.example' },
      },
      { ...grant, policy: { ...grant.policy, network: 'unknown' } },
    ])
      expect(analysisGrantProblem(invalid, origin, now)).toBeTruthy()
  })
})
