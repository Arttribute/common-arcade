import { describe, expect, it } from 'vitest'
import { compilePolicy } from '@common-arcade/policy-ir'
import { ARCADE_API_VERSION, type Observation } from '@common-arcade/protocol'
import { DeterministicPolicyRuntime, evaluateCondition } from './index.js'

const observation: Observation = {
  matchId: 'mat_policytest01',
  seatId: 'sea_policyseat01',
  stateSequence: 2,
  eventSequence: 4,
  schemaVersion: 'v0alpha1',
  turn: 3,
  visibleState: { scoreDifference: -1 },
  legalActions: [{ type: 'wait' }, { type: 'attack' }],
  events: [],
  stateHash: `sha256:${'a'.repeat(64)}`,
}

describe('deterministic policy runtime', () => {
  it('evaluates a bounded CEL subset and selects a legal preference', async () => {
    expect(
      evaluateCondition(
        'observation.visibleState.scoreDifference < 0 && policy.step >= 1',
        { observation, memory: {}, policy: { state: 'playing', step: 1 } },
      ),
    ).toBe(true)
    const policy = await compilePolicy({
      apiVersion: ARCADE_API_VERSION,
      kind: 'Policy',
      metadata: { id: 'pol_runtimetest1', name: 'attacker', version: '0.1.0' },
      spec: {
        compatible: { releaseIds: ['rel_example001'] },
        initialState: 'playing',
        states: {
          playing: {
            onObservation: [
              {
                id: 'attack-when-behind',
                when: 'observation.visibleState.scoreDifference < 0',
                select: {
                  kind: 'prefer-legal',
                  actions: [{ type: 'attack' }],
                },
                priority: 10,
                explanation: 'Increase pressure while behind.',
              },
            ],
          },
        },
        fallback: { kind: 'first-legal' },
        budget: { maxSteps: 10, maxActionsPerStep: 1, memoryKiB: 16 },
      },
    })
    expect(
      new DeterministicPolicyRuntime(policy).decide(observation),
    ).toMatchObject({
      matchedRuleId: 'attack-when-behind',
      action: { type: 'attack' },
    })
  })
})
