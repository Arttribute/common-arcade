import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocalArcadePlatform } from './index.js'

afterEach(() => vi.useRealTimers())

async function setup() {
  vi.useFakeTimers()
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
  const [first, second] = match.seats as [
    (typeof match.seats)[number],
    (typeof match.seats)[number],
  ]
  const commands = () => platform.getReplay(match.id).commands.length
  const replace = async (index: 0 | 1) => {
    const seat = index === 0 ? first : second
    const context = platform.beginStrategyUpdate(
      match.id,
      seat.id,
      `owner${index}`,
    )
    return platform.applyStrategyUpdate(
      match.id,
      seat.id,
      `owner${index}`,
      context.requestId,
      `agent${index}`,
      {
        decision: 'replace',
        strategy: 'Take any open square.',
        reason: 'Opening plan.',
        executableStrategy: { actionWeights: {}, avoidActions: [], rules: [] },
      },
    )
  }
  return { platform, match, first, second, commands, replace }
}

describe('engaged agent strategy loop', () => {
  it('never plays for an agent seat that has not supplied a strategy', async () => {
    const { platform, commands, replace } = await setup()
    try {
      await vi.advanceTimersByTimeAsync(5_000)
      expect(commands()).toBe(0)
      await replace(0)
      await vi.advanceTimersByTimeAsync(5_000)
      // The second seat has not engaged, so the game waits on its turn.
      expect(commands()).toBe(1)
    } finally {
      platform.close()
    }
  })

  it('stops executing when the agent stops reviewing, and resumes on keep', async () => {
    const { platform, match, first, commands, replace } = await setup()
    try {
      await replace(0)
      expect(commands()).toBe(1)
      await vi.advanceTimersByTimeAsync(61_000)
      await replace(1)
      await vi.advanceTimersByTimeAsync(2_000)
      expect(commands()).toBe(2)
      const context = platform.beginStrategyUpdate(match.id, first.id, 'owner0')
      expect(context.engaged).toBe(false)
      expect(context.performance.decisions).toBeGreaterThan(0)
      const kept = await platform.applyStrategyUpdate(
        match.id,
        first.id,
        'owner0',
        context.requestId,
        'agent0',
        { decision: 'keep', reason: 'The opening is working.' },
      )
      expect(kept).toMatchObject({ status: 'kept', strategyEpoch: 1 })
      // The first seat moves at once; the still-engaged opponent answers.
      expect(commands()).toBe(4)
    } finally {
      platform.close()
    }
  })

  it('holds a turn-based move while its review is planning, bounded by the turn clock', async () => {
    const { platform, match, first, commands, replace } = await setup()
    try {
      await replace(0)
      // Open the next review while the opponent is still thinking.
      const pending = platform.beginStrategyUpdate(match.id, first.id, 'owner0')
      await replace(1)
      await vi.advanceTimersByTimeAsync(5_000)
      expect(commands()).toBe(2)
      await platform.applyStrategyUpdate(
        match.id,
        first.id,
        'owner0',
        pending.requestId,
        'agent0',
        { decision: 'keep', reason: 'Still good.' },
      )
      expect(commands()).toBe(4)

      // A review that never finishes cannot forfeit the turn: the standing
      // strategy plays shortly before the 30 s turn clock runs out.
      platform.beginStrategyUpdate(match.id, first.id, 'owner0')
      await vi.advanceTimersByTimeAsync(20_000)
      expect(commands()).toBe(4)
      await vi.advanceTimersByTimeAsync(10_000)
      expect(commands()).toBeGreaterThanOrEqual(5)
    } finally {
      platform.close()
    }
  })

  it('waits for the seat decision point and reports the previous epoch', async () => {
    const { platform, match, first, replace } = await setup()
    try {
      await replace(0)
      let context: Awaited<
        ReturnType<typeof platform.prepareStrategyUpdate>
      > | null = null
      const waiting = platform
        .prepareStrategyUpdate(match.id, first.id, 'owner0', {
          waitForDecisionPoint: true,
        })
        .then((value) => {
          context = value
        })
      await vi.advanceTimersByTimeAsync(1_000)
      expect(context).toBeNull()
      await replace(1)
      await vi.advanceTimersByTimeAsync(200)
      await waiting
      expect(context!.decisionPoint.ready).toBe(true)
      expect(context!.cadence.refreshMs).toBeGreaterThan(0)
      const applied = await platform.applyStrategyUpdate(
        match.id,
        first.id,
        'owner0',
        context!.requestId,
        'agent0',
        {
          decision: 'replace',
          strategy: 'Take the centre when open.',
          reason: 'Adjusting after the opening.',
          executableStrategy: {
            actionWeights: {},
            avoidActions: [],
            rules: [],
          },
        },
      )
      expect(applied).toMatchObject({ strategyEpoch: 2, nextReviewInMs: 0 })
      const next = platform.beginStrategyUpdate(match.id, first.id, 'owner0')
      expect(next.history).toMatchObject([
        { strategyEpoch: 1, reason: 'Opening plan.' },
      ])
    } finally {
      platform.close()
    }
  })
})
