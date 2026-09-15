import { afterEach, expect, it, vi } from 'vitest'
import type { StrategyContext } from '@common-arcade/studio'
import { reviewStrategy } from './coaching.js'

afterEach(() => vi.unstubAllGlobals())

const principal = {
  id: 'owner',
  token: 'test',
  provider: 'commons' as const,
  scopes: ['matches:play'],
}
const context: StrategyContext = {
  requestId: 'strategy_1',
  controllerId: 'commons-agent-driver',
  matchId: 'mat_1',
  seatId: 'seat-1',
  mode: 'realtime',
  status: 'running',
  strategy: 'Hold the racing line.',
  strategyEpoch: 2,
  executableStrategy: { actionWeights: {}, avoidActions: [], rules: [] },
  lastReason: 'Cleaner corners.',
  engaged: true,
  leaseExpiresAt: new Date().toISOString(),
  decisionPoint: { ready: true, stateSequence: 40 },
  observation: {
    state: { you: { speedPercent: 0.4, offRoad: false } },
    actions: [
      { id: 'accelerate-1a2b3c4d', label: 'accelerate {"id":"accelerate"}' },
      { id: 'brake-5e6f7a8b', label: 'brake {"id":"brake"}' },
    ],
  },
  performance: {
    windowMs: 8000,
    decisions: 70,
    submittedActions: 12,
    rejectedActions: 0,
    topActions: [{ action: 'brake-5e6f7a8b', count: 60 }],
    ruleHits: {},
    unusedRules: [],
    reward: { total: -4, positive: 1, negative: 9 },
    recentFeedback: ['progressDelta +0.1 after brake'],
  },
  history: [],
  cadence: {
    refreshMs: 8000,
    leaseMs: 60000,
    turnPlanningMs: 30000,
    maxDecisionsPerSecond: 10,
  },
  series: { round: 1, maximumRounds: 1, scores: {} },
}

it('sends the performance report, continues the Commons session and returns a replacement', async () => {
  const bodies: any[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)))
      return new Response(
        `data: ${JSON.stringify({ type: 'status', sessionId: 'ses_42' })}\n\n` +
          `data: ${JSON.stringify({
            type: 'token',
            phase: 'final_answer',
            content: JSON.stringify({
              decision: 'replace',
              strategy: 'Stop braking on straights.',
              reason: 'Braking dominated and reward was negative.',
              executableStrategy: {
                actionWeights: { accelerate: 40 },
                avoidActions: [],
                rules: [
                  {
                    when: [
                      { path: 'state.you.offRoad', op: 'eq', value: false },
                    ],
                    actionId: 'accelerate',
                    weight: 30,
                  },
                ],
              },
            }),
          })}\n\ndata: {"type":"final"}\n\n`,
        { headers: { 'Content-Type': 'text/event-stream' } },
      )
    }),
  )
  let sessionId: string | undefined
  const update = await reviewStrategy(principal, 'driver', context, {
    note: 'Be braver.',
    sessionId: 'ses_41',
    onSessionId: (id) => {
      sessionId = id
    },
  })
  expect(update.decision).toBe('replace')
  if (update.decision !== 'replace') return
  // State-relative paths are normalized.
  expect(update.executableStrategy.rules[0]!.when[0]!.path).toBe('you.offRoad')
  expect(sessionId).toBe('ses_42')
  expect(bodies[0]).toMatchObject({ agentId: 'driver', sessionId: 'ses_41' })
  const prompt = bodies[0].messages[0].content as string
  expect(prompt).toContain('performanceSinceLastReview')
  expect(prompt).toContain('"brake-5e6f7a8b","count":60')
  expect(prompt).toContain('Be braver.')
})

it('accepts a keep decision', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          `data: ${JSON.stringify({
            type: 'token',
            phase: 'final_answer',
            content: '{"decision":"keep","reason":"Lap times are improving."}',
          })}\n\ndata: {"type":"final"}\n\n`,
        ),
    ),
  )
  expect(await reviewStrategy(principal, 'driver', context)).toEqual({
    decision: 'keep',
    reason: 'Lap times are improving.',
  })
})
