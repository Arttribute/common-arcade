import { afterEach, expect, it, vi } from 'vitest'
import { defaultArcadeModel } from './model-defaults.js'

afterEach(() => vi.unstubAllEnvs())
it('uses GPT-5.5 for new agents and Studio runs', () => {
  vi.stubEnv('ARCADE_AGENT_MODEL_PROVIDER', undefined)
  vi.stubEnv('ARCADE_AGENT_MODEL_ID', undefined)
  expect(defaultArcadeModel()).toEqual({
    provider: 'openai',
    modelId: 'gpt-5.5',
  })
})
it('respects the configured provider and model', () => {
  vi.stubEnv('ARCADE_AGENT_MODEL_PROVIDER', 'custom')
  vi.stubEnv('ARCADE_AGENT_MODEL_ID', 'configured-model')
  expect(defaultArcadeModel()).toEqual({
    provider: 'custom',
    modelId: 'configured-model',
  })
})
