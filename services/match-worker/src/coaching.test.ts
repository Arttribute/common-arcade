import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocalArcadePlatform } from './index.js'

afterEach(() => vi.useRealTimers())
async function setup() {
  const platform = await LocalArcadePlatform.create()
  const match = await platform.createMatch({
    releaseId: 'rel_tictactoe1',
    idempotencyKey: crypto.randomUUID(),
  })
  for (const [i, seat] of match.seats.entries())
    await platform.claimSeat({
      matchId: match.id,
      seatId: seat.id,
      actorId: `owner${i}`,
      controllerId: `agent${i}`,
      controllerKind: 'agent',
    })
  return { platform, match, seat: match.seats[0]! }
}
function plan(actionId: string) {
  return {
    strategy: 'Prefer this square.',
    reason: 'Owner requested a new opening.',
    executableStrategy: {
      actionWeights: { [actionId]: 100 },
      avoidActions: [],
      rules: [],
    },
  }
}
describe('live strategy replacement', () => {
  it('uses a new strategy immediately and fences the old controller', async () => {
    const { platform, match, seat } = await setup()
    const ticket = await platform.createSession({
      matchId: match.id,
      seatId: seat.id,
      actorId: 'owner0',
      controllerId: 'agent0',
      mode: 'control',
    })
    const old = await platform.connectWithTicket(ticket.ticket, match.id)
    const original = platform.observation(old.sessionId)
    const prepared = platform.beginCoaching(match.id, seat.id, 'owner0')
    const action = prepared.observation.actions.find((a) =>
      a.label.includes('"cell":4'),
    )!
    const applied = await platform.applyCoaching(
      match.id,
      seat.id,
      'owner0',
      prepared.requestId,
      'agent0',
      plan(action.id),
    )
    expect(applied.strategyEpoch).toBe(1)
    expect(applied.status).toBe('applied')
    const replay = platform.getReplay(match.id)
    expect(replay.commands.at(-1)?.action.payload).toEqual({
      type: 'place',
      cell: 4,
    })
    await expect(
      platform.submitAction(old.sessionId, {
        actionId: 'act_oldstrategy',
        matchId: match.id,
        seatId: seat.id,
        controlLease: old.controlLease!,
        clientSequence: 1,
        basedOnStateSequence: original.stateSequence,
        payload: { type: 'place', cell: 0 },
      }),
    ).rejects.toMatchObject({ code: 'CONTROL_REVOKED' })
    await platform.pauseMatch(match.id)
  })
  it('only accepts the newest coaching request and rejects another owner', async () => {
    const { platform, match, seat } = await setup()
    expect(() => platform.beginCoaching(match.id, seat.id, 'intruder')).toThrow(
      'owner',
    )
    const older = platform.beginCoaching(match.id, seat.id, 'owner0')
    const newer = platform.beginCoaching(match.id, seat.id, 'owner0')
    await expect(
      platform.applyCoaching(
        match.id,
        seat.id,
        'owner0',
        older.requestId,
        'agent0',
        plan(older.observation.actions[0]!.id),
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(platform.getReplay(match.id).commands).toHaveLength(0)
    await platform.applyCoaching(
      match.id,
      seat.id,
      'owner0',
      newer.requestId,
      'agent0',
      plan(newer.observation.actions[0]!.id),
    )
    expect(platform.getReplay(match.id).commands).toHaveLength(1)
    await platform.pauseMatch(match.id)
  })
})
