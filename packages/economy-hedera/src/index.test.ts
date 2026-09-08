import { describe, expect, it } from 'vitest'
import {
  ECONOMY_HEDERA_EXTENSION_ID,
  isEconomyFeatureEnabled,
  readEconomyHederaConfig,
} from './index.js'

function manifestWithExtension(config: unknown) {
  return {
    spec: {
      extensions: [
        { id: ECONOMY_HEDERA_EXTENSION_ID, required: false, config },
      ],
    },
  } as never
}

describe('economy-hedera extension', () => {
  it('is undefined for games that never declared it', () => {
    expect(
      readEconomyHederaConfig({ spec: { extensions: [] } } as never),
    ).toBeUndefined()
  })

  it('defaults every feature to disabled', () => {
    const config = readEconomyHederaConfig(
      manifestWithExtension({ network: 'hedera-testnet' }),
    )
    expect(config).toBeDefined()
    expect(isEconomyFeatureEnabled(config)).toBe(false)
  })

  it('requires a stake amount when stake is enabled', () => {
    expect(() =>
      readEconomyHederaConfig(
        manifestWithExtension({
          network: 'hedera-testnet',
          escrowContractAddress: '0x1111111111111111111111111111111111111111',
          stake: { enabled: true },
        }),
      ),
    ).toThrow(/amountTinybars/)
  })

  it('requires an escrow contract address once any feature is enabled', () => {
    expect(() =>
      readEconomyHederaConfig(
        manifestWithExtension({
          network: 'hedera-testnet',
          bounty: { enabled: true },
        }),
      ),
    ).toThrow(/escrowContractAddress/)
  })

  it('accepts a fully configured stake-to-play declaration', () => {
    const config = readEconomyHederaConfig(
      manifestWithExtension({
        network: 'hedera-testnet',
        escrowContractAddress: '0x1111111111111111111111111111111111111111',
        stake: { enabled: true, amountTinybars: '100000000' },
      }),
    )
    expect(isEconomyFeatureEnabled(config)).toBe(true)
    expect(config?.stake.amountTinybars).toBe('100000000')
  })
})
