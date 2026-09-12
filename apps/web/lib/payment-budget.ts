import {
  NETWORKS,
  hashArcadeId,
  usdcUnits,
  type PaymentNetwork,
} from '@common-arcade/economy'

export interface PaymentBudgetDraft {
  agentId: string
  agentName: string
  walletId: string
  walletAddress?: string
  runtime: string
  kind: 'x402' | 'arcade'
  network: PaymentNetwork
  recipient: string
  origin: string
  budget: string
  perPayment: string
  minutes: string
  seat: string
  operations: { stake: boolean; bounty: boolean; bet: boolean }
  table?: {
    id: string
    pool?: string
    deployment?: { contract: string; chainId: number }
    economy: { mode: string; network?: string }
  }
}

/** Capture exactly what the user reviews; subsequent form events cannot broaden a grant. */
export function preparePaymentBudget(draft: PaymentBudgetDraft) {
  if (draft.kind !== 'arcade' && draft.kind !== 'x402')
    throw new Error('Choose what this budget is for.')
  const config = NETWORKS[draft.network]
  if (!config) throw new Error('Choose a payment network.')
  if (!draft.agentId || !draft.walletId)
    throw new Error('Choose an agent with an active payment wallet.')
  const total = usdcUnits(draft.budget)
  const cap = usdcUnits(draft.perPayment)
  if (total <= 0n || cap <= 0n || cap > total)
    throw new Error(
      'Use a positive budget and a per-payment cap no higher than the total.',
    )
  if (!draft.runtime.trim())
    throw new Error('Choose the agent session this budget belongs to.')
  const minutes = Number(draft.minutes)
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440)
    throw new Error('Budget expiry must be between 1 and 1440 minutes.')
  const origin = new URL(draft.origin)
  if (!['http:', 'https:'].includes(origin.protocol))
    throw new Error('Use an HTTP or HTTPS service origin.')
  const allowedOperations = Object.entries(draft.operations)
    .filter(([, allowed]) => allowed)
    .map(([operation]) => operation)
  let arcade:
    | {
        poolId: string
        matchId: string
        seatId: string
        allowedOperations: string[]
      }
    | undefined
  if (draft.kind === 'arcade') {
    const table = draft.table
    if (!table?.pool || !table.deployment || table.economy.mode !== 'escrow')
      throw new Error('Open a funded match before creating a match budget.')
    if (
      table.economy.network !== draft.network ||
      table.deployment.chainId !== config.chain.id
    )
      throw new Error('The budget network must match the table.')
    if (draft.seat !== 'sea_player_1' && draft.seat !== 'sea_player_2')
      throw new Error('Choose a player seat.')
    if (!allowedOperations.length)
      throw new Error('Choose at least one permitted match action.')
    arcade = {
      poolId: table.pool,
      matchId: table.id,
      seatId: hashArcadeId(draft.seat),
      allowedOperations,
    }
  }
  const payTo = (
    draft.kind === 'arcade'
      ? draft.table!.deployment!.contract
      : draft.recipient
  ).trim()
  if (!payTo) throw new Error('Choose a payment recipient.')
  return {
    agentId: draft.agentId,
    agentName: draft.agentName,
    walletAddress: draft.walletAddress ?? draft.walletId,
    kind: draft.kind,
    network: draft.network,
    minutes,
    permission:
      draft.kind === 'arcade'
        ? `This match · ${draft.seat === 'sea_player_1' ? 'Player 1' : 'Player 2'} · ${allowedOperations.join(', ')}`
        : 'Paid services',
    body: {
      walletId: draft.walletId,
      runtimeSessionId: draft.runtime.trim(),
      budgetUnits: total.toString(),
      policy: {
        network: config.x402Network,
        asset: config.asset,
        payTo,
        origin: origin.origin,
        maxPaymentUnits: cap.toString(),
        ...(arcade ? { arcade } : {}),
      },
    },
  }
}
export type ReviewedPaymentBudget = ReturnType<typeof preparePaymentBudget>
