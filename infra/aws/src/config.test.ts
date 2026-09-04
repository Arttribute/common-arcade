import { describe, expect, it } from 'vitest'
import { deploymentConfig } from './config.js'

describe('deploymentConfig', () => {
  it('protects production', () => {
    expect(deploymentConfig('production').terminationProtection).toBe(true)
  })

  it('rejects unknown stages', () => {
    expect(() => deploymentConfig('preview')).toThrow('Invalid CDK stage')
  })
})
