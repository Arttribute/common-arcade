import { describe, expect, it } from 'vitest'
import { hashArcadeId } from '@common-arcade/economy'
import { preparePaymentBudget, type PaymentBudgetDraft } from './payment-budget'

const draft = (): PaymentBudgetDraft => ({
  agentId: 'agent_player',
  agentName: 'Player',
  walletId: 'wallet_player',
  runtime: 'session_game',
  kind: 'arcade',
  network: 'base-sepolia',
  recipient: '0x' + '3'.repeat(40),
  origin: 'https://payments.example',
  budget: '5',
  perPayment: '1',
  minutes: '60',
  seat: 'sea_player_2',
  operations: { stake: true, bounty: false, bet: false },
  table: {
    id: 'mat_game',
    pool: '0x' + 'a'.repeat(64),
    deployment: { contract: '0x' + '2'.repeat(40), chainId: 84532 },
    economy: { mode: 'escrow', network: 'base-sepolia' },
  },
})

describe('reviewed payment permission', () => {
  it('captures exact match, seat, recipient, budget and operations independently of later form changes', () => {
    const input = draft()
    const reviewed = preparePaymentBudget(input)
    input.kind = 'x402'
    input.network = 'hedera-testnet'
    input.budget = '500'
    input.operations.bet = true
    input.seat = 'sea_player_1'
    input.table!.pool = 'different-pool'
    expect(reviewed.kind).toBe('arcade')
    expect(reviewed.permission).toBe('This match · Player 2 · stake')
    expect(reviewed.body).toEqual({
      walletId: 'wallet_player',
      runtimeSessionId: 'session_game',
      budgetUnits: '5000000',
      policy: {
        network: 'eip155:84532',
        asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        payTo: '0x' + '2'.repeat(40),
        origin: 'https://payments.example',
        maxPaymentUnits: '1000000',
        arcade: {
          poolId: '0x' + 'a'.repeat(64),
          matchId: 'mat_game',
          seatId: hashArcadeId('sea_player_2'),
          allowedOperations: ['stake'],
        },
      },
    })
  })
  it('rejects empty select-reset values instead of silently making an unscoped service grant', () => {
    expect(() =>
      preparePaymentBudget({
        ...draft(),
        kind: '' as PaymentBudgetDraft['kind'],
      }),
    ).toThrow('what this budget is for')
    expect(() => preparePaymentBudget({ ...draft(), seat: '' })).toThrow(
      'player seat',
    )
  })
  it('requires complete matching escrow context for a match permission', () => {
    expect(() =>
      preparePaymentBudget({ ...draft(), table: undefined }),
    ).toThrow('Open a funded match')
    expect(() =>
      preparePaymentBudget({ ...draft(), network: 'hedera-testnet' }),
    ).toThrow('network must match')
  })
  it('creates service permissions only when explicitly selected', () => {
    const reviewed = preparePaymentBudget({ ...draft(), kind: 'x402' })
    expect(reviewed.body.policy).not.toHaveProperty('arcade')
    expect(reviewed.body.policy.payTo).toBe('0x' + '3'.repeat(40))
  })
  it('rejects a per-payment cap greater than the total reviewed budget', () => {
    expect(() =>
      preparePaymentBudget({ ...draft(), perPayment: '10' }),
    ).toThrow('no higher than the total')
  })
})
