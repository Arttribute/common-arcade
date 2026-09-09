import { afterEach, describe, expect, it, vi } from 'vitest'
import { gameDocumentSchema, replaySchema } from '@common-arcade/protocol'
import { documentDigest, releaseManifest } from '@common-arcade/studio'
import { LocalArcadePlatform } from './index.js'

afterEach(() => vi.useRealTimers())

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
  it('hosts many independent sessions for one release and atomically fills an open lobby', async () => {
    const platform = await LocalArcadePlatform.create({
      ticketSecret: new Uint8Array(32).fill(3),
    })
    const first = await platform.createMatch({
      releaseId: 'rel_tictactoe1',
      idempotencyKey: 'independent-session-one',
      ownerId: 'host_one',
      visibility: 'public',
      series: { maximumRounds: 3, restartPolicy: 'owner' },
    })
    const second = await platform.createMatch({
      releaseId: 'rel_tictactoe1',
      idempotencyKey: 'independent-session-two',
      ownerId: 'host_two',
      visibility: 'public',
      series: { maximumRounds: 1, restartPolicy: 'owner' },
    })
    expect(first.id).not.toBe(second.id)
    expect(
      (await platform.listPublicMatches()).map((match) => match.id),
    ).toEqual([second.id, first.id])

    const [one, two] = await Promise.all([
      platform.findOrCreateMatch({
        releaseId: 'rel_tictactoe1',
        idempotencyKey: 'queue-player-one',
        actorId: 'queued_one',
        controllerId: 'human_one',
        controllerKind: 'human',
        series: { maximumRounds: 3, restartPolicy: 'owner' },
      }),
      platform.findOrCreateMatch({
        releaseId: 'rel_tictactoe1',
        idempotencyKey: 'queue-player-two',
        actorId: 'queued_two',
        controllerId: 'agent_two',
        controllerKind: 'agent',
        series: { maximumRounds: 3, restartPolicy: 'owner' },
      }),
    ])
    expect(one.match.id).toBe(first.id)
    expect(two.match.id).toBe(first.id)
    expect(two.match.status).toBe('running')
    expect(one.seatId).not.toBe(two.seatId)
    expect(two.match.seats.map((seat) => seat.controllerKind)).toEqual([
      'human',
      'agent',
    ])
  })

  it('archives rounds and permits only one restart transition under contention', async () => {
    const platform = await LocalArcadePlatform.create({
      ticketSecret: new Uint8Array(32).fill(7),
    })
    const match = await platform.createMatch({
      releaseId: 'rel_tictactoe1',
      idempotencyKey: 'two-round-series',
      ownerId: 'actor_one',
      series: { maximumRounds: 2, restartPolicy: 'owner' },
    })
    const [first, second] = match.seats
    await platform.claimSeat({
      matchId: match.id,
      seatId: first!.id,
      actorId: 'actor_one',
      controllerId: 'controller_one',
    })
    await platform.claimSeat({
      matchId: match.id,
      seatId: second!.id,
      actorId: 'actor_two',
      controllerId: 'controller_two',
    })
    const sessions = await Promise.all(
      [
        ['actor_one', 'controller_one', first!.id],
        ['actor_two', 'controller_two', second!.id],
      ].map(async ([actorId, controllerId, seatId]) => {
        const ticket = await platform.createSession({
          matchId: match.id,
          mode: 'control',
          actorId: actorId!,
          controllerId: controllerId!,
          seatId: seatId!,
        })
        return platform.connectWithTicket(ticket.ticket, match.id)
      }),
    )
    for (const [index, cell] of [0, 3, 1, 4, 2].entries()) {
      const session = sessions[index % 2]!
      await platform.submitAction(session.sessionId, {
        actionId: `act_series_${index}`,
        matchId: match.id,
        seatId: session.seatId!,
        controlLease: session.controlLease!,
        clientSequence: Math.floor(index / 2) + 1,
        basedOnStateSequence: index,
        targetTurn: index + 1,
        payload: { type: 'place', cell },
      })
    }
    expect(
      (await platform.getMatch(match.id, 'actor_one')).series,
    ).toMatchObject({
      currentRound: 1,
      status: 'awaiting-restart',
      scores: { [first!.id]: 1 },
    })
    const attempts = await Promise.allSettled([
      platform.restartRound(match.id, 'actor_one'),
      platform.restartRound(match.id, 'actor_one'),
    ])
    expect(
      attempts.filter((attempt) => attempt.status === 'fulfilled'),
    ).toHaveLength(1)
    expect(
      (await platform.getMatch(match.id, 'actor_one')).series,
    ).toMatchObject({
      currentRound: 2,
      status: 'active',
    })
    expect(platform.observation(sessions[0]!.sessionId).stateSequence).toBe(0)
    expect(
      platform.getRoundReplay(match.id, 1, 'actor_one').commands,
    ).toHaveLength(5)
  })

  it('lists only public matches and fences private rooms to their owner', async () => {
    const platform = await LocalArcadePlatform.create({
      ticketSecret: new Uint8Array(32).fill(4),
    })
    const publicMatch = await platform.createMatch({
      releaseId: 'rel_tictactoe1',
      idempotencyKey: 'public-match-one',
      ownerId: 'public_owner',
      visibility: 'public',
    })
    const privateMatch = await platform.createMatch({
      releaseId: 'rel_tictactoe1',
      idempotencyKey: 'private-match-one',
      ownerId: 'private_owner',
      visibility: 'private',
    })
    expect(
      (await platform.listPublicMatches()).map((match) => match.id),
    ).toEqual([publicMatch.id])
    await expect(
      platform.createSession({
        matchId: privateMatch.id,
        mode: 'spectate',
        actorId: 'someone_else',
      }),
    ).rejects.toMatchObject({ code: 'CONTROL_REVOKED' })
    await expect(platform.getMatch(privateMatch.id)).rejects.toMatchObject({
      code: 'CONTROL_REVOKED',
    })
    expect((await platform.getMatch(privateMatch.id, 'private_owner')).id).toBe(
      privateMatch.id,
    )
    const ticket = await platform.createSession({
      matchId: publicMatch.id,
      mode: 'spectate',
      actorId: 'viewer_one',
    })
    await platform.connectWithTicket(ticket.ticket, publicMatch.id)
    expect((await platform.getMatch(publicMatch.id)).viewerCount).toBe(1)
  })

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

  it('advances a custom non-grid game on its authoritative fixed clock', async () => {
    vi.useFakeTimers()
    const document = gameDocumentSchema.parse({
      kind: 'browser',
      title: 'Clock race',
      description: 'The first deterministic realtime worker fixture.',
      entryFile: 'index.html',
      play: {
        mode: 'realtime',
        seats: { min: 2, max: 2, default: 2 },
        maxDecisionsPerSecond: 10,
      },
      runtime: {
        kind: 'sandboxed-script',
        entryFile: 'server.js',
        tickRate: 20,
        memoryMiB: 8,
        timeoutMs: 20,
      },
      files: [
        { path: 'index.html', content: '<main>Clock race</main>' },
        {
          path: 'server.js',
          content:
            'globalThis.arcadeGame={initialize:c=>({ticks:0,roster:c.roster}),validateAction:()=>null,applyAction:s=>({state:s,events:[]}),tick:s=>({state:{...s,ticks:s.ticks+1},events:[]}),observe:s=>({visibleState:s,legalActions:[]}),result:s=>s.ticks>=2?{winnerSeatId:s.roster[0].seatId}:null};',
        },
      ],
    })
    const digest = await documentDigest(document)
    const project = {
      id: 'prj_clock_race',
      ownerId: 'clock_owner',
      revision: 1,
      digest,
      document,
      annotations: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    const release = {
      id: 'rel_clock_race',
      projectId: project.id,
      revision: 1,
      document,
      digest,
      manifest: await releaseManifest(project, 'rel_clock_race'),
      ownerId: project.ownerId,
      publishedAt: '2026-01-01T00:00:00.000Z',
    }
    const platform = await LocalArcadePlatform.create({
      ticketSecret: new Uint8Array(32).fill(5),
      loadRelease: async (id) => (id === release.id ? release : undefined),
    })
    const match = await platform.createMatch({
      releaseId: release.id,
      idempotencyKey: 'clock-race-match',
    })
    for (const [index, seat] of match.seats.entries())
      await platform.claimSeat({
        matchId: match.id,
        seatId: seat.id,
        actorId: `clock_actor_${index}`,
        controllerId: `clock_controller_${index}`,
      })
    await vi.runAllTimersAsync()
    expect((await platform.getMatch(match.id)).status).toBe('completed')
    expect(
      platform.getReplay(match.id).timeline?.map((step) => step.kind),
    ).toEqual(['tick', 'tick'])
  })
})

