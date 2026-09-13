/** Public hosting still requires a valid, expiring wallet signature. */
export function paidHostAllowlist(mode?: string, creators = '') {
  if (mode === 'public') return undefined
  if (mode && mode !== 'restricted')
    throw new Error('ARCADE_PAYMENT_HOSTING must be public or restricted')
  return new Set(
    creators
      .split(',')
      .map((a) => a.trim().toLowerCase())
      .filter(Boolean),
  )
}
