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
  'Create a live-ready four-in-a-row strategy game for two players.'
const liveGame = {
  kind: 'browser' as const,
  title: 'Live Lines',
  description: 'Two players race to place four marks in a row.',
  entryFile: 'index.html',
  play: {
    mode: 'turn-based' as const,
    seats: { min: 2, max: 2, default: 2 },
    maxDecisionsPerSecond: 2,
  },
  runtime: {
    kind: 'sandboxed-script' as const,
    entryFile: 'server.js',
    tickRate: 30,
    memoryMiB: 8,
    timeoutMs: 20,
  },
  files: [
    {
      path: 'index.html',
      content: '<main id="game"></main><script src="main.js"></script>',
    },
    {
      path: 'main.js',
      content:
        "window.arcade={render:(state)=>{document.querySelector('#game').textContent=JSON.stringify(state)}};document.querySelector('#game').onclick=()=>window.arcade.submit({type:'place',cell:0});",
    },
    {
      path: 'server.js',
      content:
        "globalThis.arcadeGame={initialize:c=>({roster:c.roster,turn:0,moves:[]}),validateAction:(s,a,c)=>s.roster[s.turn%2].seatId===c.seatId&&a&&a.type==='place'?null:'Not your turn',applyAction:(s,a)=>({state:{...s,turn:s.turn+1,moves:s.moves.concat([a.cell])},events:[{type:'game.move',visibility:'public',payload:a}]}),observe:(s,id)=>({visibleState:s,legalActions:s.roster[s.turn%2].seatId===id?[{type:'place',cell:0}]:[]}),result:s=>s.turn>=4?{winnerSeatId:s.roster[0].seatId}:null};",
    },
  ],
}
const realtimeLiveGame = {
  ...liveGame,
  title: 'Live Duel',
  description: 'Two players shoot and dodge on an authoritative clock.',
  play: { ...liveGame.play, mode: 'realtime' as const },
  files: liveGame.files.map((file) =>
    file.path === 'server.js'
      ? {
          ...file,
          content:
            "globalThis.arcadeGame={initialize:c=>({roster:c.roster,hits:0}),validateAction:(s,a,c)=>s.roster.some(x=>x.seatId===c.seatId)&&a&&a.type==='shoot'?null:'Cannot shoot',applyAction:(s,a,c)=>({state:s,events:[{type:'duel.shot',visibility:'public',payload:{seatId:c.seatId}}]}),tick:s=>({state:{...s,hits:s.hits+1},events:[]}),observe:(s,id,c)=>({visibleState:s,legalActions:[{type:'shoot'}],feedback:{elapsedMs:c.elapsedMs}}),result:()=>null};",
        }
      : file,
  ),
}
const blackjackLiveGame = {
  ...liveGame,
  title: 'Blackjack Table',
  description: 'A turn-based card table with server-owned hands and totals.',
  files: liveGame.files.map((file) =>
    file.path === 'server.js'
      ? {
          ...file,
          content:
            "globalThis.arcadeGame={initialize:c=>({roster:c.roster,turn:0,totals:c.roster.map(()=>12)}),validateAction:(s,a,c)=>s.roster[s.turn%s.roster.length].seatId===c.seatId&&a&&['hit','stand'].includes(a.type)?null:'Not your turn',applyAction:(s,a)=>({state:{...s,turn:s.turn+1,totals:s.totals.map((n,i)=>a.type==='hit'&&i===s.turn%s.roster.length?n+1:n)},events:[{type:'cards.action',visibility:'public',payload:{type:a.type}}]}),observe:(s,id)=>({visibleState:{turn:s.turn,totals:s.totals,seatId:id},legalActions:s.roster[s.turn%s.roster.length].seatId===id?[{type:'hit'},{type:'stand'}]:[]}),result:()=>null};",
        }
      : file,
  ),
}

function sse(events: unknown[]) {
  return new Response(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''),
    { headers: { 'Content-Type': 'text/event-stream' } },
  )
}

