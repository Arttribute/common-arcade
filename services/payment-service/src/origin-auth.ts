import { timingSafeEqual } from 'node:crypto'

export function trustedOrigin(
  expected: string | undefined,
  supplied: string | undefined,
) {
  if (!expected) return true
  if (!supplied) return false
  const a = Buffer.from(expected),
    b = Buffer.from(supplied)
  return a.length === b.length && timingSafeEqual(a, b)
}
