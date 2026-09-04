import { describe, expect, it } from 'vitest'
import { ARCADE_PROTOCOL, isArcadeProtocolNamespace } from './index.js'

describe('protocol bootstrap metadata', () => {
  it('cannot be mistaken for a normative release', () => {
    expect(ARCADE_PROTOCOL.stability).toBe('non-normative')
    expect(isArcadeProtocolNamespace(ARCADE_PROTOCOL.namespace)).toBe(true)
    expect(isArcadeProtocolNamespace('arcade/v1')).toBe(false)
  })
})
