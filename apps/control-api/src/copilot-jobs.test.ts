import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from './app.js'
import { MemoryDocumentStore } from './store.js'
import { emptyBrowserDocument } from '@common-arcade/studio'

process.env.COMMONS_IDENTITY_ISSUER = 'https://auth.agentcommons.io/api/auth'
afterEach(() => vi.unstubAllGlobals())

type Call = { url: string; method: string; body?: any }
const headers = {
  Authorization: 'Bearer opaque-commons-token',
  'Content-Type': 'application/json',
}
const rawPrompt =
  'Let us create a simple live duel game where two players try to shoot each other down and avoid getting shot down by ducking or jumping with 3 lives'
const duel = {
  ...emptyBrowserDocument,
  title: 'Live Duel',
  description: 'Two players shoot, jump, and duck with three lives each.',
  files: [
    {
      path: 'index.html',
      content:
        '<!doctype html><html><body><canvas id="stage"></canvas><script type="module" src="main.js"></script></body></html>',
    },
    {
      path: 'main.js',
      content:
        'window.arcade={observe:()=>({lives:[3,3]}),actions:()=>[{id:"jump",label:"Jump"}],step:()=>true}',
    },
  ],
}

function sse(events: unknown[]) {
  return new Response(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''),
    { headers: { 'Content-Type': 'text/event-stream' } },
  )
}

function stubCommons(options: { outage?: boolean } = {}) {
  const calls: Call[] = []
  vi.stubGlobal('fetch', async (input: any, init: any = {}) => {
    const url = String(input)
    const method = init.method ?? 'GET'
    const body = init.body ? JSON.parse(init.body) : undefined
    calls.push({ url, method, body })
    if (url.endsWith('/v1/identity'))
      return Response.json({
        actorId: 'usr_creator',
        actorType: 'user',
        credentialType: 'oauth',
        scopes: ['agents:read', 'agents:write'],
      })
    if (url.endsWith('/v1/sessions'))
      return Response.json({ data: { sessionId: 'ses_arcade_project' } })
    if (url.endsWith('/v1/agents/run/stream')) {
      if (options.outage)
        return new Response('<html>bad gateway</html>', { status: 502 })
      return sse([
        { type: 'run_started', runId: 'run_arcade' },
        { type: 'tool', toolName: 'invoke_skill', status: 'success' },
        {
          type: 'cli_tool_request',
          requestId: 'req_read',
          tool: 'arcade_read_project',
          args: {},
        },
        {
          type: 'cli_tool_request',
          requestId: 'req_write',
          tool: 'arcade_write_game',
          args: duel,
        },
        {
          type: 'cli_tool_request',
          requestId: 'req_test',
          tool: 'arcade_test_game',
          args: {},
        },
        {
          type: 'final',
          content:
            'Built and tested Live Duel with shooting, jumping, ducking, and three lives.',
        },
      ])
    }
    if (url.endsWith('/v1/agents/cli-tool-result'))
      return Response.json({ ok: true })
    return Response.json({ data: { agentId: 'agt_copilot', name: 'Copilot' } })
  })
  return calls
}

