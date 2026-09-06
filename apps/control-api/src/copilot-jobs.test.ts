import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from './app.js'
import { MemoryDocumentStore } from './store.js'
import { emptyBrowserDocument } from '@common-arcade/studio'

process.env.COMMONS_IDENTITY_ISSUER = 'https://auth.agentcommons.io/api/auth'
afterEach(() => vi.unstubAllGlobals())

/**
 * Stands in for Agent Commons. Verified-principal lookups resolve the signed-in
 * creator; an agent run returns whatever the test wants the agent to have said.
 */
function stubCommons(reply: () => Promise<Response> | Response) {
  const calls: { url: string; body?: any }[] = []
  vi.stubGlobal('fetch', async (input: any, init: any) => {
    const url = String(input)
    calls.push({
      url,
      body: init?.body ? JSON.parse(init.body) : undefined,
    })
    if (url.endsWith('/v1/identity'))
      return Response.json({
        actorId: 'usr_creator',
        actorType: 'user',
        credentialType: 'oauth',
        scopes: ['agents:read', 'agents:write'],
      })
    if (url.includes('/v1/agents/run')) return reply()
    return Response.json({ data: { agentId: 'agt_copilot', name: 'Copilot' } })
  })
  return calls
}

const headers = {
  Authorization: 'Bearer opaque-commons-token',
  'Content-Type': 'application/json',
}
const duel = {
  ...emptyBrowserDocument,
  title: 'Duel',
  description: 'Two players duel with three lives each.',
  files: [
    {
      path: 'index.html',
      content:
        '<!doctype html><html><body><canvas id="stage"></canvas><script type="module" src="main.js"></script></body></html>',
    },
    { path: 'main.js', content: 'window.arcade = { observe: () => ({}) }' },
  ],
}

async function poll(app: any, jobId: string) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const job = await (
      await app.request(`/v1/studio/copilot-jobs/${jobId}`, { headers })
    ).json()
    if (job.status !== 'running') return job
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('job never settled')
}

describe('building a game with a Commons agent', () => {
  const setup = () => {
    const store = new MemoryDocumentStore()
    return { store, app: createApp({ store, logRequests: false }) }
  }
  const start = async (app: any) => {
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
      body: JSON.stringify({
        message:
          'Create a live duel game where two players shoot each other and dodge by ducking or jumping, with three lives.',
        agentId: 'agt_copilot',
      }),
    })
    expect(started.status).toBe(202)
    return { project, jobId: (await started.json()).jobId }
  }

  it('turns one agent run into a playable, publishable revision', async () => {
    const calls = stubCommons(() =>
      Response.json({
        data: {
          content:
            'Here is your duel game.\n```json\n' +
            JSON.stringify({ summary: 'Built the duel', document: duel }) +
            '\n```',
        },
      }),
    )
    const { app } = setup()
    const { project, jobId } = await start(app)
    const job = await poll(app, jobId)
    expect(job).toMatchObject({ status: 'ready', summary: 'Built the duel' })
    expect(job.document.title).toBe('Duel')
    // The run must not ask for CLI tools it has no way to execute.
    const run = calls.find((call) => call.url.includes('/v1/agents/run'))
    expect(run?.body.cliContext).toBeUndefined()
    expect(run?.body.messages[0].content).toContain('window.arcade')

    const saved = await app.request(`/v1/projects/${project.id}`, {
      method: 'PUT',
      headers: { ...headers, 'If-Match': String(job.baseRevision) },
      body: JSON.stringify(job.document),
    })
    expect(saved.status).toBe(200)
    const published = await app.request(`/v1/projects/${project.id}/publish`, {
      method: 'POST',
      headers: {
        ...headers,
        'If-Match': String((await saved.json()).revision),
      },
      body: '{}',
    })
    expect(published.status).toBe(201)
    const release = await published.json()
    expect(release.manifest.metadata.title).toBe('Duel')
    expect(
      (await app.request(`/v1/studio/releases/${release.id}/preview`)).status,
    ).toBe(200)
  })

  it('reports an agent that answers with prose instead of failing the studio', async () => {
    stubCommons(() =>
      Response.json({ data: { content: 'I am not able to do that.' } }),
    )
    const { app } = setup()
    const { jobId } = await start(app)
    expect(await poll(app, jobId)).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('replied with text'),
    })
  })

  it('reports a Commons outage in words the creator can act on', async () => {
    stubCommons(() => new Response('<html>bad gateway</html>', { status: 502 }))
    const { app } = setup()
    const { jobId } = await start(app)
    const job = await poll(app, jobId)
    expect(job.status).toBe('failed')
    expect(job.error).toContain('unreadable response (502)')
  })

  it('keeps one creator out of another creator’s builds', async () => {
    stubCommons(() =>
      Response.json({
        data: { content: JSON.stringify({ summary: 'ok', document: duel }) },
      }),
    )
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
