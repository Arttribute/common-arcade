// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JoinQrButton, qrPath } from './join-qr'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe('join QR', () => {
  it('encodes the link with a four-module quiet zone', () => {
    const { d, size } = qrPath('https://arcade.agentcommons.io/play/mch_123')
    // Version 3 (29 modules) plus a four-module border on each side.
    expect(size).toBeGreaterThanOrEqual(29 + 8)
    expect(d).toMatch(/^M4 4h1v1h-1z/)
  })

  it('opens a large code for the current session page', async () => {
    await act(async () => root.render(<JoinQrButton />))
    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Show QR code to join"]',
    )!
    await act(async () => trigger.click())
    const dialog = document.querySelector('.join-qr-dialog')!
    expect(dialog.textContent).toContain('Scan to join')
    expect(
      dialog.querySelector('svg[role="img"] path')?.getAttribute('d'),
    ).toBeTruthy()
    expect(dialog.textContent).toContain(window.location.host)
  })
})
