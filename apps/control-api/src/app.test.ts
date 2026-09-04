import { describe, expect, it } from 'vitest'
import { createApp } from './app.js'

describe('control API bootstrap', () => {
  it('reports health', async () => {
    const response = await createApp().request('/healthz')
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      status: 'ok',
      service: 'common-arcade-control-api',
    })
  })

  it('does not advertise unimplemented capabilities', async () => {
    const response = await createApp().request('/v1/status')
    const body = await response.json()

    expect(body.capabilities).toEqual([])
    expect(body.protocol.normative).toBe(false)
  })

  it('does not reflect an untrusted browser origin', async () => {
    const response = await createApp().request('/v1/status', {
      headers: { origin: 'https://attacker.invalid' },
    })

    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })
})