describe('durable match recovery', () => {
  it('recovers a match, increments ownership and fences the former worker before acknowledgement', async () => {
    let saved: import('./index.js').PersistedMatch | undefined
    const persistMatch = async (
      record: import('./index.js').PersistedMatch,
      expected?: number,
    ) => {
      if (saved?.version !== expected) throw new Error('ownership-conflict')
      saved = structuredClone(record)
    }
    const first = await LocalArcadePlatform.create({ persistMatch })
    const match = await first.createMatch({
      releaseId: 'rel_tictactoe1',
      idempotencyKey: 'durable-one',
    })
    for (const [i, seat] of match.seats.entries())
      await first.claimSeat({
        matchId: match.id,
        seatId: seat.id,
        actorId: `actor_${i}`,
        controllerId: `controller_${i}`,
      })
    const seat = match.seats[0]!
    const ticket = await first.createSession({
      matchId: match.id,
      mode: 'control',
      seatId: seat.id,
      actorId: 'actor_0',
      controllerId: 'controller_0',
    })
    const session = await first.connectWithTicket(ticket.ticket, match.id)
    const second = await LocalArcadePlatform.create({
      persistMatch,
      savedMatches: [saved!],
    })
    expect((await second.getMatch(match.id)).ownershipEpoch).toBe(2)
    expect(second.getReplay(match.id).finalStateHash).toBe(
      first.getReplay(match.id).finalStateHash,
    )
    await expect(
      first.submitAction(session.sessionId, {
        actionId: 'act_oldowner',
        matchId: match.id,
        seatId: seat.id,
        controlLease: session.controlLease!,
        clientSequence: 1,
        basedOnStateSequence: 0,
        targetTurn: 1,
        payload: { type: 'place', cell: 0 },
      }),
    ).rejects.toThrow('ownership-conflict')
    expect((await second.getMatch(match.id)).stateSequence).toBe(0)
    expect(saved?.replay.commands).toHaveLength(0)
  })
})

