import { describe, expect, it } from 'vitest'
import {
  GAME_ECONOMY_EXTENSION,
  type JsonValue,
  type GameManifest,
} from '@common-arcade/protocol'
import { offersPaidHosting, paidHostingUnavailable } from './host-payments'

function game(overrides: Partial<GameManifest['spec']> = {}): GameManifest {
  return {
    spec: {
      mode: 'turn-based',
      seats: { min: 2, max: 2 },
      runtime: { type: 'declarative', module: 'sandboxed-script-v1' },
      extensions: [
        {
          id: GAME_ECONOMY_EXTENSION,
          config: {
            mode: 'revenue-share',
            allowedModes: ['staked', 'sponsored'],
            feeBps: 250,
            creatorShareBps: 7000,
            payouts: { 'base-sepolia': `0x${'1'.repeat(40)}` },
          },
        },
      ],
      ...overrides,
    },
  } as GameManifest
}

describe('paid hosting discovery', () => {
  it('lists a published paid two-player game', () => {
    expect(offersPaidHosting(game())).toBe(true)
    expect(paidHostingUnavailable(game())).toBeUndefined()
  })
  it('excludes realtime games even when their creator enabled earnings', () => {
    expect(offersPaidHosting(game({ mode: 'realtime' }))).toBe(false)
    expect(paidHostingUnavailable(game({ mode: 'realtime' }))).toContain(
      'game mode',
    )
  })
  it('explains the seat constraint without calling a turn-based game realtime', () => {
    const three = game({ seats: { ...game().spec.seats, min: 3, max: 3 } })
    expect(offersPaidHosting(three)).toBe(false)
    expect(paidHostingUnavailable(three)).toContain('two-player')
    expect(paidHostingUnavailable(three)).not.toContain('realtime')
  })
  it('excludes browser previews and unknown runtimes', () => {
    for (const module of ['browser-presentation', 'unknown-runtime'])
      expect(
        offersPaidHosting(
          game({
            runtime: {
              type: 'declarative',
              module,
              digest: `sha256:${'1'.repeat(64)}`,
            },
          }),
        ),
      ).toBe(false)
  })
  it('requires valid published earnings, with a payout and allowed format', () => {
    expect(offersPaidHosting(game({ extensions: [] }))).toBe(false)
    for (const config of [
      { mode: 'free' },
      { mode: 'revenue-share', payouts: {} },
    ] as JsonValue[])
      expect(
        offersPaidHosting(
          game({
            extensions: [
              { id: GAME_ECONOMY_EXTENSION, required: false, config },
            ],
          }),
        ),
      ).toBe(false)
  })
})
