import { describe, expect, it } from 'vitest'
import { createApp } from './app.js'
import { MemoryDocumentStore } from './store.js'
import { emptyBrowserDocument } from '@common-arcade/studio'

describe('browser playtest decisions', () => {
  it('persists external decisions, safely retries and denies other owners', async () => {
    const store = new MemoryDocumentStore()
    const app = createApp({ store, allowLocalAuth: true, logRequests: false })
    const headers = {
      Authorization: 'Bearer local:browser_creator',
      'Content-Type': 'application/json',
    }
    const post = (path: string, body: unknown) =>
      app.request(path, { method: 'POST', headers, body: JSON.stringify(body) })
    const project = await (
      await post('/v1/projects', { document: emptyBrowserDocument })
    ).json()
    const run = await (
      await post(`/v1/projects/${project.id}/browser-runs`, {})
    ).json()
    const path = `/v1/studio/browser-runs/${run.id}/decide`
    const input = {
      step: 0,
      observation: {
        state: { score: 0 },
        actions: [{ id: 'score', label: 'Score' }],
      },
      actionId: 'score',
    }
    const response = await post(path, input)
    expect(response.status).toBe(200)
    const event = await response.json()
    expect(await (await post(path, input)).json()).toEqual(event)
    expect(
      (
        await post(path, {
          ...input,
          observation: { ...input.observation, state: { score: 1 } },
        })
      ).status,
    ).toBe(409)
    const saved = await (
      await app.request(`/v1/studio/browser-runs/${run.id}`, { headers })
    ).json()
    expect(saved.step).toBe(1)
    expect(saved.events).toHaveLength(1)
    expect(
      (
        await app.request(`/v1/studio/browser-runs/${run.id}`, {
          headers: { Authorization: 'Bearer local:different_user' },
        })
      ).status,
    ).toBe(403)
    expect(
      (await post(path, { ...input, step: 1, actionId: 'unavailable' })).status,
    ).toBeGreaterThanOrEqual(400)
    expect((await post(path, { ...input, step: 1 })).status).toBe(200)
  })
})
