import { createServer } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { createApp } from './app.js'
import { MemoryDocumentStore } from './store.js'

/**
 * The Agent Commons API builds games for a signed-in creator using its own
 * service credential. What matters end to end is that the project lands in the
 * creator's Studio: a project owned by the service account would be invisible
 * to the person who asked for it.
 */
describe('delegated Commons service requests', () => {
  let server: ReturnType<typeof createServer>
  let sign: (claims: Record<string, unknown>) => Promise<string>
  beforeAll(async () => {
    const pair = await generateKeyPair('ES256')
    const key = { ...(await exportJWK(pair.publicKey)), kid: 'verification' }
    server = createServer((_request, response) => {
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ keys: [key] }))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as { port: number }
    const issuer = `http://127.0.0.1:${port}`
    process.env.COMMONS_IDENTITY_ISSUER = issuer
    process.env.ARCADE_COMMONS_DELEGATES = 'svc_agent_commons'
    sign = (claims) =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: 'ES256', kid: 'verification' })
        .setIssuer(issuer)
        .setAudience('commons-platform')
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(pair.privateKey)
  })
  afterAll(async () => {
    delete process.env.COMMONS_IDENTITY_ISSUER
    delete process.env.ARCADE_COMMONS_DELEGATES
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  })

  it('creates the project under the named creator, not the service account', async () => {
    const app = createApp({
      store: new MemoryDocumentStore(),
      allowLocalAuth: false,
      logRequests: false,
    })
    const token = await sign({
      sub: 'svc_agent_commons',
      actor_type: 'service',
      scopes: ['agents:read', 'agents:write'],
    })
    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Commons-Actor': 'creator_one',
    }
    const created = await app.request('/v1/projects', {
      method: 'POST',
      headers,
      body: '{}',
    })
    expect(created.status).toBe(201)
    const project = await created.json()
    expect(project.ownerId).toBe('creator_one')

    // Another creator cannot open it through the same service.
    const other = await app.request(`/v1/projects/${project.id}`, {
      headers: { ...headers, 'X-Commons-Actor': 'creator_two' },
    })
    expect(other.status).toBeGreaterThanOrEqual(403)
  })

  it('refuses to act for a creator when the service is not allowlisted', async () => {
    const app = createApp({
      store: new MemoryDocumentStore(),
      allowLocalAuth: false,
      logRequests: false,
    })
    const token = await sign({
      sub: 'svc_someone_else',
      actor_type: 'service',
      scopes: ['agents:write'],
    })
    const response = await app.request('/v1/projects', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Commons-Actor': 'creator_one',
      },
      body: '{}',
    })
    expect(response.status).toBe(403)
  })
})
