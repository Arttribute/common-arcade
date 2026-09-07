import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from './app.js'
import { createBrowserTestApi } from './browser-tests.js'
import { MemoryDocumentStore } from './store.js'
import { emptyBrowserDocument } from '@common-arcade/studio'

afterEach(() => vi.unstubAllGlobals())

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
  it('keeps distinct Commons sessions and applies coached strategy at a decision boundary', async () => {
    const store = new MemoryDocumentStore()
    const local = createApp({ store, allowLocalAuth: true, logRequests: false })
    const headers = {
      Authorization: 'Bearer local:browser_creator',
      'Content-Type': 'application/json',
    }
    const project = await (
      await local.request('/v1/projects', {
        method: 'POST',
        headers,
        body: JSON.stringify({ document: emptyBrowserDocument }),
      })
    ).json()
    let sessions = 0
    const calls: any[] = []
    vi.stubGlobal('fetch', async (input: unknown, init: RequestInit = {}) => {
      const url = String(input)
      const body = init.body ? JSON.parse(String(init.body)) : undefined
      calls.push({ url, body })
      if (url.endsWith('/v1/sessions'))
        return Response.json({ data: { sessionId: `ses_${++sessions}` } })
      if (url.endsWith('/v1/agents/run'))
        return Response.json({
          data: {
            content: JSON.stringify({
              actionId: body.messages[0].content.includes('seat-2')
                ? 'seat:seat-2:jump'
                : 'seat:seat-1:jump',
              reason: 'legal test action',
            }),
          },
        })
      return Response.json({ data: { agentId: url.split('/').at(-1) } })
    })
    const app = createBrowserTestApi(store, async () => ({
      id: 'browser_creator',
      scopes: ['projects:read', 'projects:write'],
      token: 'commons-token',
      provider: 'commons',
    }))
    const created = await app.request(
      `/v1/projects/${project.id}/browser-runs`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          controllers: [
            {
              seatId: 'seat-1',
              label: 'Red',
              kind: 'agent',
              agentId: 'agt_red',
              strategy: 'Attack.',
            },
            {
              seatId: 'seat-2',
              label: 'Blue',
              kind: 'agent',
              agentId: 'agt_blue',
              strategy: 'Defend.',
            },
          ],
        }),
      },
    )
    expect(created.status).toBe(201)
    const run = await created.json()
    expect(run.rewardEligible).toBe(false)
    expect(
      run.controllers.map((controller: any) => controller.sessionId),
    ).toEqual(['ses_1', 'ses_2'])
    const coached = await app.request(
      `/v1/studio/browser-runs/${run.id}/controllers/seat-2/strategy`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ prompt: 'Counterattack after dodging.' }),
      },
    )
    expect(coached.status).toBe(200)
    const decision = await app.request(
      `/v1/studio/browser-runs/${run.id}/decide`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          step: 0,
          seatId: 'seat-2',
          observation: {
            state: { lives: [3, 3] },
            actions: [{ id: 'seat:seat-2:jump', label: 'Blue · Jump' }],
          },
        }),
      },
    )
    expect(decision.status).toBe(200)
    const runCall = calls.find((call) => call.url.endsWith('/v1/agents/run'))
    expect(runCall.body.sessionId).toBe('ses_2')
    expect(runCall.body.messages[0].content).toContain(
      'Counterattack after dodging.',
    )
    const resumed = await (
      await app.request(`/v1/studio/browser-runs/${run.id}`, { headers })
    ).json()
    expect(resumed.events).toHaveLength(1)
    expect(resumed.strategyEvents).toHaveLength(1)
  })
})
