import { z } from 'zod'
import { handValue } from '@common-arcade/example-blackjack'
export const analysisSchema = z
  .object({
    hand: z.array(z.number().int().min(0).max(51)).min(2).max(20),
    visibleCards: z.array(z.number().int().min(0).max(51)).max(51),
  })
  .strict()
  .superRefine((v, c) => {
    if (
      new Set(v.visibleCards).size !== v.visibleCards.length ||
      new Set(v.hand).size !== v.hand.length ||
      v.hand.some((card) => !v.visibleCards.includes(card))
    )
      c.addIssue({
        code: 'custom',
        message: 'Visible cards must be unique and include the hand',
      })
  })
/** Exact enumeration over unseen cards; no hidden game state or fake inference confidence. */
export function analyze(input: z.infer<typeof analysisSchema>) {
  const unseen = Array.from({ length: 52 }, (_, i) => i).filter(
    (c) => !input.visibleCards.includes(c),
  )
  const busts = unseen.filter(
    (card) => handValue([...input.hand, card]) > 21,
  ).length
  return {
    total: handValue(input.hand),
    evaluatedCards: unseen.length,
    bustOutcomes: busts,
    bustProbability: unseen.length ? busts / unseen.length : 0,
    suggestedAction: handValue(input.hand) < 17 ? 'hit' : 'stand',
    method: 'enumerated-one-card-risk/basic-threshold-policy',
  }
}
