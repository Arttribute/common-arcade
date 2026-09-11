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

async function flexibleRelease() {
  const document = gameDocumentSchema.parse({
    kind: 'browser',
    title: 'Flexible arena',
    description: 'Configurable roles and round setup.',
    entryFile: 'index.html',
    configurationSchema: {
      type: 'object',
      properties: {
        map: {
          type: 'string',
          default: 'forest',
          enum: ['forest', 'volcano'],
        },
        rounds: { type: 'integer', default: 3, minimum: 1, maximum: 9 },
      },
      required: ['map', 'rounds'],
      additionalProperties: false,
    },
    play: {
      mode: 'turn-based',
      seats: { min: 1, max: 4, default: 2 },
      roles: [
        { id: 'red', title: 'Red', count: 1, minCount: 0, maxCount: 2 },
        { id: 'blue', title: 'Blue', count: 1, minCount: 0, maxCount: 2 },
      ],
      lateJoin: true,
      maxDecisionsPerSecond: 2,
    },
    runtime: {
      kind: 'sandboxed-script',
      entryFile: 'server.js',
      tickRate: 10,
      memoryMiB: 8,
      timeoutMs: 20,
    },
    files: [
      { path: 'index.html', content: '<main>Flexible arena</main>' },
      {
        path: 'server.js',
        content:
          "globalThis.arcadeGame={initialize:c=>({done:false,configuration:c.configuration,roster:c.roster}),validateAction:()=>null,applyAction:s=>({state:{...s,done:true},events:[]}),observe:s=>({visibleState:s,legalActions:[{type:'finish'}]}),result:s=>s.done?{winnerSeatId:s.roster[0].seatId}:null};",
      },
    ],
  })
  const digest = await documentDigest(document)
  const project = {
    id: 'prj_flexible_arena',
    ownerId: 'flexible_owner',
    revision: 1,
    digest,
    document,
    annotations: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
  return {
    id: 'rel_flexible_arena',
    projectId: project.id,
    revision: 1,
    document,
    digest,
    manifest: await releaseManifest(project, 'rel_flexible_arena'),
    ownerId: project.ownerId,
    publishedAt: project.createdAt,
  }
}

describe('local match worker boundary', () => {
  it('resolves custom configuration defaults and flexible role selections', async () => {
    const release = await flexibleRelease()
    const platform = await LocalArcadePlatform.create({
      loadRelease: async (id) => (id === release.id ? release : undefined),
    })
    try {
      const match = await platform.createMatch({
        releaseId: release.id,
        roleCounts: { blue: 2, red: 1 },
        ownerId: 'host_one',
        visibility: 'public',
        idempotencyKey: 'flexible-create-one',
      })
      expect(match).toMatchObject({
        ownerId: 'host_one',
        configuration: { map: 'forest', rounds: 3 },
      })
      expect(match.seats.map((seat) => seat.role)).toEqual([
        'red',
        'blue',
        'blue',
      ])
      expect(platform.getReplay(match.id)).toMatchObject({
        configuration: { map: 'forest', rounds: 3 },
        roster: match.seats.map((seat) => ({
          seatId: seat.id,
          role: seat.role,
        })),
      })

      const joined = await platform.findOrCreateMatch({
        releaseId: release.id,
        configuration: { rounds: 3, map: 'forest' },
        roleCounts: { red: 1, blue: 2 },
        idempotencyKey: 'flexible-queue-one',
        actorId: 'queued_player',
        controllerId: 'queued_human',
        controllerKind: 'human',
      })
      expect(joined.match.id).toBe(match.id)

      await expect(
        platform.createMatch({
          releaseId: release.id,
          roleCounts: { unknown: 1 },
          idempotencyKey: 'flexible-invalid-role',
        }),
      ).rejects.toMatchObject({ status: 422, code: 'INVALID_REQUEST' })
      await expect(
        platform.createMatch({
          releaseId: release.id,
          roleCounts: { red: 0, blue: 0 },
          idempotencyKey: 'flexible-invalid-total',
        }),
      ).rejects.toMatchObject({ status: 422, code: 'INVALID_REQUEST' })
      await expect(
        platform.createMatch({
          releaseId: release.id,
          configuration: { map: 'desert' },
          idempotencyKey: 'flexible-invalid-config',
        }),
      ).rejects.toMatchObject({ status: 422, code: 'INVALID_REQUEST' })
    } finally {
      platform.close()
    }
  })

  it('applies safe owner setup overrides to only the next round', async () => {
    const release = await flexibleRelease()
    const platform = await LocalArcadePlatform.create({
      loadRelease: async (id) => (id === release.id ? release : undefined),
    })
    try {
      const match = await platform.createMatch({
        releaseId: release.id,
        roleCounts: { red: 1, blue: 2 },
        ownerId: 'series_owner',
        series: { maximumRounds: 2, restartPolicy: 'owner' },
        idempotencyKey: 'flexible-series-one',
      })
      const occupied = match.seats.find((seat) => seat.role === 'red')!
      await platform.claimSeat({
        matchId: match.id,
        seatId: occupied.id,
        actorId: 'series_owner',
        controllerId: 'owner_controller',
      })
      const ticket = await platform.createSession({
        matchId: match.id,
        mode: 'control',
        seatId: occupied.id,
        actorId: 'series_owner',
        controllerId: 'owner_controller',
      })
      const session = await platform.connectWithTicket(ticket.ticket, match.id)
      await platform.submitAction(session.sessionId, {
        actionId: 'act_finish_round_one',
        matchId: match.id,
        seatId: occupied.id,
        controlLease: session.controlLease!,
        clientSequence: 1,
        basedOnStateSequence: 0,
        payload: { type: 'finish' },
      })

      await expect(
        platform.restartRound(match.id, 'other_player', {
          configuration: { map: 'volcano', rounds: 5 },
        }),
      ).rejects.toMatchObject({ status: 403 })
      await expect(
        platform.restartRound(match.id, 'series_owner', {
          roleCounts: { red: 0, blue: 1 },
        }),
      ).rejects.toMatchObject({ status: 422 })

      const restarted = await platform.restartRound(match.id, 'series_owner', {
        configuration: { map: 'volcano', rounds: 5 },
        roleCounts: { red: 2, blue: 0 },
      })
      expect(restarted).toMatchObject({
        status: 'running',
        configuration: { map: 'volcano', rounds: 5 },
        series: { currentRound: 2, status: 'active' },
      })
      expect(restarted.seats.map((seat) => seat.role)).toEqual(['red', 'red'])
      expect(restarted.seats[0]).toMatchObject({
        id: occupied.id,
        actorId: 'series_owner',
      })
      expect(restarted.seats[1]!.id).not.toBe(occupied.id)
      expect(platform.getRoundReplay(match.id, 1)).toMatchObject({
        configuration: { map: 'forest', rounds: 3 },
        roster: expect.arrayContaining([
          expect.objectContaining({ role: 'blue' }),
        ]),
      })
      expect(platform.getReplay(match.id)).toMatchObject({
        configuration: { map: 'volcano', rounds: 5 },
        roster: [
          { seatId: occupied.id, role: 'red' },
          { seatId: restarted.seats[1]!.id, role: 'red' },
        ],
      })
    } finally {
      platform.close()
    }
  })

  it('does not remove a scored seat from an active series', async () => {
    const release = await flexibleRelease()
    const platform = await LocalArcadePlatform.create({
      loadRelease: async (id) => (id === release.id ? release : undefined),
    })
    try {
      const match = await platform.createMatch({
        releaseId: release.id,
        ownerId: 'series_owner',
        series: { maximumRounds: 2, restartPolicy: 'owner' },
        idempotencyKey: 'scored-seat-series',
      })
      const seat = match.seats.find((candidate) => candidate.role === 'red')!
      await platform.claimSeat({
        matchId: match.id,
        seatId: seat.id,
        actorId: 'series_owner',
        controllerId: 'owner_controller',
      })
      const ticket = await platform.createSession({
        matchId: match.id,
        mode: 'control',
        seatId: seat.id,
        actorId: 'series_owner',
        controllerId: 'owner_controller',
      })
      const session = await platform.connectWithTicket(ticket.ticket, match.id)
      await platform.submitAction(session.sessionId, {
        actionId: 'act_score_before_release',
        matchId: match.id,
        seatId: seat.id,
        controlLease: session.controlLease!,
        clientSequence: 1,
        basedOnStateSequence: 0,
        payload: { type: 'finish' },
      })
      await platform.releaseSeat({
        matchId: match.id,
        seatId: seat.id,
        actorId: 'series_owner',
        expectedControllerId: 'owner_controller',
      })
      await expect(
        platform.restartRound(match.id, 'series_owner', {
          roleCounts: { red: 0, blue: 1 },
        }),
      ).rejects.toThrow(/scored seats/)
    } finally {
      platform.close()
    }
  })

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

it('keeps exact seat controller identity and connection status through overlapping reconnects', async () => {
  const platform = await LocalArcadePlatform.create()
  try {
    const match = await platform.createMatch({
      releaseId: 'rel_tictactoe1',
      ownerId: 'seat_host',
      idempotencyKey: 'seat-identity-test',
    })
    const seatId = match.seats[0]!.id
    await platform.claimSeat({
      matchId: match.id,
      seatId,
      actorId: 'seat_host',
      controllerId: 'agent_one',
      controllerKind: 'agent',
    })
    const connect = async () => {
      const ticket = await platform.createSession({
        matchId: match.id,
        seatId,
        actorId: 'seat_host',
        controllerId: 'agent_one',
        mode: 'control',
      })
      return platform.connectWithTicket(ticket.ticket, match.id)
    }
    const first = await connect(),
      second = await connect()
    platform.suspendSession(first.sessionId)
    platform.disconnectSession(first.sessionId)
    expect((await platform.getMatch(match.id)).seats[0]).toMatchObject({
      id: seatId,
      controllerId: 'agent_one',
      controllerKind: 'agent',
      status: 'connected',
      joinable: false,
    })
    expect((await platform.getMatch(match.id)).seats[1]).toMatchObject({
      status: 'open',
      joinable: true,
    })
    platform.suspendSession(second.sessionId)
    expect((await platform.getMatch(match.id)).seats[0]?.status).toBe(
      'disconnected',
    )
    platform.resumeSession(second.sessionId, match.id)
    expect((await platform.getMatch(match.id)).seats[0]?.status).toBe(
      'connected',
    )
  } finally {
    platform.close()
  }
})

it('hands a running seat between controllers, revoking sessions and previously minted tickets', async () => {
  const { platform, match, first } = await setup()
  try {
    const binding = {
      matchId: match.id,
      seatId: first.id,
      actorId: 'actor_one',
      controllerId: 'controller_one',
      mode: 'control' as const,
    }
    const ticket = await platform.createSession(binding)
    const old = await platform.connectWithTicket(ticket.ticket, match.id)
    const unused = await platform.createSession(binding)
    const changed = await platform.changeSeatController({
      matchId: match.id,
      seatId: first.id,
      actorId: 'actor_one',
      expectedControllerId: 'controller_one',
      controllerId: 'agent_one',
      controllerKind: 'agent',
    })
    expect(changed.status).toBe('running')
    expect(changed.seats[0]).toMatchObject({
      controllerId: 'agent_one',
      controllerKind: 'agent',
      status: 'claimed',
    })
    expect(() => platform.observation(old.sessionId)).toThrow(
      'Session does not exist',
    )
    expect(() => platform.resumeSession(old.sessionId, match.id)).toThrow(
      'Session does not exist',
    )
    await expect(
      platform.connectWithTicket(unused.ticket, match.id),
    ).rejects.toThrow('Ticket no longer matches')
    await expect(
      platform.releaseSeat({
        matchId: match.id,
        seatId: first.id,
        actorId: 'actor_two',
        expectedControllerId: 'agent_one',
      }),
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      platform.releaseSeat({
        matchId: match.id,
        seatId: first.id,
        actorId: 'actor_one',
        expectedControllerId: 'controller_one',
      }),
    ).rejects.toMatchObject({ status: 409 })
    const reserved = await platform.createSession({
      ...binding,
      controllerId: 'agent_one',
    })
    await platform.releaseSeat({
      matchId: match.id,
      seatId: first.id,
      actorId: 'actor_one',
      expectedControllerId: 'agent_one',
    })
    expect((await platform.getMatch(match.id)).seats[0]).toMatchObject({
      status: 'open',
      joinable: true,
    })
    await platform.claimSeat({
      ...binding,
      controllerId: 'agent_one',
      controllerKind: 'agent',
    })
    await expect(
      platform.connectWithTicket(reserved.ticket, match.id),
    ).rejects.toThrow('Ticket no longer matches')
    const fresh = await platform.createSession({
      ...binding,
      controllerId: 'agent_one',
    })
    expect(
      (await platform.connectWithTicket(fresh.ticket, match.id)).seatId,
    ).toBe(first.id)
  } finally {
    platform.close()
  }
})

it('cancels a declared held action before handing its seat to another controller', async () => {
  const document = gameDocumentSchema.parse({
    kind: 'browser',
    title: 'Held input',
    description: 'Controller handoff fixture',
    entryFile: 'index.html',
    play: { mode: 'realtime', seats: { min: 1, max: 1, default: 1 } },
    runtime: {
      kind: 'sandboxed-script',
      entryFile: 'server.js',
      tickRate: 10,
      memoryMiB: 8,
      timeoutMs: 20,
    },
    files: [
      { path: 'index.html', content: '<main>Input</main>' },
      {
        path: 'server.js',
        content: `globalThis.arcadeGame={initialize:()=>({moving:false}),validateAction:()=>null,applyAction:(s,a)=>({state:{moving:a.id==='go'},events:[]}),tick:s=>({state:s,events:[]}),observe:s=>({visibleState:s,legalActions:[{id:'go',control:{mode:'hold',releaseActionId:'stop'}},{id:'stop'}]}),result:()=>null};`,
      },
    ],
  })
  const digest = await documentDigest(document)
  const project = {
    id: 'prj_heldinput',
    ownerId: 'owner',
    revision: 1,
    digest,
    document,
    annotations: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  const release = {
    id: 'rel_heldinput',
    projectId: project.id,
    revision: 1,
    document,
    digest,
    manifest: await releaseManifest(project, 'rel_heldinput'),
    ownerId: 'owner',
    publishedAt: project.createdAt,
  }
  const platform = await LocalArcadePlatform.create({
    loadRelease: async () => release,
  })
  try {
    const match = await platform.createMatch({
      releaseId: release.id,
      idempotencyKey: 'held-input-handoff',
    })
    const seatId = match.seats[0]!.id
    await platform.claimSeat({
      matchId: match.id,
      seatId,
      actorId: 'owner',
      controllerId: 'human',
    })
    const ticket = await platform.createSession({
      matchId: match.id,
      seatId,
      actorId: 'owner',
      controllerId: 'human',
      mode: 'control',
    })
    const session = await platform.connectWithTicket(ticket.ticket, match.id)
    const observation = platform.observation(session.sessionId)
    const result = await platform.submitAction(session.sessionId, {
      actionId: 'act_holdtest',
      matchId: match.id,
      seatId,
      controlLease: session.controlLease!,
      clientSequence: 1,
      basedOnStateSequence: observation.stateSequence,
      payload: { id: 'go' },
    })
    expect(result.disposition).toBe('accepted')
    expect(platform.observation(session.sessionId).visibleState).toEqual({
      moving: true,
    })
    await platform.changeSeatController({
      matchId: match.id,
      seatId,
      actorId: 'owner',
      expectedControllerId: 'human',
      controllerId: 'agent',
      controllerKind: 'agent',
    })
    expect((await platform.getMatchView(match.id)).publicState).toEqual({
      moving: false,
    })
    expect(replaySchema.safeParse(platform.getReplay(match.id)).success).toBe(
      true,
    )
  } finally {
    platform.close()
  }
})
