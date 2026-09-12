import { createHash } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { LocalArcadePlatform, type PersistedMatch } from './index.js'

beforeEach(() => {
  vi.useFakeTimers()
  // Keep cryptographic results deterministic under virtual timer advancement.
  vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (_, data) => {
    const bytes = ArrayBuffer.isView(data)
      ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
      : new Uint8Array(data)
    return Uint8Array.from(createHash('sha256').update(bytes).digest()).buffer
  })
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function agentSeries(restartPolicy: 'owner' | 'automatic') {
  const platform = await LocalArcadePlatform.create()
  const match = await platform.createMatch({
    releaseId: 'rel_tictactoe1',
    idempotencyKey: `series-${restartPolicy}`,
    ownerId: 'owner',
    series: { maximumRounds: 3, restartPolicy },
  })
  for (const seat of match.seats)
    await platform.claimSeat({
      matchId: match.id,
      seatId: seat.id,
      actorId: 'owner',
      controllerId: seat.id,
      controllerKind: 'agent',
    })
  for (const seat of match.seats) {
    const pending = platform.beginCoaching(match.id, seat.id, 'owner')
    await platform.applyCoaching(
      match.id,
      seat.id,
      'owner',
      pending.requestId,
      seat.id,
      {
        strategy: 'Play every round',
        reason: 'Keep the same agent throughout the series',
        executableStrategy: { actionWeights: {}, avoidActions: [], rules: [] },
      },
    )
  }
  return { platform, match }
}

it('keeps coached agents playing all configured automatic rounds with archived results', async () => {
  const { platform, match } = await agentSeries('automatic')
  try {
    await vi.advanceTimersByTimeAsync(20_000)
    expect((await platform.getMatch(match.id)).series).toMatchObject({
      currentRound: 3,
      status: 'complete',
    })
    for (const round of [1, 2, 3]) {
      const replay = platform.getRoundReplay(match.id, round)
      expect(replay.commands.length).toBeGreaterThanOrEqual(5)
      expect(
        replay.events.some((event) => event.type === 'match.completed'),
      ).toBe(true)
    }
  } finally {
    platform.close()
  }
})

it('resumes coached agents after an owner waits between rounds and restarts maintenance', async () => {
  const { platform, match } = await agentSeries('owner')
  try {
    await vi.advanceTimersByTimeAsync(20_000)
    expect((await platform.getMatch(match.id)).series?.status).toBe(
      'awaiting-restart',
    )
    await vi.advanceTimersByTimeAsync(30_000)
    await platform.restartRound(match.id, 'owner')
    await vi.advanceTimersByTimeAsync(20_000)
    expect((await platform.getMatch(match.id)).series).toMatchObject({
      currentRound: 2,
      status: 'awaiting-restart',
    })
    expect(
      platform.getRoundReplay(match.id, 1).commands.length,
    ).toBeGreaterThanOrEqual(5)
    // Round three starts with existing controllers; pausing leaves maintenance
    // responsible for expiring it after both controllers disconnect.
    await platform.restartRound(match.id, 'owner')
    for (const seat of match.seats)
      await platform.changeSeatController({
        matchId: match.id,
        seatId: seat.id,
        actorId: 'owner',
        expectedControllerId: seat.id,
        controllerId: `human-${seat.id}`,
        controllerKind: 'human',
      })
    await platform.pauseMatch(match.id)
    await vi.advanceTimersByTimeAsync(65_000)
    expect((await platform.getMatch(match.id)).status).toBe('expired')
  } finally {
    platform.close()
  }
})

it('budgets active play independently of lobby and paused wall time and persists it', async () => {
  let saved: PersistedMatch | undefined
  const persistMatch = async (record: PersistedMatch) => {
    saved = structuredClone(record)
  }
  const original = await LocalArcadePlatform.create({ persistMatch })
  const match = await original.createMatch({
    releaseId: 'rel_tictactoe1',
    idempotencyKey: 'active-time',
  })
  original.close()
  saved!.manifest.spec.clock.maxDurationSeconds = 10
  const platform = await LocalArcadePlatform.create({
    savedMatches: [saved!],
    persistMatch,
  })
  try {
    await vi.advanceTimersByTimeAsync(25_000)
    expect((await platform.getMatch(match.id)).status).toBe('lobby')
    for (const seat of match.seats) {
      await platform.claimSeat({
        matchId: match.id,
        seatId: seat.id,
        actorId: seat.id,
        controllerId: seat.id,
      })
      const ticket = await platform.createSession({
        matchId: match.id,
        seatId: seat.id,
        actorId: seat.id,
        controllerId: seat.id,
        mode: 'control',
      })
      await platform.connectWithTicket(ticket.ticket, match.id)
    }
    await vi.advanceTimersByTimeAsync(2_000)
    await platform.pauseMatch(match.id)
    await vi.advanceTimersByTimeAsync(25_000)
    expect((await platform.getMatch(match.id)).status).toBe('paused')
    await platform.resumeMatch(match.id)
    await vi.advanceTimersByTimeAsync(3_000)
    expect((await platform.getMatch(match.id)).status).toBe('running')
    await vi.advanceTimersByTimeAsync(10_000)
    expect((await platform.getMatch(match.id)).status).toBe('expired')
    expect(saved!.activeDurationMs).toBeGreaterThanOrEqual(10_000)
    expect(saved!.activeDurationMs).toBeLessThan(15_001)
  } finally {
    platform.close()
  }
})
