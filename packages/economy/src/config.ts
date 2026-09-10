import { z } from 'zod'
export const ECONOMY_EXTENSION =
  'https://arcade.agentcommons.io/extensions/payments/v0alpha1'
const units = z.string().regex(/^(0|[1-9]\d{0,29})$/)
export const economyConfigSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('free') }).strict(),
  z
    .object({
      mode: z.literal('escrow'),
      network: z.enum([
        'base-sepolia',
        'arc-testnet',
        'hedera-testnet',
        'celo-sepolia',
      ]),
      stakeUnits: units,
      bounties: z.boolean().default(false),
      spectatorBets: z.boolean().default(false),
      feeBps: z.number().int().min(0).max(1000).default(250),
      fundingSeconds: z.number().int().min(60).max(3600).default(600),
      settlementSeconds: z.number().int().min(120).max(86400).default(3600),
    })
    .strict(),
])
export type EconomyConfig = z.infer<typeof economyConfigSchema>
export function readEconomyConfig(value?: unknown): EconomyConfig {
  return economyConfigSchema.parse(value ?? { mode: 'free' })
}
