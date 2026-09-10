import { afterEach, expect, it, vi } from 'vitest'
import { gameDocumentSchema } from '@common-arcade/protocol'
import { documentDigest, releaseManifest } from '@common-arcade/studio'
import { LocalArcadePlatform } from './index.js'

afterEach(() => vi.useRealTimers())
it('bounds agent work behind slow storage so human inputs and fixed ticks keep progressing', async () => {
  const document = gameDocumentSchema.parse({
    kind: 'browser',
    title: 'Scheduling fixture',
    description: 'Exercise both controls under slow persistence.',
    entryFile: 'index.html',
    play: {
      mode: 'realtime',
      seats: { min: 2, max: 2, default: 2 },
      maxDecisionsPerSecond: 20,
    },
    runtime: { kind: 'sandboxed-script', entryFile: 'rules.js', tickRate: 30 },
    files: [
      { path: 'index.html', content: '<main>Scheduling</main>' },
      {
        path: 'rules.js',
        content: `globalThis.arcadeGame={
      initialize:()=>({elapsed:0,actions:0}),
      observe:s=>({visibleState:s,legalActions:[{id:'act'}]}),
      validateAction:()=>null,
      applyAction:s=>({state:{...s,actions:s.actions+1},events:[]}),
      tick:(s,c)=>({state:{...s,elapsed:s.elapsed+c.deltaMs},events:[]}),
      result:()=>null
    };`,
      },
    ],
  })
  const digest = await documentDigest(document)
  const project = {
    id: 'prj_schedule',
    ownerId: 'owner',
    revision: 1,
    document,
    digest,
    annotations: [],
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  }
  const release = {
    id: 'rel_schedule',
    projectId: project.id,
    revision: 1,
    document,
    digest,
    manifest: await releaseManifest(project, 'rel_schedule'),
    ownerId: 'owner',
    publishedAt: project.createdAt,
  }
  vi.useFakeTimers()
  let slow = false
  const platform = await LocalArcadePlatform.create({
    loadRelease: async () => release,
    persistMatch: async () => {
      if (slow) await new Promise((resolve) => setTimeout(resolve, 75))
    },
  })
  try {
    const match = await platform.createMatch({
      releaseId: release.id,
      idempotencyKey: 'slow-storage',
    })
    const [human, agent] = match.seats
    for (const seat of match.seats)
      await platform.claimSeat({
        matchId: match.id,
        seatId: seat.id,
        actorId: 'owner',
        controllerId: seat.id,
        controllerKind: seat.id === agent!.id ? 'agent' : 'human',
      })
    const ticket = await platform.createSession({
      matchId: match.id,
      seatId: human!.id,
      actorId: 'owner',
      controllerId: human!.id,
      mode: 'control',
    })
    const session = await platform.connectWithTicket(ticket.ticket, match.id)
    const plan = platform.beginCoaching(match.id, agent!.id, 'owner')
    await platform.applyCoaching(
      match.id,
      agent!.id,
      'owner',
      plan.requestId,
      agent!.id,
      {
        strategy: 'Act',
        reason: 'Exercise scheduling',
        executableStrategy: { actionWeights: {}, avoidActions: [], rules: [] },
      },
    )
    slow = true
    await vi.advanceTimersByTimeAsync(1000)
    const observation = platform.observation(session.sessionId)
    let result: { disposition: string } | undefined
    const pending = platform
      .submitAction(session.sessionId, {
        actionId: 'act_human',
        matchId: match.id,
        seatId: human!.id,
        controlLease: session.controlLease!,
        clientSequence: 1,
        basedOnStateSequence: observation.stateSequence,
        payload: { id: 'act' },
      })
      .then((value) => {
        result = value
      })
    await vi.advanceTimersByTimeAsync(500)
    expect(result?.disposition).toBe('accepted')
    expect(
      (
        platform.observation(session.sessionId).visibleState as {
          elapsed: number
        }
      ).elapsed,
    ).toBeGreaterThanOrEqual(1100)
    await pending
  } finally {
    platform.close()
    await vi.advanceTimersByTimeAsync(500)
  }
})
