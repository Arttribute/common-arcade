import { createServer } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { createAuthenticator } from './identity.js'
import { MemoryDocumentStore } from './store.js'

describe('Commons JWT federation', () => {
  let issuer: string
  let privateKey: CryptoKey
  let server: ReturnType<typeof createServer>
  beforeAll(async () => {
    const pair = await generateKeyPair('ES256')
    privateKey = pair.privateKey
    const key = { ...(await exportJWK(pair.publicKey)), kid: 'verification' }
    server = createServer((_request, response) => {
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ keys: [key] }))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as { port: number }
    issuer = `http://127.0.0.1:${address.port}`
  })
  afterAll(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  )
  const token = (
    claims: Record<string, unknown>,
    audience = 'commons-platform',
  ) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'ES256', kid: 'verification' })
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey)
  it('verifies Commons user and service tokens with the same owner identity as the platform', async () => {
    const auth = createAuthenticator(new MemoryDocumentStore(), { issuer })
    const user = await token({
      sub: 'creator',
      actor_type: 'user',
      scopes: ['agents:read', 'agents:write'],
    })
    expect((await auth(`Bearer ${user}`, 'projects:write')).id).toBe('creator')
    const service = await token({
      azp: 'cc_external_agent',
      actor_type: 'service',
      scopes: ['agents:read'],
    })
    expect((await auth(`Bearer ${service}`, 'projects:read')).id).toBe(
      'cc_external_agent',
    )
    await expect(
      auth(`Bearer ${service}`, 'projects:write'),
    ).rejects.toMatchObject({ status: 403 })
  })
  it('rejects tokens for another audience and human tokens without a subject', async () => {
    const auth = createAuthenticator(new MemoryDocumentStore(), { issuer })
    for (const value of [
      await token({ sub: 'creator' }, 'other-platform'),
      await token({ azp: 'client', actor_type: 'user' }),
    ]) {
      await expect(auth(`Bearer ${value}`)).rejects.toMatchObject({
        status: 401,
      })
    }
  })
})
