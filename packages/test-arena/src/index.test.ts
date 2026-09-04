import { describe, expect, it } from 'vitest'
import { verifyReplay } from '@common-arcade/match-runtime'
import { ticTacToeGame } from '@common-arcade/example-tic-tac-toe'
import { createPreferencePolicy, TicTacToeTestRun } from './index.js'

describe('Tic-tac-toe Test Arena', () => {
  it('runs two autonomous policies and records inspectable decisions', async () => {
    const first = await createPreferencePolicy({
      id: 'pol_testplayer01',
      name: 'center-first',
      preferredCells: [4, 0, 2, 6, 8, 1, 3, 5, 7],
    })
    const second = await createPreferencePolicy({
      id: 'pol_testplayer02',
      name: 'corners-first',
      preferredCells: [0, 2, 6, 8, 4, 1, 3, 5, 7],
    })
    const run = await TicTacToeTestRun.create({
      runId: 'tst_autoplay001',
      matchId: 'mat_autoplay001',
      seed: 'arena-seed',
      controllers: [
        { seatId: 'sea_autoplayer1', policy: first },
        { seatId: 'sea_autoplayer2', policy: second },
      ],
      now: () => new Date('2026-09-04T10:00:00.000Z'),
    })

    expect((await run.step())?.result.disposition).toBe('accepted')
    const result = await run.runToCompletion()
    expect(result.status).toBe('completed')
    expect(result.steps).toBeGreaterThanOrEqual(5)
    expect(result.diagnostics.length).toBe(result.steps * 3)
    expect(
      result.diagnostics.some(
        (record) => record.type === 'policy.decision.made',
      ),
    ).toBe(true)
    expect(await verifyReplay(ticTacToeGame, result.replay)).toMatchObject({
      valid: true,
      mismatches: [],
    })
  })
})