function stubCommons(
  options: { outage?: boolean; game?: Record<string, unknown> } = {},
) {
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
          tool: 'arcade_write_live_game',
          args: options.game ?? liveGame,
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
            'Built and tested Live Lines on an authoritative live runtime.',
        },
      ])
    }
    if (url.endsWith('/v1/agents/cli-tool-result')) {
      return Response.json({ ok: true })
    }
    return Response.json({ data: { agentId: 'agt_copilot', name: 'Copilot' } })
  })
  return calls
}

async function poll(app: any, jobId: string) {
  const deadline = Date.now() + 4000
  while (Date.now() < deadline) {
    const job = await (
      await app.request(`/v1/studio/copilot-jobs/${jobId}`, { headers })
    ).json()
    if (job.status !== 'running') return job
    await new Promise((resolve) => setTimeout(resolve, 25))
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
      response: expect.stringContaining('Built and tested Live Lines'),
      projectRevision: 2,
      sessionId: 'ses_arcade_project',
    })
    expect(job.events.map((event: any) => event.label)).toEqual([
      'Loaded game-building skill',
      'Read Arcade project',
      'Write live-ready Arcade game',
      'Test Arcade game',
    ])
    const run = calls.find((call) => call.url.endsWith('/v1/agents/run/stream'))
    expect(run?.body.messages).toEqual([{ role: 'user', content: rawPrompt }])
    expect(run?.body.computerRequest).toEqual({ enabled: false })
    expect(run?.body.sessionId).toBe('ses_arcade_project')
    expect(run?.body.cliTools.map((tool: any) => tool.name)).toEqual([
      'arcade_read_project',
      'arcade_write_live_game',
      'arcade_configure_earnings',
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
    expect(saved.document.title).toBe('Live Lines')
    expect(saved.revision).toBe(2)
  })

  it('only exposes preview writing when the creator explicitly requests it', async () => {
    const calls = stubCommons()
    const { app } = setup()
    const { jobId } = await start(
      app,
      'Create a local preview-only prototype for this experiment.',
    )

    await poll(app, jobId)
    const run = calls.find((call) => call.url.endsWith('/v1/agents/run/stream'))
    expect(run?.body.cliTools.map((tool: any) => tool.name)).toContain(
      'arcade_write_preview_game',
    )
  })

  it('writes and smoke-tests a realtime live game through the Copilot tool boundary', async () => {
    stubCommons({ game: realtimeLiveGame })
    const { app } = setup()
    const { project, jobId } = await start(
      app,
      'Create a live duel where two players shoot and dodge.',
    )

    expect(await poll(app, jobId)).toMatchObject({
      status: 'ready',
      projectRevision: 2,
    })
    const saved = await (
      await app.request(`/v1/projects/${project.id}`, { headers })
    ).json()
    expect(saved.document).toMatchObject({
      title: 'Live Duel',
      play: { mode: 'realtime' },
      runtime: { kind: 'sandboxed-script', entryFile: 'server.js' },
    })
  })

  it('writes and smoke-tests a card game through the same live tool boundary', async () => {
    stubCommons({ game: blackjackLiveGame })
    const { app } = setup()
    const { project, jobId } = await start(
      app,
      'Create a live blackjack game without payments.',
    )

    expect(await poll(app, jobId)).toMatchObject({
      status: 'ready',
      projectRevision: 2,
    })
    const saved = await (
      await app.request(`/v1/projects/${project.id}`, { headers })
    ).json()
    expect(saved.document).toMatchObject({
      title: 'Blackjack Table',
      play: { mode: 'turn-based' },
      runtime: { kind: 'sandboxed-script', entryFile: 'server.js' },
    })
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
    const conversation = await (
      await app.request(
        `/v1/projects/${project.id}/copilot-session?agentId=agt_copilot`,
        { headers },
      )
    ).json()
    expect(conversation.sessionId).toBe('ses_arcade_project')
    expect(conversation.messages.map((message: any) => message.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
    ])
    expect(conversation.messages[2].text).toBe(secondPrompt)
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
