import { NETWORKS, type PaymentNetwork } from '@common-arcade/economy'

export function serviceOrigin(value: string) {
  try {
    const url = new URL(value)
    return ['https:', 'http:'].includes(url.protocol) ? url.origin : undefined
  } catch {
    return undefined
  }
}

export function analysisRecipient(value: unknown, network: PaymentNetwork) {
  const config = NETWORKS[network]
  if (!value || typeof value !== 'object') return undefined
  const document = value as { x402Version?: unknown; services?: unknown }
  if (document.x402Version !== 2 || !Array.isArray(document.services))
    return undefined
  const rail = document.services.find(
    (entry) =>
      entry?.network === config.x402Network &&
      typeof entry?.asset === 'string' &&
      entry.asset.toLowerCase() === config.asset.toLowerCase() &&
      entry?.path === `/v1/analysis/${network}` &&
      entry?.scheme === 'exact',
  )
  return typeof rail?.payTo === 'string' &&
    (network === 'hedera-testnet'
      ? /^0\.0\.[1-9]\d*$/.test(rail.payTo)
      : /^0x[0-9a-fA-F]{40}$/.test(rail.payTo))
    ? rail.payTo
    : undefined
}

export function analysisGrantProblem(
  grant:
    | {
        revoked_at: string | null
        expires_at: string
        policy: { origin: string; network: string; arcade?: unknown }
      }
    | undefined,
  origin: string,
  now = Date.now(),
) {
  if (!grant)
    return 'Create a Paid services budget, then select it under Spending permissions.'
  if (grant.policy.arcade)
    return 'Select a Paid services budget; match budgets cannot pay for analysis.'
  if (grant.revoked_at || !(Date.parse(grant.expires_at) > now))
    return 'Select an active budget. This budget has expired or been revoked.'
  if (
    !serviceOrigin(origin) ||
    serviceOrigin(grant.policy.origin) !== serviceOrigin(origin)
  )
    return 'Select a budget for Arcade’s payment service.'
  if (
    !Object.values(NETWORKS).some((n) => n.x402Network === grant.policy.network)
  )
    return 'Select a budget on a supported payment network.'
  return undefined
}
