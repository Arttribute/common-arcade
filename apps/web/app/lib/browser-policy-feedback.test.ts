import { describe, expect, it } from 'vitest'
import { transitionFeedback } from './browser-policy-feedback'

describe('browser policy feedback', () => {
  it('rewards race progress and position without treating speed alone as success', () => {
    const feedback = transitionFeedback(
      {
        phase: 'race',
        you: {
          distanceToFinish: 100_000,
          place: 3,
          speedMph: 80,
          offRoad: false,
          finished: false,
        },
      },
      {
        phase: 'race',
        you: {
          distanceToFinish: 97_000,
          place: 2,
          speedMph: 70,
          offRoad: false,
          finished: false,
        },
      },
      'accelerateRight',
      500,
    )

    expect(feedback).toMatchObject({
      outcome: 'positive',
      reward: 3,
      metrics: {
        distanceRemainingDelta: -3_000,
        placeDelta: -1,
        offRoadDelta: 0,
      },
    })
    expect(feedback.metrics).not.toHaveProperty('speedMph')
  })

  it('penalizes leaving the road and accepts explicit game-authored reward', () => {
    const feedback = transitionFeedback(
      { you: { offRoad: false } },
      {
        you: { offRoad: true },
        arcadeDecisionContext: { rewardDelta: -2 },
      },
      'accelerate',
      250,
    )

    expect(feedback).toMatchObject({
      outcome: 'negative',
      reward: -5,
      metrics: { offRoadDelta: 1, explicitReward: -2 },
    })
  })

  it('leaves observations with no attributable change as unknown', () => {
    expect(
      transitionFeedback({ phase: 'race' }, { phase: 'race' }, 'move', 100),
    ).toMatchObject({ outcome: 'unknown', reward: 0, metrics: {} })
  })
})
