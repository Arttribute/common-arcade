import { describe, it, expect } from 'vitest'
import {
  GAME_ECONOMY_EXTENSION,
  GAME_REMIX_EXTENSION,
  publishedGameEconomySchema,
  platformGameMonetizationSchema,
  type StudioRelease,
  type GameMonetization,
} from '@common-arcade/protocol'
import {
  inheritedRemixEconomy,
  unresolvedRemixRoyalty,
  publishGameEconomy,
} from './economy.js'
const original = '0x1111111111111111111111111111111111111111',
  remixer = '0x2222222222222222222222222222222222222222'
const policy: Extract<GameMonetization, { mode: 'revenue-share' }> = {
  mode: 'revenue-share',
  allowedModes: ['sponsored', 'staked'],
  feeBps: 250,
  creatorShareBps: 7000,
  payouts: { 'base-sepolia': original },
  spectatorBets: false,
}
const source = (economy: unknown, rate: number, other: unknown[] = []) =>
  ({
    manifest: {
      spec: {
        extensions: [{ id: GAME_ECONOMY_EXTENSION, config: economy }, ...other],
      },
    },
    distribution: { revenueShareBps: rate },
  }) as unknown as StudioRelease
describe('published remix economics', () => {
  it('fixes new creator splits while preserving immutable historical terms', () => {
    for (const creatorShareBps of [0, 5000, 9000]) {
      const historical = { ...policy, creatorShareBps }
      expect(publishedGameEconomySchema.parse(historical)).toEqual(historical)
      expect(platformGameMonetizationSchema.safeParse(historical).success).toBe(
        false,
      )
      expect(() => publishGameEconomy(historical, undefined)).toThrow(
        'platform policy',
      )
    }
    expect(publishGameEconomy(policy, undefined)).toEqual(policy)
  })
  it('does not silently reduce inherited royalties from a historical 90% release', () => {
    const inherited = inheritedRemixEconomy(
      source({ ...policy, creatorShareBps: 9000 }, 3000),
    )
    expect(() => publishGameEconomy(policy, inherited)).toThrow(
      'reduce inherited',
    )
  })

  it('retains Celo Sepolia payouts and inherited royalties when publishing a remix', () => {
    const celoPolicy = { ...policy, payouts: { 'celo-sepolia': original } }
    const inherited = inheritedRemixEconomy(source(celoPolicy, 3000))
    const child = publishGameEconomy(
      { ...celoPolicy, payouts: { 'celo-sepolia': remixer } },
      inherited,
    )
    expect(
      child.mode === 'revenue-share' && child.royalties?.['celo-sepolia'],
    ).toEqual([{ recipient: original, bps: 3000 }])
  })
  it('preserves legacy royalty obligations without blocking free remix creation', () => {
    const legacy = source({ mode: 'free' }, 500)
    expect(inheritedRemixEconomy(legacy)).toBeUndefined()
    expect(unresolvedRemixRoyalty(legacy)).toBe(true)
    expect(
      unresolvedRemixRoyalty(
        source({ mode: 'free' }, 0, [
          {
            id: GAME_REMIX_EXTENSION,
            config: { unresolvedRemixRoyalty: true },
          },
        ]),
      ),
    ).toBe(true)
    expect(unresolvedRemixRoyalty(source({ mode: 'free' }, 0))).toBe(false)
  })

  it('allows free remixes with no new royalty', () => {
    const inherited = inheritedRemixEconomy(source(policy, 0))
    expect(
      inherited?.mode === 'revenue-share' &&
        inherited.royalties?.['base-sepolia'],
    ).toEqual([])
  })
  it('preserves ancestors and charges a new share only against the remaining creator earnings', () => {
    const inherited = inheritedRemixEconomy(source(policy, 3000))
    const child = publishGameEconomy(
      { ...policy, payouts: { 'base-sepolia': remixer } },
      inherited,
    )
    const next = inheritedRemixEconomy(source(child, 2000))
    expect(
      next?.mode === 'revenue-share' && next.royalties?.['base-sepolia'],
    ).toEqual([
      { recipient: original, bps: 3000 },
      { recipient: remixer, bps: 1400 },
    ])
  })
  it('a free intermediate release cannot erase inherited royalty obligations', () => {
    const inherited = inheritedRemixEconomy(source(policy, 3000))
    const free = source({ mode: 'free' }, 0, [
      { id: GAME_REMIX_EXTENSION, config: { inheritedEconomy: inherited } },
    ])
    expect(inheritedRemixEconomy(free)).toEqual(inherited)
  })
  it('rejects lowering the creator share or changing to a network without inherited payouts', () => {
    const inherited = inheritedRemixEconomy(source(policy, 3000))
    expect(() =>
      publishGameEconomy({ ...policy, creatorShareBps: 0 }, inherited),
    ).toThrow('platform policy')
    expect(() =>
      publishGameEconomy(
        { ...policy, payouts: { 'arc-testnet': remixer } },
        inherited,
      ),
    ).toThrow('no inherited')
  })
  it('a free remix of a royalty-bearing source adds no new royalty', () => {
    const inherited = inheritedRemixEconomy(source(policy, 3000))
    const child = publishGameEconomy(
      { ...policy, payouts: { 'base-sepolia': remixer } },
      inherited,
    )
    expect(inheritedRemixEconomy(source(child, 0))).toEqual({
      ...child,
      royalties: { 'base-sepolia': [{ recipient: original, bps: 3000 }] },
    })
  })
})
