import { describe, expect, it } from 'vitest'
import { ARCADE_API_VERSION } from '@common-arcade/protocol'
import { compilePolicy } from './index.js'

const source = {
  apiVersion: ARCADE_API_VERSION,
  kind: 'Policy',
  metadata: { id: 'pol_policytest01', name: 'baseline', version: '0.1.0' },
  spec: {
    compatible: { releaseIds: ['rel_tictactoe1'] },
    initialState: 'playing',
    states: {
      playing: {
        onObservation: [
          {
            id: 'first-move',
            when: 'true',
            select: { kind: 'first-legal' },
            explanation: 'Choose the first legal action.',
          },
        ],
      },
    },
    fallback: { kind: 'none' },
    budget: { maxSteps: 20, maxActionsPerStep: 1, memoryKiB: 16 },
  },
}

describe('Policy IR compiler', () => {
  it('canonicalizes source into a stable content digest', async () => {
    const first = await compilePolicy(source)
    const second = await compilePolicy(structuredClone(source))
    expect(first.digest).toBe(second.digest)
    expect(first.ir.spec.states.playing?.onObservation[0]).toMatchObject({
      priority: 0,
      cooldownSteps: 0,
    })
  })

  it('rejects transitions to undeclared states', async () => {
    const invalid = structuredClone(source)
    ;(
      invalid.spec.states.playing.onObservation[0] as Record<string, unknown>
    ).transitionTo = 'missing'
    await expect(compilePolicy(invalid)).rejects.toThrow('transitionTo')
  })
})
