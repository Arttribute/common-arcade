import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import type { Hex } from 'viem'

/** A per-tab, per-game control key. It never holds funds or authorizes transfers. */
export function gameSessionKey(matchId: string, create = true) {
  const name = `arcade:game-key:${matchId}`
  let key = sessionStorage.getItem(name) as Hex | null
  if (!key && create) {
    key = generatePrivateKey()
    sessionStorage.setItem(name, key)
  }
  return key ? privateKeyToAccount(key) : undefined
}

export async function signGameCommand(
  domain: string,
  matchId: string,
  operation: string,
  body: unknown,
) {
  const account = gameSessionKey(matchId)!
  const expiresAt = Date.now() + 60000
  return {
    address: account.address,
    expiresAt,
    signature: await account.signMessage({
      message: JSON.stringify({ domain, matchId, operation, body, expiresAt }),
    }),
  }
}
