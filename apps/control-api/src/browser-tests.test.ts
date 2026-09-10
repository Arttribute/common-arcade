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
      if (url.endsWith('/v1/agents/run/stream'))
        return new Response(
          `data: ${JSON.stringify({
            type: 'token',
            phase: 'final_answer',
            content: JSON.stringify({
              actionId: body.messages[0].content.includes('seat-2')
                ? 'seat:seat-2:jump'
                : 'seat:seat-1:jump',
              reason: 'legal test action',
            }),
          })}\n\ndata: ${JSON.stringify({ type: 'final' })}\n\n`,
          { headers: { 'Content-Type': 'text/event-stream' } },
        )
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
    const runCall = calls.find((call) =>
      call.url.endsWith('/v1/agents/run/stream'),
    )
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
  it('keeps a live run moving with a legal action during a transient Commons 502', async () => {
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
    vi.stubGlobal('fetch', async (input: unknown) => {
      const url = String(input)
      if (url.endsWith('/v1/sessions'))
        return Response.json({ data: { sessionId: 'ses_resilient' } })
      if (url.endsWith('/v1/agents/run/stream'))
        return new Response('<html><h1>502 Bad Gateway</h1></html>', {
          status: 502,
        })
      return Response.json({ data: { agentId: 'agt_resilient' } })
    })
    const app = createBrowserTestApi(store, async () => ({
      id: 'browser_creator',
      scopes: ['projects:read', 'projects:write'],
      token: 'commons-token',
      provider: 'commons',
    }))
    const run = await (
      await app.request(`/v1/projects/${project.id}/browser-runs`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          controllers: [
            {
              seatId: 'seat-1',
              label: 'Red',
              kind: 'agent',
              agentId: 'agt_resilient',
              strategy: 'Keep attacking.',
            },
          ],
        }),
      })
    ).json()
    const response = await app.request(
      `/v1/studio/browser-runs/${run.id}/decide`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          step: 0,
          seatId: 'seat-1',
          observation: {
            state: { lives: [3, 3] },
            actions: [
              { id: 'idle', label: 'Idle' },
              { id: 'restart', label: 'Restart duel' },
              { id: 'fire', label: 'Fire' },
              { id: 'duck', label: 'Duck' },
            ],
          },
        }),
      },
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      decision: { actionId: 'fire' },
      decisionSource: 'arcade-fallback',
    })
    expect(
      await (
        await app.request(`/v1/studio/browser-runs/${run.id}`, { headers })
      ).json(),
    ).toMatchObject({ step: 1 })
  })

  it('uses current threat timing and measured feedback for a fast adaptive realtime policy', async () => {
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
    vi.stubGlobal('fetch', async (input: unknown) => {
      const url = String(input)
      if (url.endsWith('/v1/sessions'))
        return Response.json({ data: { sessionId: 'ses_fast_policy' } })
      return Response.json({ data: { agentId: 'agt_fast_policy' } })
    })
    const app = createBrowserTestApi(store, async () => ({
      id: 'browser_creator',
      scopes: ['projects:read', 'projects:write'],
      token: 'commons-token',
      provider: 'commons',
    }))
    const run = await (
      await app.request(`/v1/projects/${project.id}/browser-runs`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          controllers: [
            {
              seatId: 'seat-1',
              label: 'Red',
              kind: 'agent',
              agentId: 'agt_fast_policy',
              strategy: 'Survive and counterattack.',
            },
          ],
        }),
      })
    ).json()
    const decide = (step: number, feedback?: Record<string, unknown>) =>
      app.request(`/v1/studio/browser-runs/${run.id}/decide`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          step,
          seatId: 'seat-1',
          decisionMode: 'realtime-policy',
          observation: {
            state: {
              arcadeDecisionContext: {
                incomingThreats: step === 0 ? [] : [{ timeToImpactMs: 320 }],
              },
            },
            actions: [
              { id: 'seat:seat-1:idle', label: 'Idle' },
              { id: 'seat:seat-1:jump', label: 'Jump' },
              { id: 'seat:seat-1:duck', label: 'Duck' },
              { id: 'seat:seat-1:shoot', label: 'Shoot' },
            ],
          },
          ...(feedback ? { feedback } : {}),
        }),
      })
    const first = await (await decide(0)).json()
    expect(first).toMatchObject({
      decisionSource: 'arcade-policy',
      decision: { actionId: 'seat:seat-1:shoot' },
    })
    expect(
      (
        await decide(1, {
          actionId: 'seat:seat-1:duck',
          outcome: 'positive',
          reward: 100,
          summary: 'Fabricated feedback for a different action.',
          observedAfterMs: 1,
          metrics: {},
        })
      ).status,
    ).toBe(400)
    const second = await (
      await decide(1, {
        actionId: first.decision.actionId,
        outcome: 'positive',
        reward: 1,
        summary: 'Opponent lost one life.',
        observedAfterMs: 800,
        metrics: { opponentLivesDelta: -1 },
      })
    ).json()
    expect(second.decision.reason).toContain('320 ms to impact')
    const third = await (
      await decide(2, {
        actionId: second.decision.actionId,
        outcome: 'negative',
        reward: -1,
        summary: 'Agent lost one life.',
        observedAfterMs: 900,
        metrics: { ownLivesDelta: -1 },
      })
    ).json()
    const fourth = await (
      await decide(3, {
        actionId: third.decision.actionId,
        outcome: 'positive',
        reward: 2,
        summary: 'The dodge avoided damage.',
        observedAfterMs: 900,
        metrics: { ownLivesDelta: 0 },
      })
    ).json()
    expect(fourth).toMatchObject({
      adaptation: {
        to: expect.any(String),
        strategyEpoch: 2,
        source: 'agent-self-review',
      },
      performance: {
        feedbackSamples: 3,
        cumulativeReward: 2,
        improving: true,
      },
    })
    expect(fourth.timing.decisionLatencyMs).toBeLessThan(100)
  })

  it('drives from phase, bends, traffic and road position instead of cycling controls', async () => {
    const store = new MemoryDocumentStore()
    const local = createApp({ store, allowLocalAuth: true, logRequests: false })
    const headers = {
      Authorization: 'Bearer local:racing_creator',
      'Content-Type': 'application/json',
    }
    const project = await (
      await local.request('/v1/projects', {
        method: 'POST',
        headers,
        body: JSON.stringify({ document: emptyBrowserDocument }),
      })
    ).json()
    vi.stubGlobal('fetch', async (input: unknown) => {
      const url = String(input)
      if (url.endsWith('/v1/sessions'))
        return Response.json({ data: { sessionId: 'ses_racing_policy' } })
      return Response.json({ data: { agentId: 'agt_racing_policy' } })
    })
    const app = createBrowserTestApi(store, async () => ({
      id: 'racing_creator',
      scopes: ['projects:read', 'projects:write'],
      token: 'commons-token',
      provider: 'commons',
    }))
    const run = await (
      await app.request(`/v1/projects/${project.id}/browser-runs`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          controllers: [
            {
              seatId: 'seat-1',
              label: 'Driver',
              kind: 'agent',
              agentId: 'agt_racing_policy',
              strategy: 'Race to win at competitive speed and avoid traffic.',
            },
          ],
        }),
      })
    ).json()
    const actions = [
      { id: 'seat:seat-1:accelerate', label: 'Accelerate' },
      {
        id: 'seat:seat-1:accelerateLeft',
        label: 'Accelerate and steer left',
      },
      {
        id: 'seat:seat-1:accelerateRight',
        label: 'Accelerate and steer right',
      },
      { id: 'seat:seat-1:brake', label: 'Brake' },
      { id: 'seat:seat-1:brakeLeft', label: 'Brake and steer left' },
      { id: 'seat:seat-1:brakeRight', label: 'Brake and steer right' },
      { id: 'seat:seat-1:coast', label: 'Coast' },
      { id: 'seat:seat-1:nextCar', label: 'Cycle car' },
      { id: 'seat:seat-1:lockCar', label: 'Lock in car' },
      { id: 'seat:seat-1:restart', label: 'Restart race' },
    ]
    const decide = async (
      step: number,
      state: Record<string, unknown>,
      legalActions = actions,
    ) =>
      (
        await app.request(`/v1/studio/browser-runs/${run.id}/decide`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            step,
            seatId: 'seat-1',
            decisionMode: 'realtime-policy',
            observation: { state, actions: legalActions },
          }),
        })
      ).json()

    expect((await decide(0, { phase: 'select' })).decision.actionId).toBe(
      'seat:seat-1:lockCar',
    )
    expect(
      (await decide(1, { phase: 'countdown' })).decision.actionId,
    ).toContain('accelerate')
    const straight = await decide(2, {
      phase: 'race',
      you: { speedPercent: 0.2, lanePosition: 0, offRoad: false },
      roadCurveAhead: [0, 0, 0, 0, 0],
      nearestTrafficAhead: null,
    })
    expect(straight.decision.actionId).toContain('accelerate')
    expect(straight.decision.actionId).not.toContain('brake')

    const traffic = await decide(3, {
      phase: 'race',
      you: { speedPercent: 0.45, lanePosition: -0.2, offRoad: false },
      roadCurveAhead: [0, 0, 0, 0, 0],
      nearestTrafficAhead: { gap: 200, lane: -0.45 },
    })
    expect(traffic.decision.actionId).toBe('seat:seat-1:accelerateRight')
    expect(traffic.decision.reason).toContain('avoid traffic')

    const bend = await decide(4, {
      phase: 'race',
      you: { speedPercent: 0.5, lanePosition: 0, offRoad: false },
      roadCurveAhead: [0.65, 0.7, 0.7, 0.4, 0],
      nearestTrafficAhead: null,
    })
    expect(bend.decision.actionId).toBe('seat:seat-1:accelerateRight')
    expect(bend.decision.reason).toContain('right bend')

    expect(
      (
        await decide(5, {
          phase: 'race',
          you: { speedPercent: 0.3, lanePosition: 0.9, offRoad: true },
          roadCurveAhead: [0, 0, 0, 0, 0],
          nearestTrafficAhead: null,
        })
      ).decision.actionId,
    ).toBe('seat:seat-1:accelerateLeft')

    // Braking becomes useful only when the observation justifies it.
    expect(
      (
        await decide(6, {
          phase: 'race',
          you: { speedPercent: 0.92, lanePosition: 0, offRoad: false },
          roadCurveAhead: [0.8, 0.75, 0.4, 0, 0],
          nearestTrafficAhead: null,
        })
      ).decision.actionId,
    ).toBe('seat:seat-1:brakeRight')

    const semantic = await decide(
      7,
      {
        phase: 'active',
        arcadeDecisionContext: {
          actionScores: { gatherOre: 3, buildShield: 35 },
        },
      },
      [
        { id: 'gatherOre', label: 'Gather ore' },
        { id: 'buildShield', label: 'Build shield' },
      ],
    )
    expect(semantic.decision.actionId).toBe('buildShield')
    const epoch = '123e4567-e89b-42d3-a456-426614174000'
    const sample = {
      step: 40,
      seatId: 'seat-1',
      observation: {
        state: { phase: 'active' },
        actions: [{ id: 'move', label: 'Move' }],
      },
      decision: { actionId: 'move', reason: 'Follow target' },
      timing: { decisionLatencyMs: 0.1, actionGapMs: 50 },
      decisionSource: 'preview-frame-policy',
    }
    const body = { epoch, events: [sample] }
    const saveTelemetry = (value: unknown) =>
      app.request(`/v1/studio/browser-runs/${run.id}/telemetry/${epoch}-0`, {
        method: 'POST',
        headers,
        body: JSON.stringify(value),
      })
    expect((await saveTelemetry(body)).status).toBe(200)
    expect((await saveTelemetry(body)).status).toBe(200)
    expect(
      (
        await saveTelemetry({
          ...body,
          events: [{ ...sample, seatId: 'outsider' }],
        })
      ).status,
    ).toBe(400)
    const loaded = await (
      await app.request(`/v1/studio/browser-runs/${run.id}`, { headers })
    ).json()
    expect(loaded.step).toBe(8) // telemetry must not consume the decision lock
    expect(loaded.telemetry).toHaveLength(1)
    expect(loaded.telemetry[0]).toMatchObject({
      source: 'client-observed-preview',
      rewardEligible: false,
    })
  })
})
