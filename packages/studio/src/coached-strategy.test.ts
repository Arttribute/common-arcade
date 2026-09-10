import { describe, expect, it } from 'vitest'
import { createBrowserPolicy } from './browser-policy.js'
import { executableStrategySchema } from './coached-strategy.js'
import { livePolicyObservation } from './live-policy.js'

describe('game-independent coached policies', () => {
  it('changes arbitrary actions using conditional visible state without old learned preferences', () => {
    const policy = createBrowserPolicy()
    const plan = executableStrategySchema.parse({
      actionWeights: { gather: 60 },
      avoidActions: ['retreat'],
      rules: [
        {
          when: [{ path: 'inventory.capacity', op: 'gte', value: 10 }],
          actionId: 'deposit',
          weight: 100,
        },
      ],
    })
    const actions = ['gather', 'deposit', 'retreat'].map((id) => ({
      id,
      label: id,
    }))
    const controller = {
      seatId: 'worker',
      strategy: 'Gather then deposit when full.',
      executableStrategy: plan,
    }
    expect(
      policy.choose(
        { state: { inventory: { capacity: 1 } }, actions },
        controller,
        0,
      ).actionId,
    ).toBe('gather')
    expect(
      policy.choose(
        { state: { inventory: { capacity: 10 } }, actions },
        controller,
        0,
      ).actionId,
    ).toBe('deposit')
    expect(policy.choose({ state: {}, actions }, controller, 0).actionId).toBe(
      'gather',
    )
    expect(
      policy.choose({ state: {}, actions: [actions[2]!] }, controller, 0)
        .actionId,
    ).toBe('retreat')
  })
  it('rejects executable code, unsafe paths, excessive rules, and nonfinite weights', () => {
    const plan = { actionWeights: {}, avoidActions: [], rules: [] }
    expect(
      executableStrategySchema.safeParse({ ...plan, source: 'fetch()' })
        .success,
    ).toBe(false)
    expect(
      executableStrategySchema.safeParse({
        ...plan,
        actionWeights: { x: Infinity },
      }).success,
    ).toBe(false)
    const rule = {
      when: [{ path: '__proto__.x', op: 'eq', value: true }],
      actionId: 'x',
      weight: 1,
    }
    expect(
      executableStrategySchema.safeParse({ ...plan, rules: [rule] }).success,
    ).toBe(false)
  })
  it('keeps live action identity stable across ordering and distinguishes targets', () => {
    const legalActions = [
      { type: 'place', cell: 1 },
      { type: 'place', cell: 2 },
    ]
    const original = livePolicyObservation({
      visibleState: {},
      legalActions,
    })
    const reversed = livePolicyObservation({
      visibleState: {},
      legalActions: [...legalActions].reverse(),
    })
    expect(original.observation.actions[0]!.id).toBe(
      reversed.observation.actions[1]!.id,
    )
    expect(new Set(original.observation.actions.map((a) => a.id)).size).toBe(2)
    expect(original.payloads.get(original.observation.actions[0]!.id)).toEqual(
      legalActions[0],
    )
  })
})
