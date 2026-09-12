import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { readSession, copilotCredentialLifetimeMs } from './session'
import { POST } from '../app/api/arcade/[...path]/route'

vi.mock('./session', () => ({
  readSession: vi.fn(),
  copilotCredentialLifetimeMs: 660_000,
  cookieOptions: {},
  sessionCookie: 'test',
}))
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('Copilot proxy authentication', () => {
  const context = {
    params: Promise.resolve({
      path: ['v1', 'projects', 'prj_test', 'copilot'],
    }),
  }
  const request = (authorization?: string) =>
    new NextRequest(
      'https://arcade.example/api/arcade/v1/projects/prj_test/copilot',
      {
        method: 'POST',
        headers: {
          origin: 'https://arcade.example',
          ...(authorization ? { authorization } : {}),
        },
        body: '{}',
      },
    )
  it('forwards the renewed credential when starting a job', async () => {
    vi.mocked(readSession).mockResolvedValue({
      id: 'creator',
      name: 'Creator',
      accessToken: 'renewed',
      expiresAt: Date.now() + 3600_000,
    })
    const fetch = vi
      .fn()
      .mockResolvedValue(Response.json({ jobId: 'job_1' }, { status: 202 }))
    vi.stubGlobal('fetch', fetch)
    expect((await POST(request(), context)).status).toBe(202)
    expect(readSession).toHaveBeenCalledWith(copilotCredentialLifetimeMs)
    expect(fetch.mock.calls[0]![1].headers.get('authorization')).toBe(
      'Bearer renewed',
    )
  })
  it('does not dispatch when session renewal fails', async () => {
    vi.mocked(readSession).mockResolvedValue(null)
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    expect((await POST(request(), context)).status).toBe(401)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('preserves explicit caller credentials without using the browser session', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(Response.json({ jobId: 'job_1' }, { status: 202 }))
    vi.stubGlobal('fetch', fetch)
    expect((await POST(request('Bearer external'), context)).status).toBe(202)
    expect(readSession).not.toHaveBeenCalled()
    expect(fetch.mock.calls[0]![1].headers.get('authorization')).toBe(
      'Bearer external',
    )
  })
})
