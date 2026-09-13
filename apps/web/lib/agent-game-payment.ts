import { formatUnits } from 'viem'
import {
  NETWORKS,
  hashArcadeId,
  usdcUnits,
  type EconomyConfig,
  type EscrowDeployment,
} from '@common-arcade/economy'
import { preparePaymentBudget } from './payment-budget'
import { paymentService } from './paid-session'

export interface PaidLobby {
  id: string
  pool?: `0x${string}`
  deployment?: EscrowDeployment
  economy: Extract<EconomyConfig, { mode: 'escrow' }>
  recipients: `0x${string}`[]
  funded?: boolean[]
}
export interface AgentGrant {
  id: string
  wallet_id: string
  runtime_session_id: string
  expires_at: string
  revoked_at: string | null
  budget_units: string
  reserved_units: string
  policy: {
    network: string
    origin: string
    payTo: string
    maxPaymentUnits: string
    arcade?: {
      matchId: string
      poolId: string
      seatId: string
      allowedOperations: string[]
    }
  }
}
export async function agentWalletApi<T>(
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api/agent-wallets/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const result = await response.json()
  if (!response.ok)
    throw new Error(
      result.message ?? result.error ?? 'Agent wallet unavailable',
    )
  return result
}

/** Called only from an explicit budget approval or a retry of that same operation. */
export async function payWithAgent(input: {
  table: PaidLobby
  agentId: string
  agentName: string
  seat: number
  operation: 'stake' | 'bet' | 'bounty'
  amount: string
  budget: string
  idempotencyKey: string
  onProgress: (message: string) => void
}) {
  const { table, agentId, seat, operation } = input
  const units =
    operation === 'stake'
      ? BigInt(table.economy.stakeUnits)
      : usdcUnits(input.amount)
  const budget = usdcUnits(input.budget)
  if (budget < units || budget <= 0n)
    throw new Error('The game budget must cover this amount.')
  const capabilities = await agentWalletApi<{ autonomousPlay?: boolean }>(
    `wallets/agent/${agentId}/payment-capabilities`,
  )
  if (operation === 'stake' && !capabilities.autonomousPlay)
    throw new Error(
      'Agent play is awaiting the wallet service update. No payment was requested.',
    )
  const wallets = await agentWalletApi<
    { id: string; address: string; walletType: string; isActive: boolean }[]
  >(`wallets/agent/${agentId}`)
  const wallet = wallets.find((w) => w.isActive && w.walletType === 'eoa')
  if (!wallet)
    throw new Error('This agent needs an active Commons payment wallet.')
  const grants = await agentWalletApi<AgentGrant[]>(
    `wallets/agent/${agentId}/payment-sessions`,
  )
  const config = NETWORKS[table.economy.network]
  const seatId = hashArcadeId(`sea_player_${seat + 1}`)
  const ownsSeat =
    operation === 'stake' &&
    table.recipients[seat]?.toLowerCase() === wallet.address.toLowerCase() &&
    table.funded?.[seat]
  if (operation === 'stake' && table.funded?.[seat] && !ownsSeat)
    throw new Error(
      'This seat belongs to a different wallet. Select the agent that took it.',
    )
  const bound = grants.filter(
    (g) =>
      g.wallet_id === wallet.id &&
      g.policy.network === config.x402Network &&
      g.policy.origin === paymentService &&
      g.policy.payTo.toLowerCase() ===
        table.deployment?.contract.toLowerCase() &&
      g.policy.arcade?.matchId === table.id &&
      g.policy.arcade.poolId === table.pool &&
      g.policy.arcade.seatId === seatId &&
      g.policy.arcade.allowedOperations.includes(operation),
  )
  let transaction: string | undefined
  // Reconcile the request across grants BEFORE considering a fresh budget. An exhausted
  // or revoked grant may still contain a submitted transfer whose response was lost.
  for (const previous of bound) {
    const attempts = await agentWalletApi<
      {
        idempotency_key: string
        state: string
        settlement?: { transaction?: string }
      }[]
    >(`wallets/agent/${agentId}/payment-sessions/${previous.id}/attempts`)
    const attempt = attempts.find(
      (a) => a.idempotency_key === input.idempotencyKey,
    )
    if (!attempt) continue
    if (attempt.state !== 'settled')
      throw new Error(
        'This payment was already submitted. Check its receipt before retrying; no additional payment has been sent.',
      )
    transaction = attempt.settlement?.transaction
    if (!transaction)
      throw new Error(
        'Payment is recorded. Its receipt is not available yet; no additional payment has been sent.',
      )
    break
  }
  let grant = bound.find(
    (g) =>
      g.wallet_id === wallet.id &&
      !g.revoked_at &&
      new Date(g.expires_at).getTime() > Date.now() + 30000 &&
      g.policy.network === config.x402Network &&
      g.policy.origin === paymentService &&
      g.policy.payTo.toLowerCase() ===
        table.deployment?.contract.toLowerCase() &&
      g.policy.arcade?.matchId === table.id &&
      g.policy.arcade.poolId === table.pool &&
      g.policy.arcade.seatId === seatId &&
      g.policy.arcade.allowedOperations.includes(operation) &&
      (ownsSeat ||
        transaction ||
        (BigInt(g.budget_units) - BigInt(g.reserved_units) >= units &&
          BigInt(g.policy.maxPaymentUnits) >= units)),
  )
  if (!grant) {
    const reviewed = preparePaymentBudget({
      agentId,
      agentName: input.agentName,
      walletId: wallet.id,
      walletAddress: wallet.address,
      runtime: `arcade:${table.id}:${agentId}`,
      kind: 'arcade',
      network: table.economy.network,
      recipient: '',
      origin: paymentService,
      budget: input.budget,
      perPayment: units > 0n ? formatUnits(units, 6) : input.budget,
      minutes: '60',
      seat: `sea_player_${seat + 1}`,
      operations: {
        stake: operation === 'stake',
        bet: operation === 'bet',
        bounty: operation === 'bounty',
      },
      table,
    })
    grant = await agentWalletApi<AgentGrant>(
      `wallets/agent/${agentId}/payment-sessions`,
      {
        ...reviewed.body,
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      },
    )
  }
  if (!ownsSeat && !transaction) {
    input.onProgress('Your agent is paying from its own wallet…')
    const result = await agentWalletApi<{ transaction: string }>(
      `wallets/agent/${agentId}/arcade/deposit`,
      {
        paymentSessionId: grant.id,
        runtimeSessionId: grant.runtime_session_id,
        idempotencyKey: input.idempotencyKey,
        operation,
        ...(operation === 'stake' ? {} : { amountUnits: units.toString() }),
      },
    )
    transaction = result.transaction
  }
  if (operation === 'stake') {
    input.onProgress('Seat paid. Starting your agent…')
    await agentWalletApi(`wallets/agent/${agentId}/arcade/autoplay`, {
      paymentSessionId: grant.id,
      runtimeSessionId: grant.runtime_session_id,
      enabled: true,
    })
  }
  return { grant, transaction, address: wallet.address }
}
