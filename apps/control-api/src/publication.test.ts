import { expect, it } from 'vitest'
import { starterDocument } from '@common-arcade/studio'
import { LocalArcadePlatform } from '@common-arcade/match-worker-service'
import { createApp } from './app.js'
import { MemoryDocumentStore, StoreConflict } from './store.js'
import {
  publicationRecord,
  setPublication,
  type ReleaseRecord,
} from './publication.js'

const headers = {
  Authorization: 'Bearer local:owner',
  'Content-Type': 'application/json',
}
const writeHeaders = { ...headers, 'If-Match': '1' }
const document = {
  ...starterDocument,
  thumbnail: 'https://example.com/game.webp',
}
async function setup() {
  const store = new MemoryDocumentStore()
  const platform = await LocalArcadePlatform.create({
    loadRelease: async (id) =>
      (await store.get<ReleaseRecord>('releases', id))?.release,
  })
  const app = createApp({
    store,
    platform,
    allowLocalAuth: true,
    logRequests: false,
  })
  const project = await (
    await app.request('/v1/projects', {
      method: 'POST',
      headers,
      body: JSON.stringify({ document }),
    })
  ).json()
  const release = await (
    await app.request(`/v1/projects/${project.id}/publish`, {
      method: 'POST',
      headers: writeHeaders,
    })
  ).json()
  return { app, store, platform, project, release }
}

it('unpublishes every release and restores the same immutable release without deleting history', async () => {
  const { app, store, platform, project, release } = await setup()
  try {
    const before = await (
      await app.request(`/v1/projects/${project.id}`, { headers })
    ).json()
    const immutable = await store.get<ReleaseRecord>('releases', release.id)
    expect(
      (
        await (
          await app.request(`/v1/projects/${project.id}/publication`, {
            headers,
          })
        ).json()
      ).isPublished,
    ).toBe(true)
    const removed = await app.request(`/v1/projects/${project.id}/unpublish`, {
      method: 'POST',
      headers: writeHeaders,
    })
    expect(removed.status).toBe(200)
    expect(await removed.json()).toEqual({
      projectId: project.id,
      isPublished: false,
    })
    expect((await (await app.request('/v1/games')).json()).games).toEqual([])
    expect(
      (await app.request(`/v1/games/${release.manifest.metadata.id}`)).status,
    ).toBe(404)
    expect(
      (
        await (
          await app.request(
            `/v1/games/${release.manifest.metadata.id}/releases`,
          )
        ).json()
      ).releases,
    ).toEqual([])
    expect((await app.request(`/v1/releases/${release.id}`)).status).toBe(404)
    // Historical payload and frame remain available for already-pinned sessions.
    expect(
      await (await app.request(`/v1/studio/releases/${release.id}`)).json(),
    ).toEqual(release)
    expect(
      (await app.request(`/v1/studio/releases/${release.id}/preview`)).status,
    ).toBe(200)
    expect(
      await (
        await app.request(`/v1/projects/${project.id}`, { headers })
      ).json(),
    ).toEqual(before)
    expect(await store.get<ReleaseRecord>('releases', release.id)).toEqual(
      immutable,
    )
    expect(
      (
        await app.request(`/v1/projects/${project.id}/unpublish`, {
          method: 'POST',
          headers: writeHeaders,
        })
      ).status,
    ).toBe(200)
    const restored = await app.request(`/v1/projects/${project.id}/publish`, {
      method: 'POST',
      headers: writeHeaders,
    })
    expect(restored.status).toBe(200)
    expect(await restored.json()).toEqual(release)
    expect((await (await app.request('/v1/games')).json()).games).toHaveLength(
      1,
    )
    expect((await app.request(`/v1/releases/${release.id}`)).status).toBe(200)
    expect(await store.get<ReleaseRecord>('releases', release.id)).toEqual(
      immutable,
    )
    expect(await store.list(`revisions:${project.id}`)).toHaveLength(1)
  } finally {
    platform.close()
  }
})

