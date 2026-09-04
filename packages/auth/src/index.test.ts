import { describe, expect, it } from 'vitest'
import {
  LocalRealtimeTicketAuthority,
  hasScope,
  principalEnvelopeSchema,
} from './index.js'

const request = {
  mode: 'control' as const,
  matchId: 'mat_abcdefgh',
  seatId: 'sea_abcdefgh',
  sessionId: 'ses_abcdefgh',
  actorId: 'actor_alice',
  controllerId: 'controller_browser',
  scopes: ['seats:control:mat_abcdefgh:sea_abcdefgh'],
}

async function authority(now: () => number = () => 1_800_000_000_000) {
  return LocalRealtimeTicketAuthority.create(new Uint8Array(32).fill(7), {
    now,
  })
}

describe('principal capabilities', () => {
  it('normalizes and checks exact least-privilege scopes', () => {
    const principal = principalEnvelopeSchema.parse({
      issuer: 'https://accounts.agentcommons.io',
      subject: 'usr_alice',
      actorType: 'human',
      actorChain: ['workspace_one', 'usr_alice'],
      authenticationStrength: 'mfa',
      scopes: ['matches:create'],
      audience: 'common-arcade-control',
      issuedAt: 100,
      expiresAt: 200,
      tokenId: 'token_12345678',
      traceId: 'trace_one',
    })
    expect(hasScope(principal, 'matches:create')).toBe(true)
    expect(hasScope(principal, 'matches:read')).toBe(false)
  })
})

describe('local one-time realtime tickets', () => {
  it('binds a short-lived ticket to one match and seat', async () => {
    const tickets = await authority()
    const token = await tickets.mint(request)
    const claims = await tickets.redeem(token, {
      audience: 'arcade-realtime',
      matchId: request.matchId,
      seatId: request.seatId,
    })
    expect(claims.actorId).toBe('actor_alice')
  })

  it('rejects replay of a consumed ticket', async () => {
    const tickets = await authority()
    const token = await tickets.mint(request)
    await tickets.redeem(token, { audience: 'arcade-realtime' })
    await expect(
      tickets.redeem(token, { audience: 'arcade-realtime' }),
    ).rejects.toMatchObject({
      code: 'TICKET_REPLAYED',
    })
  })

  it('rejects tampering and expiry', async () => {
    let now = 1_800_000_000_000
    const tickets = await authority(() => now)
    const token = await tickets.mint({ ...request, ttlSeconds: 1 })
    await expect(
      tickets.redeem(`${token.slice(0, -1)}x`, {
        audience: 'arcade-realtime',
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_TICKET',
    })

    now += 2_000
    await expect(
      tickets.redeem(token, { audience: 'arcade-realtime' }),
    ).rejects.toMatchObject({
      code: 'EXPIRED_TICKET',
    })
  })
})