it('bounds concurrent creation and allows owners to abandon matches', async () => {
  const platform = await LocalArcadePlatform.create()
  const results = await Promise.allSettled(
    Array.from({ length: 6 }, (_, index) =>
      platform.createMatch({
        releaseId: 'rel_tictactoe1',
        ownerId: 'limited_owner',
        idempotencyKey: `capacity-test-${index}`,
      }),
    ),
  )
  expect(
    results.filter((result) => result.status === 'fulfilled'),
  ).toHaveLength(4)
  const first = results.find((result) => result.status === 'fulfilled')!
  if (first.status !== 'fulfilled') throw new Error('Missing match')
  await expect(
    platform.abandonMatch(first.value.id, 'someone_else'),
  ).rejects.toThrow('owner')
  expect(
    (await platform.abandonMatch(first.value.id, 'limited_owner')).status,
  ).toBe('canceled')
  expect(
    (
      await platform.createMatch({
        releaseId: 'rel_tictactoe1',
        ownerId: 'limited_owner',
        idempotencyKey: 'capacity-after-end',
      })
    ).status,
  ).toBe('lobby')
  platform.close()
})

it('expires unattended lobbies without making their descriptors disappear', async () => {
  vi.useFakeTimers()
  const platform = await LocalArcadePlatform.create()
  const match = await platform.createMatch({
    releaseId: 'rel_tictactoe1',
    ownerId: 'idle_owner',
    idempotencyKey: 'idle-lobby-test',
  })
  await vi.advanceTimersByTimeAsync(305_000)
  expect((await platform.getMatch(match.id)).status).toBe('expired')
  platform.close()
})

it('quarantines an unavailable release without preventing other matches from recovering', async () => {
  let saved: import('./index.js').PersistedMatch | undefined
  const platform = await LocalArcadePlatform.create({
    persistMatch: async (record) => {
      saved = structuredClone(record)
    },
  })
  const match = await platform.createMatch({
    releaseId: 'rel_tictactoe1',
    idempotencyKey: 'healthy-recovery-test',
  })
  const damaged = structuredClone(saved!)
  damaged.replay.matchId = 'mat_unavailable'
  damaged.replay.releaseId = 'rel_unavailable'
  const recovered = await LocalArcadePlatform.create({
    savedMatches: [damaged, saved!],
  })
  expect((await recovered.getMatch(match.id)).status).toBe('lobby')
  platform.close()
  recovered.close()
})
