import { describe, expect, it } from 'vitest'
import { createApp } from './app.js'
import { MemoryDocumentStore } from './store.js'
import { starterDocument } from '@common-arcade/studio'

describe('hosted Studio boundary', () => {
  const headers = {
    Authorization: 'Bearer local:creator_one',
    'Content-Type': 'application/json',
  }
  const setup = () => {
    const store = new MemoryDocumentStore()
    return {
      store,
      app: createApp({ store, allowLocalAuth: true, logRequests: false }),
    }
  }
  it('rejects local identity tokens in a hosted deployment', async () => {
    const app = createApp({ allowLocalAuth: false, logRequests: false })
    expect((await app.request('/v1/projects', { headers })).status).toBe(401)
  })
  it('persists revisions across application instances and rejects stale saves', async () => {
    const { app, store } = setup()
    const created = await app.request('/v1/projects', {
      method: 'POST',
      headers,
      body: '{}',
    })
    expect(created.status).toBe(201)
    const p = await created.json()
    const other = createApp({ store, allowLocalAuth: true, logRequests: false })
    expect(
      (await other.request(`/v1/projects/${p.id}`, { headers })).status,
    ).toBe(200)
    const options = {
      method: 'PUT',
      headers: { ...headers, 'If-Match': '1' },
      body: JSON.stringify({ ...starterDocument, title: 'Revised game' }),
    }
    expect((await other.request(`/v1/projects/${p.id}`, options)).status).toBe(
      200,
    )
    expect((await app.request(`/v1/projects/${p.id}`, options)).status).toBe(
      409,
    )
    expect(
      (
        await app.request(`/v1/projects/${p.id}`, {
          headers: { Authorization: 'Bearer local:other_user' },
        })
      ).status,
    ).toBe(403)
  })
  it('publishes an immutable game discoverable to unauthenticated clients', async () => {
    const { app } = setup()
    const p = await (
      await app.request('/v1/projects', { method: 'POST', headers, body: '{}' })
    ).json()
    const publish = () =>
      app.request(`/v1/projects/${p.id}/publish`, {
        method: 'POST',
        headers: { ...headers, 'If-Match': '1' },
        body: '{}',
      })
    const response = await publish()
    expect(response.status).toBe(201)
    const release = await response.json()
    expect((await (await publish()).json()).id).toBe(release.id)
    const catalog = await (await app.request('/v1/games')).json()
    expect(
      catalog.games.some(
        (g: { metadata: { title: string } }) =>
          g.metadata.title === starterDocument.title,
      ),
    ).toBe(true)
    expect(
      (
        await app.request(`/v1/studio/releases/${release.id}/preview`)
      ).headers.get('content-security-policy'),
    ).toContain('sandbox allow-scripts')
  })
  it('binds annotations to exact revisions and keeps them private', async () => {
    const { app } = setup()
    const p = await (
      await app.request('/v1/projects', { method: 'POST', headers, body: '{}' })
    ).json()
    const request = (revision: number) =>
      app.request(`/v1/projects/${p.id}/annotations`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          body: 'Change this cell',
          revision,
          x: 0.3,
          y: 0.4,
        }),
      })
    expect((await request(2)).status).toBe(409)
    const saved = await (await request(1)).json()
    expect(saved.annotations[0].digest).toBe(p.digest)
  })
  it('steps a pinned test after process replacement and prevents duplicate advancement', async () => {
    const { app, store } = setup()
    const p = await (
      await app.request('/v1/projects', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          document: { ...starterDocument, boardSize: 4, winLength: 4 },
        }),
      })
    ).json()
    const created = await app.request(`/v1/projects/${p.id}/runs`, {
      method: 'POST',
      headers,
      body: '{}',
    })
    expect(created.status).toBe(201)
    const run = await created.json()
    const other = createApp({ store, allowLocalAuth: true, logRequests: false })
    const step = () =>
      other.request(`/v1/studio/runs/${run.runId}/step`, {
        method: 'POST',
        headers,
        body: '{"steps":0}',
      })
    const result = await step()
    expect(result.status).toBe(200)
    const advanced = await result.json()
    expect(advanced.steps).toBe(1)
    expect(advanced.diagnostics).toHaveLength(3)
    expect((await step()).status).toBe(409)
    expect(
      (
        await (
          await app.request(`/v1/studio/runs/${run.runId}`, { headers })
        ).json()
      ).replay,
    ).toEqual(advanced.replay)
  })
  it('enforces key scopes, prevents key escalation and supports immediate revocation', async () => {
    const { app } = setup()
    const created = await app.request('/v1/access-keys', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'Terminal agent',
        scopes: ['projects:read'],
      }),
    })
    expect(created.status).toBe(201)
    const key = await created.json()
    const keyHeaders = { ...headers, Authorization: `Bearer ${key.token}` }
    expect(
      (await app.request('/v1/projects', { headers: keyHeaders })).status,
    ).toBe(200)
    expect(
      (
        await app.request('/v1/projects', {
          method: 'POST',
          headers: keyHeaders,
          body: '{}',
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await app.request('/v1/access-keys', {
          method: 'POST',
          headers: keyHeaders,
          body: '{}',
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await app.request(`/v1/access-keys/${key.id}`, {
          method: 'DELETE',
          headers,
        })
      ).status,
    ).toBe(200)
    expect(
      (await app.request('/v1/projects', { headers: keyHeaders })).status,
    ).toBe(401)
  })
})
