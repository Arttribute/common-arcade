import { describe, expect, it } from 'vitest'
import { AdaptationController } from './index.js'

const learning = {
  adaptationPoints: ['turn-boundary'],
  visibleMetrics: ['scoreDifference'],
  matchMemory: 'allowed',
  longTermLearning: 'opt-in',
}

const contract = {
  initialStrategy: 'balanced',
  strategies: ['balanced', 'protect-lead', 'chase-game'],
  maxChangesPerWindow: 2,
  changeWindowSteps: 10,
  transitions: [
    {
      id: 'protect-lead',
      from: ['balanced'],
      to: 'protect-lead',
      at: 'turn-boundary',
      threshold: { metric: 'scoreDifference', operator: 'gte', value: 1 },
      confirmForSteps: 2,
      minimumDwellSteps: 2,
      cooldownSteps: 3,
      priority: 10,
      reason: 'Confirmed a lead; reduce unnecessary risk.',
    },
  ],
}

describe('AdaptationController', () => {
  it('waits for evidence and commits a bounded strategy epoch', () => {
    const controller = new AdaptationController(learning, contract)
    expect(
      controller.observe('turn-boundary', { scoreDifference: 1 }),
    ).toBeUndefined()
    expect(
      controller.observe('turn-boundary', { scoreDifference: 1 }),
    ).toMatchObject({
      from: 'balanced',
      to: 'protect-lead',
      strategyEpoch: 2,
      evidence: { consecutiveSteps: 2 },
    })
    expect(controller.activeStrategy).toBe('protect-lead')
  })

  it('rejects policy access to a metric hidden by the game', () => {
    const invalid = structuredClone(contract)
    invalid.transitions[0]!.threshold.metric = 'secretOpponentState'
    expect(() => new AdaptationController(learning, invalid)).toThrow(
      'not exposed by the game',
    )
  })
})
