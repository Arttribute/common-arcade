// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { arcade } from '../../lib/api'
import { CopilotReview, type useProjectCopilot } from './copilot-sessions'

vi.mock('../../lib/api', () => ({ arcade: vi.fn() }))
type Copilot = ReturnType<typeof useProjectCopilot>
const pending = {
  id: 'change',
  sessionId: 'session',
  tool: 'arcade_write_live_game',
  args: {},
  baseRevision: 1,
  status: 'pending',
}
let container: HTMLDivElement
let root: Root
const onApplied = vi.fn(async () => {})
const refresh = vi.fn(async () => {})
const onReviewing = vi.fn()

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.clearAllMocks()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

async function render(dirty = false, change = pending) {
  function Harness() {
    const [changes, setChanges] = useState<Copilot['changes']>([change])
    const [error, setError] = useState('')
    const copilot: Copilot = {
      sessions: [],
      setSessionId: vi.fn(),
      activeJobId: '',
      recoveredRevision: 0,
      jobError: '',
      choose: vi.fn(async () => {}),
      create: vi.fn(async () => {}),
      approvalMode: 'manual',
      setApprovalMode: vi.fn(),
      computerEnabled: false,
      setComputerEnabled: vi.fn(),
      sessionId: 'session',
      changes,
      loading: false,
      error,
      setError,
      updateChange: (next) => setChanges([next]),
      refresh,
    }
    return (
      <CopilotReview
        copilot={copilot}
        projectId="project"
        busy={false}
        dirty={dirty}
        onApplied={onApplied}
        onReviewing={onReviewing}
      />
    )
  }
  await act(async () => root.render(<Harness />))
}
function button(label: string) {
  const found = [...container.querySelectorAll('button')].find(
    (item) => item.textContent === label,
  )
  if (!found) throw new Error(`Missing button: ${label}`)
  return found
}

describe('manual proposal decisions', () => {
  it('approves once, reloads the saved game, and removes the pending card', async () => {
    vi.mocked(arcade).mockResolvedValue({ ...pending, status: 'applied' })
    await render()
    await act(async () => {
      const approve = button('Approve')
      approve.click()
      approve.click()
    })
    expect(arcade).toHaveBeenCalledTimes(1)
    expect(arcade).toHaveBeenCalledWith(
      'projects/project/copilot-changes/change/approve',
      {},
    )
    expect(onApplied).toHaveBeenCalledTimes(1)
    expect(container.querySelector('details')).toBeNull()
    expect(container.textContent).toContain('Change approved and saved.')
    expect(onReviewing).toHaveBeenLastCalledWith(false)
  })
  it('allows rejection with unsaved edits and never reloads the game', async () => {
    vi.mocked(arcade).mockResolvedValue({ ...pending, status: 'rejected' })
    await render(true)
    expect(button('Approve').disabled).toBe(true)
    expect(button('Reject').disabled).toBe(false)
    await act(async () => button('Reject').click())
    expect(arcade).toHaveBeenCalledWith(
      'projects/project/copilot-changes/change/reject',
      {},
    )
    expect(onApplied).not.toHaveBeenCalled()
    expect(container.querySelector('details')).toBeNull()
    expect(container.textContent).toContain('Proposal rejected.')
  })
  it('shows legacy validation errors, disables failed approval, and permits rejection', async () => {
    vi.mocked(arcade).mockResolvedValue({
      ...pending,
      status: 'failed',
      result: {
        error: [{ path: 'runtime.entryFile', message: 'Missing server.js' }],
      },
    })
    await render()
    await act(async () => button('Approve').click())
    expect(container.textContent).toContain(
      'runtime.entryFile: Missing server.js',
    )
    expect(container.textContent).not.toContain('[object Object]')
    expect(button('Approve').disabled).toBe(true)
    expect(button('Reject').disabled).toBe(false)
    expect(onApplied).not.toHaveBeenCalled()
    vi.mocked(arcade).mockResolvedValue({ ...pending, status: 'rejected' })
    await act(async () => button('Reject').click())
    expect(container.querySelector('details')).toBeNull()
  })
  it('preserves a pending proposal and unlocks its buttons after a request failure', async () => {
    vi.mocked(arcade).mockRejectedValue(
      new Error('The game changed after this proposal.'),
    )
    await render()
    await act(async () => button('Approve').click())
    expect(container.textContent).toContain(
      'The game changed after this proposal.',
    )
    expect(button('Reject').disabled).toBe(false)
    expect(onReviewing).toHaveBeenLastCalledWith(false)
    expect(onApplied).not.toHaveBeenCalled()
  })
  it('does not restore an accepted proposal when refreshing history fails', async () => {
    vi.mocked(arcade).mockResolvedValue({ ...pending, status: 'applied' })
    refresh.mockRejectedValueOnce(new Error('Could not refresh history.'))
    await render()
    await act(async () => button('Approve').click())
    expect(onApplied).toHaveBeenCalledTimes(1)
    expect(container.querySelector('details')).toBeNull()
    expect(container.textContent).toContain('Change approved and saved.')
    expect(container.textContent).toContain('Could not refresh history.')
  })
})
