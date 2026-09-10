import { expect, it } from 'vitest'
import { livePolicyObservation } from './live-policy.js'
import { createBrowserPolicy } from './browser-policy.js'
it('preserves game-authored semantic hints through opaque payload identities', () => {
  const input = livePolicyObservation({
    visibleState: {
      phase: 'fight',
      arcadeDecisionContext: {
        actionScores: { uppercut: 40, jab: -40 },
        preferredActions: ['uppercut'],
      },
    },
    legalActions: [
      { id: 'jab', label: 'Jab' },
      { id: 'uppercut', label: 'Uppercut' },
    ],
  })
  const chosen = createBrowserPolicy().choose(
    input.observation,
    { seatId: 's', strategy: 'Play legally' },
    0,
  )
  expect(input.payloads.get(chosen.actionId)).toEqual({
    id: 'uppercut',
    label: 'Uppercut',
  })
})
