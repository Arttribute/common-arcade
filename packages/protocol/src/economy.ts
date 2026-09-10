import { z } from 'zod'
/** Optional release metadata. It never authorizes a charge or enables paid play by default. */
export const GAME_ECONOMY_EXTENSION =
  'https://arcade.agentcommons.io/extensions/payments/v0alpha1'
const payoutAddress = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .refine(
    (address) => !/^0x0{40}$/.test(address),
    'Use a nonzero payout address',
  )
export const gameMonetizationSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('free') }).strict(),
  z
    .object({
      mode: z.literal('revenue-share'),
      allowedModes: z
        .array(z.enum(['sponsored', 'staked']))
        .min(1)
        .max(2),
      feeBps: z.literal(250).default(250),
      creatorShareBps: z.number().int().min(0).max(9000).default(7000),
      payouts: z
        .object({
          'base-sepolia': payoutAddress.optional(),
          'arc-testnet': payoutAddress.optional(),
          'hedera-testnet': payoutAddress.optional(),
          'celo-sepolia': payoutAddress.optional(),
        })
        .strict()
        .refine(
          (p) => Object.keys(p).length > 0,
          'Configure a testnet payout address',
        ),
      spectatorBets: z.boolean().default(false),
    })
    .strict(),
])
export type GameMonetization = z.infer<typeof gameMonetizationSchema>

export const royaltyShareSchema = z
  .object({
    recipient: payoutAddress,
    bps: z.number().int().positive().max(10000),
  })
  .strict()
export const publishedGameEconomySchema = z.discriminatedUnion('mode', [
  gameMonetizationSchema.options[0],
  gameMonetizationSchema.options[1]
    .extend({
      royalties: z
        .object({
          'base-sepolia': z.array(royaltyShareSchema).max(8).optional(),
          'arc-testnet': z.array(royaltyShareSchema).max(8).optional(),
          'hedera-testnet': z.array(royaltyShareSchema).max(8).optional(),
          'celo-sepolia': z.array(royaltyShareSchema).max(8).optional(),
        })
        .strict()
        .optional(),
    })
    .superRefine((policy, context) => {
      for (const shares of Object.values(policy.royalties ?? {}))
        if (shares.reduce((sum, share) => sum + share.bps, 0) > 10000)
          context.addIssue({
            code: 'custom',
            message: 'Royalty shares exceed creator earnings',
          })
    }),
])
export type PublishedGameEconomy = z.infer<typeof publishedGameEconomySchema>

export const GAME_REMIX_EXTENSION =
  'https://arcade.agentcommons.io/extensions/remix-royalties/v0alpha1'
