import { expect, it } from 'vitest'
import { normalizeCoachingPaths } from './coaching.js'
const plan = {
  strategy: 'Attack nearby opponents',
  reason: 'Use range',
  executableStrategy: {
    actionWeights: {},
    avoidActions: [],
    rules: [
      {
        when: [{ path: 'state.you.distance', op: 'lt' as const, value: 100 }],
        actionId: 'kick',
        weight: 40,
      },
    ],
  },
}
it('makes envelope-prefixed model conditions usable by the state-relative policy', () => {
  expect(
    normalizeCoachingPaths(plan, { state: { you: { distance: 50 } } })
      .executableStrategy.rules[0]?.when[0]?.path,
  ).toBe('you.distance')
  expect(plan.executableStrategy.rules[0]?.when[0]?.path).toBe(
    'state.you.distance',
  )
})
it('preserves paths into an actual game-owned state field and absent dynamic fields', () => {
  expect(
    normalizeCoachingPaths(plan, {
      state: { state: { you: { distance: 50 } } },
    }),
  ).toBe(plan)
  expect(
    normalizeCoachingPaths(plan, { state: {} }).executableStrategy.rules[0]
      ?.when[0]?.path,
  ).toBe('state.you.distance')
})
