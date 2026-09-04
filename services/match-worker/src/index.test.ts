import { describe, expect, it } from 'vitest'
import { replaySchema } from '@common-arcade/protocol'
import { LocalArcadePlatform } from './index.js'

async function setup() {
  const platform = await LocalArcadePlatform.create({
    ticketSecret: new Uint8Array(32).fill(9),
    now: () => new Date('2026-01-01T00:00:00.000Z'),
  })
  const match = await platform.createMatch({
    releaseId: 'rel_tictactoe1',
    configuration: {},
    seed: 'test-seed',
    idempotencyKey: 'match-request-one',
  })
  const [first, second] = match.seats
  if (first === undefined || second === undefined)
    throw new Error('Missing seats')
  await platform.claimSeat({
    matchId: match.id,
    seatId: first.id,
    actorId: 'actor_one',
    controllerId: 'controller_one',
  })
  await platform.claimSeat({
    matchId: match.id,
    seatId: second.id,
    actorId: 'actor_two',
    controllerId: 'controller_two',
  })
  return { platform, match, first, second }
}

describe('local match worker boundary', () => {
  it('keeps match creation idempotent', async () => {
    const { platform, match } = await setup()
    const duplicate = await platform.createMatch({
      releaseId: 'rel_tictactoe1',
      idempotencyKey: 'match-request-one',
    })
    expect(duplicate.id).toBe(match.id)
  })

  it('binds control to a one-time ticket and active lease', async () => {
    const { platform, match, first } = await setup()
    const issued = await platform.createSession({
      matchId: match.id,
      mode: 'control',
      seatId: first.id,
      actorId: 'actor_one',
      controllerId: 'controller_one',
    })
    const connected = await platform.connectWithTicket(issued.ticket, match.id)
    expect(connected.controlLease).toMatch(/^lease_/)

    await expect(
      platform.connectWithTicket(issued.ticket, match.id),
    ).rejects.toMatchObject({ code: 'TICKET_REPLAYED' })

    await expect(
      platform.submitAction(connected.sessionId, {
        actionId: 'act_wronglease',
        matchId: match.id,
        seatId: first.id,
        controlLease: 'not-the-active-control-lease',
        clientSequence: 1,
        basedOnStateSequence: 0,
        targetTurn: 1,
        payload: { type: 'place', cell: 0 },
      }),
    ).rejects.toMatchObject({ code: 'CONTROL_REVOKED' })

    const result = await platform.submitAction(connected.sessionId, {
      actionId: 'act_firstmove',
      matchId: match.id,
      seatId: first.id,
      controlLease: connected.controlLease ?? '',
      clientSequence: 1,
      basedOnStateSequence: 0,
      targetTurn: 1,
      payload: { type: 'place', cell: 0 },
    })
    expect(result.disposition).toBe('accepted')
    expect(platform.observation(connected.sessionId).stateSequence).toBe(1)
    expect(replaySchema.safeParse(platform.getReplay(match.id)).success).toBe(
      true,
    )
  })

  it('allows spectators to watch without receiving a seat projection', async () => {
    const { platform, match } = await setup()
    const issued = await platform.createSession({
      matchId: match.id,
      mode: 'spectate',
      actorId: 'actor_spectator',
    })
    const connected = await platform.connectWithTicket(issued.ticket, match.id)
    expect(connected.mode).toBe('spectate')
    expect((await platform.getMatchView(match.id)).publicState).toBeDefined()
    expect(() => platform.observation(connected.sessionId)).toThrow(
      'Spectator sessions do not receive private seat observations',
    )
  })
})
