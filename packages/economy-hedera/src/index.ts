import { z } from 'zod'
import type { GameManifest } from '@common-arcade/protocol'

/**
 * Opt-in game economy on Hedera: per-match bounties, per-seat stakes, and
 * (testnet-only, for now) spectator betting, backed by the MatchEscrow
 * contract in this package. Disabled unless a game manifest explicitly
 * declares this extension — every other game and every human/agent who
 * doesn't opt in sees no change in behavior.
 *
 * This is a distinct extension id from
 * `https://arcade.agentcommons.io/extensions/economy/v1` (RFC 0001), which
 * is explicitly metadata-only and never activates payments. This id is the
 * activating one.
 */
export const ECONOMY_HEDERA_EXTENSION_ID =
  'https://arcade.agentcommons.io/extensions/economy-hedera/v1'

export const hederaNetworkSchema = z.enum(['hedera-testnet', 'hedera-mainnet'])
export type EconomyHederaNetwork = z.infer<typeof hederaNetworkSchema>

export const bountyConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
  })
  .strict()

export const stakeConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    /** Required stake per seat, in tinybars (string to avoid float/precision loss). */
    amountTinybars: z
      .string()
      .regex(/^[0-9]+$/)
      .optional(),
  })
  .strict()
  .refine((value) => !value.enabled || value.amountTinybars !== undefined, {
    message: 'amountTinybars is required when stake.enabled is true',
    path: ['amountTinybars'],
  })

export const bettingConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
  })
  .strict()

export const economyHederaConfigSchema = z
  .object({
    network: hederaNetworkSchema,
    /** MatchEscrow contract address (0x...) on the configured network. */
    escrowContractAddress: z
      .string()
      .regex(/^0x[0-9a-fA-F]{40}$/)
      .optional(),
    bounty: bountyConfigSchema.default({ enabled: false }),
    stake: stakeConfigSchema.default({ enabled: false }),
    betting: bettingConfigSchema.default({ enabled: false }),
  })
  .strict()
  .refine(
    (value) =>
      !(value.bounty.enabled || value.stake.enabled || value.betting.enabled) ||
      value.escrowContractAddress !== undefined,
    {
      message:
        'escrowContractAddress is required when any economy feature is enabled',
      path: ['escrowContractAddress'],
    },
  )

export type EconomyHederaConfig = z.infer<typeof economyHederaConfigSchema>

/**
 * Reads and validates this game's economy-hedera/v1 declaration, if any.
 * Returns `undefined` for every game that hasn't opted in — callers should
 * treat that as "economy features are off," not as an error.
 */
export function readEconomyHederaConfig(
  manifest: Pick<GameManifest, 'spec'>,
): EconomyHederaConfig | undefined {
  const declaration = manifest.spec.extensions.find(
    (extension) => extension.id === ECONOMY_HEDERA_EXTENSION_ID,
  )
  if (!declaration) return undefined
  return economyHederaConfigSchema.parse(declaration.config)
}

export function isEconomyFeatureEnabled(
  config: EconomyHederaConfig | undefined,
): boolean {
  if (!config) return false
  return config.bounty.enabled || config.stake.enabled || config.betting.enabled
}
