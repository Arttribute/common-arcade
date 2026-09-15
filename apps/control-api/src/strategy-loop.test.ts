import { afterEach, expect, it, vi } from 'vitest'
import { LocalArcadePlatform } from '@common-arcade/match-worker-service'
import { createApp } from './app.js'

afterEach(() => vi.unstubAllGlobals())

it('lets an owned agent seat review and update its strategy, with no autoplay', async () => {
  const platform = await LocalArcadePlatform.create()
  try {
    const match = await platform.createMatch({
      releaseId: 'rel_tictactoe1',
      idempotencyKey: crypto.randomUUID(),
    })
    for (const seat of match.seats)
      await platform.claimSeat({
        matchId: match.id,
        seatId: seat.id,
        actorId: 'owner',
        controllerId: 'agent-' + seat.id,
        controllerKind: 'agent',
      })
    const app = createApp({
      platform,
      allowLocalAuth: true,
      logRequests: false,
    })
    const seat = match.seats[0]!
    const call = (
      method: string,
      path: string,
      body: unknown,
      owner = 'owner',
    ) =>
      app.request(`/v1/matches/${match.id}/seats/${seat.id}/${path}`, {
        method,
        headers: {
          Authorization: 'Bearer local:' + owner,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })
    expect((await call('POST', 'autoplay', { controllerId: 'x' })).status).toBe(
      404,
    )
    expect(
      (await call('POST', 'strategy/requests', {}, 'intruder')).status,
    ).toBe(403)

    const opened = await call('POST', 'strategy/requests', {})
    expect(opened.status).toBe(200)
    const context = await opened.json()
    expect(context).toMatchObject({ engaged: false, strategyEpoch: 0 })
    expect(context.observation.actions.length).toBeGreaterThan(0)
    expect(platform.getReplay(match.id).commands).toHaveLength(0)

    // Nothing to keep before the first strategy.
    expect(
      (
        await call('PUT', 'strategy', {
          requestId: context.requestId,
          controllerId: context.controllerId,
          update: { decision: 'keep', reason: 'Too early.' },
        })
      ).status,
    ).toBe(409)

    const next = await (await call('POST', 'strategy/requests', {})).json()
    const applied = await call('PUT', 'strategy', {
      requestId: next.requestId,
      controllerId: next.controllerId,
      update: {
        decision: 'replace',
        strategy: 'Take the centre.',
        reason: 'Centre controls the board.',
        executableStrategy: {
          actionWeights: { [next.observation.actions[0].id]: 50 },
          avoidActions: [],
          rules: [],
        },
      },
    })
    expect(applied.status).toBe(200)
    expect(await applied.json()).toMatchObject({
      status: 'applied',
      strategyEpoch: 1,
      nextReviewInMs: 0,
    })
    expect(platform.getReplay(match.id).commands).toHaveLength(1)
  } finally {
    platform.close()
  }
})
