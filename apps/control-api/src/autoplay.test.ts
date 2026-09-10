import { afterEach, expect, it, vi } from 'vitest'
import { LocalArcadePlatform } from '@common-arcade/match-worker-service'
import { createApp } from './app.js'
afterEach(() => vi.unstubAllGlobals())
it('starts an owned worker controller without network model calls and rejects other owners', async () => {
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
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw Error('No model calls in the match loop')
      }),
    )
    const run = (owner: string) =>
      app.request(
        `/v1/matches/${match.id}/seats/${match.seats[0]!.id}/autoplay`,
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer local:' + owner,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ controllerId: 'agent-' + match.seats[0]!.id }),
        },
      )
    expect((await run('intruder')).status).toBe(403)
    const response = await run('owner')
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      source: 'arcade-realtime-policy',
      status: 'applied',
    })
    expect(platform.getReplay(match.id).commands.length).toBeGreaterThan(0)
    expect(fetch).not.toHaveBeenCalled()
  } finally {
    platform.close()
  }
})