async function poll(app: any, jobId: string) {
  for (let attempt = 0; attempt < 80; attempt++) {
    const job = await (
      await app.request(`/v1/studio/copilot-jobs/${jobId}`, { headers })
    ).json()
    if (job.status !== 'running') return job
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('job never settled')
}

describe('building a game in a native Commons agent session', () => {
  const setup = () => {
    const store = new MemoryDocumentStore()
    return { store, app: createApp({ store, logRequests: false }) }
  }
  const start = async (app: any, message = rawPrompt) => {
    const project = await (
      await app.request('/v1/projects', {
        method: 'POST',
        headers,
        body: JSON.stringify({ document: emptyBrowserDocument }),
      })
    ).json()
    const started = await app.request(`/v1/projects/${project.id}/copilot`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ message, agentId: 'agt_copilot' }),
    })
    expect(started.status).toBe(202)
    return { project, jobId: (await started.json()).jobId }
  }

  it('passes the raw prompt and lets Arcade tool calls create the revision', async () => {
    const calls = stubCommons()
    const { app } = setup()
    const { project, jobId } = await start(app)
    const job = await poll(app, jobId)

    expect(job).toMatchObject({
      status: 'ready',
      response: expect.stringContaining('Built and tested Live Duel'),
      projectRevision: 2,
      sessionId: 'ses_arcade_project',
    })
    expect(job.events.map((event: any) => event.label)).toEqual([
      'Loaded game-building skill',
      'Read Arcade project',
      'Write Arcade game',
      'Test Arcade game',
    ])
    const run = calls.find((call) => call.url.endsWith('/v1/agents/run/stream'))
    expect(run?.body.messages).toEqual([{ role: 'user', content: rawPrompt }])
    expect(run?.body.computerRequest).toEqual({ enabled: true })
    expect(run?.body.sessionId).toBe('ses_arcade_project')
    expect(run?.body.cliTools.map((tool: any) => tool.name)).toEqual([
      'arcade_read_project',
      'arcade_write_game',
      'arcade_test_game',
      'arcade_publish_game',
    ])
    expect(
      calls
        .filter((call) => call.url.endsWith('/v1/agents/cli-tool-result'))
        .map((call) => call.body.requestId),
    ).toEqual(['req_read', 'req_write', 'req_test'])
    const saved = await (
      await app.request(`/v1/projects/${project.id}`, { headers })
    ).json()
    expect(saved.document.title).toBe('Live Duel')
    expect(saved.revision).toBe(2)
  })

  it('continues later raw turns in the same durable Commons session', async () => {
    const calls = stubCommons()
    const { app } = setup()
    const { project, jobId } = await start(app)
    await poll(app, jobId)
    const secondPrompt = 'Make the jump taller.'
    const second = await app.request(`/v1/projects/${project.id}/copilot`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ message: secondPrompt, agentId: 'agt_copilot' }),
    })
    await poll(app, (await second.json()).jobId)
    expect(
      calls.filter((call) => call.url.endsWith('/v1/sessions')),
    ).toHaveLength(1)
    expect(
      calls
        .filter((call) => call.url.endsWith('/v1/agents/run/stream'))
        .map((call) => call.body.messages[0].content),
    ).toEqual([rawPrompt, secondPrompt])
  })

  it('queues hosted work and completes it only through the private worker', async () => {
    stubCommons()
    const store = new MemoryDocumentStore()
    let queued: any
    const app = createApp({
      store,
      logRequests: false,
      workerSecret: 'worker-test-secret',
      dispatchCopilotJob: async (invocation) => {
        queued = invocation
      },
    })
    const { jobId } = await start(app)
    expect(queued.input.message).toBe(rawPrompt)
    expect(
      await (
        await app.request(`/v1/studio/copilot-jobs/${jobId}`, { headers })
      ).json(),
    ).toMatchObject({ status: 'running', events: [] })
    expect(
      (
        await app.request(`/v1/internal/copilot-jobs/${jobId}/run`, {
          method: 'POST',
          headers: { ...headers, 'X-Arcade-Worker-Secret': 'wrong' },
          body: JSON.stringify(queued.input),
        })
      ).status,
    ).toBe(404)
    expect(
      (
        await app.request(`/v1/internal/copilot-jobs/${jobId}/run`, {
          method: 'POST',
          headers: {
            ...headers,
            'X-Arcade-Worker-Secret': 'worker-test-secret',
          },
          body: JSON.stringify(queued.input),
        })
      ).status,
    ).toBe(200)
    expect(await poll(app, jobId)).toMatchObject({ status: 'ready' })
  })

  it('reports a Commons stream outage in words the creator can act on', async () => {
    stubCommons({ outage: true })
    const { app } = setup()
    const { jobId } = await start(app)
    const job = await poll(app, jobId)
    expect(job.status).toBe('failed')
    expect(job.error).toContain('bad gateway')
  })

  it('keeps one creator out of another creator’s builds', async () => {
    stubCommons()
    const { app } = setup()
    const { jobId } = await start(app)
    await poll(app, jobId)
    vi.stubGlobal('fetch', async (input: any) =>
      String(input).endsWith('/v1/identity')
        ? Response.json({
            actorId: 'usr_someone_else',
            actorType: 'user',
            credentialType: 'oauth',
            scopes: ['agents:read'],
          })
        : Response.json({}),
    )
    expect(
      (await app.request(`/v1/studio/copilot-jobs/${jobId}`, { headers }))
        .status,
    ).toBe(404)
  })
})
