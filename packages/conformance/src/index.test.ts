import { describe, expect, it } from 'vitest'
import {
  getTicTacToeManifest,
  ticTacToeGame,
} from '@common-arcade/example-tic-tac-toe'
import {
  createPreferencePolicy,
  TicTacToeTestRun,
} from '@common-arcade/test-arena'
import { conformManifest, conformReplay } from './index.js'

describe('conformance harness', () => {
  it('certifies the reference manifest profiles', async () => {
    const report = await conformManifest(await getTicTacToeManifest())
    expect(report.passed).toBe(true)
    expect(report.profiles).toEqual(
      expect.arrayContaining([
        'base-v1',
        'turn-based-v1',
        'replay-v1',
        'generic-controls-v1',
        'policy-v1',
      ]),
    )
  })

  it('replays a complete reference run checkpoint-for-checkpoint', async () => {
    const policy = await createPreferencePolicy({
      id: 'pol_conformance1',
      name: 'conformance',
      preferredCells: [4, 0, 2, 6, 8, 1, 3, 5, 7],
    })
    const run = await TicTacToeTestRun.create({
      runId: 'tst_conformance1',
      matchId: 'mat_conformance1',
      seed: 'conformance-seed',
      controllers: [
        { seatId: 'sea_conformance1', policy },
        { seatId: 'sea_conformance2', policy },
      ],
    })
    const result = await run.runToCompletion()
    expect(await conformReplay(ticTacToeGame, result.replay)).toMatchObject({
      passed: true,
      checks: [
        { id: 'replay.schema', passed: true },
        { id: 'replay.determinism', passed: true },
      ],
    })
  })
})