it('requires owner publication scope and a current project revision', async () => {
  const { app, platform, project } = await setup()
  try {
    await app.request(`/v1/projects/${project.id}/collaborators`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        collaborators: [{ actorId: 'editor', permissions: ['edit'] }],
      }),
    })
    expect(
      (
        await app.request(`/v1/projects/${project.id}/unpublish`, {
          method: 'POST',
        })
      ).status,
    ).toBe(401)
    expect(
      (
        await app.request(`/v1/projects/${project.id}/unpublish`, {
          method: 'POST',
          headers: { ...writeHeaders, Authorization: 'Bearer local:editor' },
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await app.request(`/v1/projects/${project.id}/unpublish`, {
          method: 'POST',
          headers: { ...writeHeaders, 'If-Match': '999' },
        })
      ).status,
    ).toBe(409)
    expect(
      (
        await (
          await app.request(`/v1/projects/${project.id}/publication`, {
            headers: { Authorization: 'Bearer local:editor' },
          })
        ).json()
      ).isPublished,
    ).toBe(true)
    expect((await (await app.request('/v1/games')).json()).games).toHaveLength(
      1,
    )
  } finally {
    platform.close()
  }
})

it('blocks new sessions after unpublishing while existing players and replays continue', async () => {
  const { app, platform, project, release } = await setup()
  try {
    const match = await (
      await app.request('/v1/matches', {
        method: 'POST',
        headers: { ...headers, 'Idempotency-Key': 'before-unpublish' },
        body: JSON.stringify({ releaseId: release.id, visibility: 'public' }),
      })
    ).json()
    for (const seat of match.seats)
      await platform.claimSeat({
        matchId: match.id,
        seatId: seat.id,
        actorId: 'owner',
        controllerId: seat.id,
      })
    const seat = match.seats[0]
    const ticket = await platform.createSession({
      matchId: match.id,
      seatId: seat.id,
      actorId: 'owner',
      controllerId: seat.id,
      mode: 'control',
    })
    const session = await platform.connectWithTicket(ticket.ticket, match.id)
    await app.request(`/v1/projects/${project.id}/unpublish`, {
      method: 'POST',
      headers: writeHeaders,
    })
    for (const route of ['/v1/matches', '/v1/matchmaking']) {
      const response = await app.request(route, {
        method: 'POST',
        headers: { ...headers, 'Idempotency-Key': `after-${route}` },
        body: JSON.stringify(
          route === '/v1/matchmaking'
            ? { releaseId: release.id, controllerId: 'human' }
            : { releaseId: release.id },
        ),
      })
      expect(response.status).toBe(409)
      expect((await response.json()).code).toBe('GAME_UNPUBLISHED')
    }
    const observation = platform.observation(session.sessionId)
    const result = await platform.submitAction(session.sessionId, {
      actionId: 'act_after_unpublish',
      matchId: match.id,
      seatId: seat.id,
      controlLease: session.controlLease!,
      clientSequence: 1,
      basedOnStateSequence: observation.stateSequence,
      targetTurn: 1,
      payload: observation.legalActions[0]!,
    })
    expect(result.disposition).toBe('accepted')
    expect(platform.getReplay(match.id).commands).toHaveLength(1)
    expect((await app.request(`/v1/matches/${match.id}`)).status).toBe(200)
    expect(
      (await (await app.request('/v1/matches')).json()).matches,
    ).toHaveLength(0)
    expect(
      (await (await app.request('/v1/matches?scope=mine', { headers })).json())
        .matches,
    ).toHaveLength(1)
  } finally {
    platform.close()
  }
})

it('uses publication CAS to reject stale publish/unpublish reversals', async () => {
  const store = new MemoryDocumentStore()
  const first = await setPublication(store, 'prj_game', true, undefined)
  await setPublication(store, 'prj_game', false, first)
  await expect(
    setPublication(store, 'prj_game', true, { ...first, isPublished: false }),
  ).rejects.toBeInstanceOf(StoreConflict)
  expect((await publicationRecord(store, 'prj_game'))?.isPublished).toBe(false)
})
