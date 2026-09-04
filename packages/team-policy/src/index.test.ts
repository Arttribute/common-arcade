import { describe, expect, it } from 'vitest'
import { TeamCoordinator } from './index.js'

const policy = {
  id: 'tmp_footballteam1',
  version: '0.1.0',
  profile: 'hybrid',
  initialStrategy: 'balanced',
  strategies: {
    balanced: { formation: '4-3-3' },
    'protect-lead': { formation: '4-5-1' },
  },
  roles: [
    { id: 'defender', maxSeats: 4 },
    { id: 'forward', maxSeats: 3 },
  ],
  communication: {
    allowedTypes: ['strategy.commit', 'pass.offer', 'role.bid'],
    maxBytes: 1024,
    maxMessagesPerTick: 4,
  },
}

describe('TeamCoordinator', () => {
  it('switches all seats through one future strategy epoch', () => {
    const coordinator = new TeamCoordinator(policy, 'red')
    const proposal = coordinator.proposeStrategy({
      strategy: 'protect-lead',
      effectiveTick: 100,
      validUntilTick: 500,
      assignments: {
        'red-2': { role: 'left-cover' },
        'red-9': { role: 'safe-outlet' },
      },
    })
    coordinator.acknowledgeStrategy('red-2', proposal.strategyEpoch)
    coordinator.acknowledgeStrategy('red-9', proposal.strategyEpoch)
    expect(coordinator.advance(99)).toBeUndefined()
    expect(coordinator.activeStrategy).toBe('balanced')
    expect(coordinator.advance(100)).toMatchObject({
      strategyEpoch: 2,
      strategy: 'protect-lead',
      acknowledgements: ['red-2', 'red-9'],
    })
    expect(coordinator.activeStrategy).toBe('protect-lead')
  })

  it('uses expiring leases for scarce responsibilities', () => {
    const coordinator = new TeamCoordinator(policy, 'red')
    coordinator.assign({
      responsibility: 'press-ball',
      seatId: 'red-6',
      role: 'primary-presser',
      tick: 20,
      expiresTick: 24,
    })
    expect(() =>
      coordinator.assign({
        responsibility: 'press-ball',
        seatId: 'red-8',
        role: 'primary-presser',
        tick: 22,
        expiresTick: 26,
      }),
    ).toThrow('already leased')
    expect(coordinator.assignments(25)).toEqual([])
  })
})
