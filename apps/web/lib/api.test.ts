import { afterEach, describe, expect, it, vi } from 'vitest'
import { arcade, ArcadeApiError } from './api'
import { errorMessage } from './error-message'

afterEach(() => vi.unstubAllGlobals())

describe('readable API and Copilot errors', () => {
  it.each([
    [
      {
        error: [
          { path: 'runtime.entryFile', message: 'Server file is missing.' },
        ],
      },
      'runtime.entryFile: Server file is missing.',
    ],
    [
      {
        detail: 'Invalid game.',
        violations: [
          { field: 'files.2.content', message: 'Incomplete source.' },
        ],
      },
      'Invalid game.; files.2.content: Incomplete source.',
    ],
    [{ error: { message: 'Approval failed.' } }, 'Approval failed.'],
    [{ detail: {} }, 'Request failed. Please retry.'],
    [null, 'Request failed. Please retry.'],
  ])('preserves useful details in %j', async (body, expected) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json(body, { status: 422 })),
    )
    await expect(
      arcade('projects/p/copilot-changes/c/approve', {}),
    ).rejects.toMatchObject({
      name: 'ArcadeApiError',
      status: 422,
      message: expected,
    })
  })
  it('supports validation arrays saved by older Copilot versions', () => {
    expect(
      errorMessage([
        { path: ['runtime', 'entryFile'], message: 'Missing server.js' },
      ]),
    ).toBe('runtime.entryFile: Missing server.js')
    expect(errorMessage(new ArcadeApiError('Game changed.', 409))).toBe(
      'Game changed.',
    )
  })
})
