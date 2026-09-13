import { describe, it, expect } from 'vitest'
import {
  readEconomyConfig,
  usdcUnits,
  poolId,
  NETWORKS,
  approvalCall,
} from './index.js'
const contract = '0x1111111111111111111111111111111111111111'
describe('optional game-neutral economy', () => {
  it('rejects host overrides of the platform success fee', () => {
    const payment = {
      mode: 'escrow',
      network: 'base-sepolia',
      stakeUnits: '1000000',
    }
    expect(readEconomyConfig(payment)).toMatchObject({ feeBps: 250 })
    for (const feeBps of [0, 100, 500, 1000])
      expect(() => readEconomyConfig({ ...payment, feeBps })).toThrow()
  })

  it('defaults to free and rejects implicit or mainnet activation', () => {
    expect(readEconomyConfig()).toEqual({ mode: 'free' })
    expect(() => readEconomyConfig({ network: 'base-sepolia' })).toThrow()
    expect(() =>
      readEconomyConfig({ mode: 'escrow', network: 'base', stakeUnits: '1' }),
    ).toThrow()
  })
  it('uses exact six-decimal money', () => {
    expect(usdcUnits('123.000001')).toBe(123000001n)
    for (const amount of ['1e3', '-1', '0.0000001', 'NaN', '01', '1.'])
      expect(() => usdcUnits(amount)).toThrow()
    expect(NETWORKS['arc-testnet'].decimals).toBe(6)
  })
  it('accepts Celo Sepolia payments and rejects obsolete or mainnet Celo rails', () => {
    expect(
      readEconomyConfig({
        mode: 'escrow',
        network: 'celo-sepolia',
        stakeUnits: '1000000',
      }).mode,
    ).toBe('escrow')
    for (const network of ['celo', 'celo-alfajores'])
      expect(() =>
        readEconomyConfig({ mode: 'escrow', network, stakeUnits: '1000000' }),
      ).toThrow()
  })
  it('isolates chains, rounds and deployments', () => {
    expect(poolId(296, contract, 'mat_a', 'digest', 1)).not.toBe(
      poolId(84532, contract, 'mat_a', 'digest', 1),
    )
    expect(poolId(296, contract, 'mat_a', 'digest', 1)).not.toBe(
      poolId(296, contract, 'mat_a', 'digest', 2),
    )
  })
  it('never constructs unlimited allowances by default', () => {
    expect(() =>
      approvalCall({ contract, token: contract, chainId: 296 }, 0n),
    ).toThrow()
  })
})
