import { describe, expect, it } from 'vitest'
import { verifyManifestDigest } from '@common-arcade/manifest'
import { AuthoritativeMatch, verifyReplay } from '@common-arcade/match-runtime'
import type { ActionSubmission } from '@common-arcade/protocol'
import { getTicTacToeManifest, ticTacToeGame } from './index.js'

const roster = [
  { seatId: 'sea_playerone', role: 'player' },
  { seatId: 'sea_playertwo', role: 'player' },
] as const

function action(
  sequence: number,
  seatId: string,
  cell: number,
): ActionSubmission {
  return {
    actionId: `act_action${sequence.toString().padStart(3, '0')}`,
    matchId: 'mat_runtime01',
    seatId,
    controlLease: 'local-control-lease',
    clientSequence: sequence,
    basedOnStateSequence: sequence - 1,
    targetTurn: sequence,
    payload: { type: 'place', cell },
  }
}

async function match() {
  const runtime = await AuthoritativeMatch.create({
    matchId: 'mat_runtime01',
    game: ticTacToeGame,
    seed: 'seed-one',
    configuration: {},
    roster,
    now: () => new Date('2026-01-01T00:00:00.000Z'),
  })
  runtime.start()
  return runtime
}

describe('tic-tac-toe manifest', () => {
  it('is schema-ready and content-addressed', async () => {
    expect(await verifyManifestDigest(await getTicTacToeManifest())).toBe(true)
  })
})

describe('authoritative tic-tac-toe match', () => {
  it('enforces turns, deduplicates actions, and completes deterministically', async () => {
    const runtime = await match()
    const first = action(1, roster[0].seatId, 0)
    expect((await runtime.submitAction(first, 1)).disposition).toBe('accepted')
    expect((await runtime.submitAction(first, 1)).disposition).toBe('duplicate')

    const outOfTurn = {
      ...action(2, roster[0].seatId, 1),
      actionId: 'act_outofturn1',
      basedOnStateSequence: 1,
    }
    expect(await runtime.submitAction(outOfTurn, 1)).toMatchObject({
      disposition: 'rejected',
      code: 'NOT_LEGAL',
    })

    await runtime.submitAction(action(2, roster[1].seatId, 3), 1)
    await runtime.submitAction(action(3, roster[0].seatId, 1), 1)
    await runtime.submitAction(action(4, roster[1].seatId, 4), 1)
    await runtime.submitAction(action(5, roster[0].seatId, 2), 1)

    expect(await runtime.snapshot()).toMatchObject({
      status: 'completed',
      stateSequence: 5,
      result: { outcome: 'win', winnerSeatId: roster[0].seatId },
    })
    expect(runtime.eventLog().at(-1)?.type).toBe('match.completed')

    const replay = runtime.exportReplay()
    expect(await verifyReplay(ticTacToeGame, replay)).toMatchObject({
      valid: true,
      checkedCheckpoints: 6,
      mismatches: [],
    })

    const tampered = structuredClone(replay)
    const checkpoint = tampered.checkpoints[1]
    if (checkpoint === undefined) throw new Error('Expected a checkpoint')
    checkpoint.stateHash = `sha256:${'f'.repeat(64)}`
    expect(await verifyReplay(ticTacToeGame, tampered)).toMatchObject({
      valid: false,
      checkedCheckpoints: 6,
    })
  })

  it('rejects a former owner after fencing', async () => {
    const runtime = await match()
    runtime.fence(2)
    expect(
      await runtime.submitAction(action(1, roster[0].seatId, 0), 1),
    ).toMatchObject({ disposition: 'rejected', code: 'CONTROL_REVOKED' })
  })
})
