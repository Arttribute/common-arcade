import { defineChain, type Address, type Chain } from 'viem'
import { base, baseSepolia } from 'viem/chains'
export type PaymentNetwork =
  'base-sepolia' | 'arc-testnet' | 'hedera-testnet' | 'base'
export interface NetworkConfig {
  id: PaymentNetwork
  chain: Chain
  x402Network: `${string}:${string}`
  asset: string
  token: Address
  decimals: 6
  testnet: boolean
  explorer: string
}
export const NETWORKS: Record<PaymentNetwork, NetworkConfig> = {
  'base-sepolia': {
    id: 'base-sepolia',
    chain: baseSepolia,
    x402Network: 'eip155:84532',
    asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    token: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    decimals: 6,
    testnet: true,
    explorer: 'https://sepolia.basescan.org',
  },
  'arc-testnet': {
    id: 'arc-testnet',
    chain: defineChain({
      id: 5042002,
      name: 'Arc Testnet',
      nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
      rpcUrls: { default: { http: ['https://rpc.testnet.arc.io'] } },
      testnet: true,
    }),
    x402Network: 'eip155:5042002',
    asset: '0x3600000000000000000000000000000000000000',
    token: '0x3600000000000000000000000000000000000000',
    decimals: 6,
    testnet: true,
    explorer: 'https://testnet.arcscan.app',
  },
  'hedera-testnet': {
    id: 'hedera-testnet',
    chain: defineChain({
      id: 296,
      name: 'Hedera Testnet',
      nativeCurrency: { name: 'HBAR', symbol: 'HBAR', decimals: 18 },
      rpcUrls: { default: { http: ['https://testnet.hashio.io/api'] } },
      testnet: true,
    }),
    x402Network: 'hedera:testnet',
    asset: '0.0.429274',
    token: '0x0000000000000000000000000000000000068cda',
    decimals: 6,
    testnet: true,
    explorer: 'https://hashscan.io/testnet',
  },
  base: {
    id: 'base',
    chain: base,
    x402Network: 'eip155:8453',
    asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    decimals: 6,
    testnet: false,
    explorer: 'https://basescan.org',
  },
}
/** Never round user-entered money, or use JavaScript numbers for atomic amounts. */
export function usdcUnits(value: string): bigint {
  if (!/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(value))
    throw new Error('Use a non-negative USDC amount with at most six decimals')
  const [whole, fraction = ''] = value.split('.')
  const result = BigInt(whole!) * 1_000_000n + BigInt(fraction.padEnd(6, '0'))
  if (result >= 2n ** 256n) throw new Error('Amount exceeds uint256')
  return result
}
