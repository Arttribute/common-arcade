import { it, expect } from 'vitest'
import { parseAgentBalance } from './agent-balances'
const address = '0x' + '1'.repeat(40)
it('shows exact native and USDC balances only for the requested wallet/network', () => {
  const balance = { address, chainId: '296', usdc: '0.000001', native: '2.5' }
  expect(parseAgentBalance(balance, address, 296)).toEqual({
    usdc: '0.000001',
    native: '2.5',
  })
  for (const value of [
    null,
    { error: 'RPC failed' },
    { ...balance, usdc: undefined },
    { ...balance, chainId: '84532' },
    { ...balance, address: 'other' },
  ])
    expect(() => parseAgentBalance(value, address, 296)).toThrow()
})
