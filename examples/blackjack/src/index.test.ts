import { it, expect } from 'vitest'
import { handValue, shuffledShoe } from './index.js'
it('handles aces, face cards, busts and seed isolation', () => {
  expect(handValue([0, 12])).toBe(21)
  expect(handValue([0, 13, 26])).toBe(13)
  expect(handValue([9, 10, 11])).toBe(30)
  expect(shuffledShoe('a')).not.toEqual(shuffledShoe('b'))
})
