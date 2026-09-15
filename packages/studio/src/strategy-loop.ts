import { z } from 'zod'
import {
  coachedStrategySchema,
  executableStrategySchema,
} from './coached-strategy.js'

/**
 * Agents stay engaged by reviewing the game and updating a bounded strategy
 * script on a loop. Arcade executes the script at game speed between reviews;
 * it never invents a strategy or keeps playing for an agent that stopped.
 */
export const STRATEGY_LOOP = {
  /** Pause between realtime reviews, measured from the previous update. */
  refreshMs: 8_000,
  /** Execution stops when no update (keep or replace) arrives within this window. */
  leaseMs: 60_000,
  /** Longest a turn-based seat waits for a plan made for the current turn. */
  turnPlanningMs: 30_000,
  /** Longest a review request waits for the seat's next decision point. */
  decisionPointWaitMs: 20_000,
} as const

export const strategyUpdateSchema = z.discriminatedUnion('decision', [
  z
    .object({
      decision: z.literal('keep'),
      reason: z.string().trim().min(1).max(1000),
    })
    .strict(),
  coachedStrategySchema.extend({ decision: z.literal('replace') }).strict(),
])
export type StrategyUpdate = z.infer<typeof strategyUpdateSchema>

/** Legacy coaching proposals are complete replacements. */
export function parseStrategyUpdate(value: unknown): StrategyUpdate {
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    'decision' in value
  )
    return strategyUpdateSchema.parse(value)
  return { decision: 'replace', ...coachedStrategySchema.parse(value) }
}

export type StrategyFeedbackSample = {
  outcome: 'positive' | 'negative' | 'neutral' | 'unknown'
  reward: number
  summary: string
}

export type StrategyPerformanceWindow = {
  startedAt: number
  decisions: number
  submitted: number
  rejected: number
  lastRejection?: string
  actions: Record<string, number>
  ruleHits: Record<string, number>
  reward: number
  positive: number
  negative: number
  recentFeedback: string[]
}

export type StrategyPerformanceReport = {
  windowMs: number
  decisions: number
  submittedActions: number
  rejectedActions: number
  lastRejection?: string
  topActions: { action: string; count: number }[]
  /** Rule index → times it contributed to the chosen action. Unused rules are dead weight. */
  ruleHits: Record<string, number>
  unusedRules: number[]
  reward: { total: number; positive: number; negative: number }
  recentFeedback: string[]
  gameFeedback?: unknown
}

export type StrategyHistoryEntry = {
  strategyEpoch: number
  strategy: string
  reason: string
  decisions: number
  reward: number
  activeMs: number
}

export function emptyPerformanceWindow(now: number): StrategyPerformanceWindow {
  return {
    startedAt: now,
    decisions: 0,
    submitted: 0,
    rejected: 0,
    actions: {},
    ruleHits: {},
    reward: 0,
    positive: 0,
    negative: 0,
    recentFeedback: [],
  }
}

export function recordStrategyDecision(
  window: StrategyPerformanceWindow,
  action: string,
  matchedRules: readonly number[],
) {
  window.decisions++
  const key = action.slice(0, 120)
  if (key in window.actions || Object.keys(window.actions).length < 40)
    window.actions[key] = (window.actions[key] ?? 0) + 1
  for (const index of matchedRules)
    window.ruleHits[index] = (window.ruleHits[index] ?? 0) + 1
}

export function recordStrategySubmission(
  window: StrategyPerformanceWindow,
  disposition: string,
  detail?: string,
) {
  window.submitted++
  if (disposition === 'accepted' || disposition === 'duplicate') return
  window.rejected++
  window.lastRejection = `${disposition}${detail ? `: ${detail}` : ''}`.slice(
    0,
    300,
  )
}

export function recordStrategyFeedback(
  window: StrategyPerformanceWindow,
  feedback: StrategyFeedbackSample | undefined,
) {
  if (!feedback || feedback.outcome === 'unknown') return
  window.reward += feedback.reward
  if (feedback.outcome === 'positive') window.positive++
  if (feedback.outcome === 'negative') window.negative++
  if (feedback.outcome === 'neutral' || !feedback.summary) return
  const summary = feedback.summary.slice(0, 200)
  if (window.recentFeedback.at(-1) === summary) return
  window.recentFeedback.push(summary)
  if (window.recentFeedback.length > 6) window.recentFeedback.shift()
}

export function summarizeStrategyPerformance(
  window: StrategyPerformanceWindow,
  now: number,
  ruleCount: number,
  gameFeedback?: unknown,
): StrategyPerformanceReport {
  return {
    windowMs: Math.max(0, now - window.startedAt),
    decisions: window.decisions,
    submittedActions: window.submitted,
    rejectedActions: window.rejected,
    ...(window.lastRejection ? { lastRejection: window.lastRejection } : {}),
    topActions: Object.entries(window.actions)
      .sort(([, left], [, right]) => right - left)
      .slice(0, 8)
      .map(([action, count]) => ({ action, count })),
    ruleHits: { ...window.ruleHits },
    unusedRules: Array.from({ length: ruleCount }, (_, index) => index).filter(
      (index) => !window.ruleHits[index],
    ),
    reward: {
      total: Math.round(window.reward * 100) / 100,
      positive: window.positive,
      negative: window.negative,
    },
    recentFeedback: [...window.recentFeedback],
    ...(gameFeedback === undefined ? {} : { gameFeedback }),
  }
}

export type StrategyContext = {
  requestId: string
  controllerId: string
  matchId: string
  seatId: string
  mode: string
  status: string
  strategy: string
  strategyEpoch: number
  executableStrategy?: z.infer<typeof executableStrategySchema>
  lastReason?: string
  /** False when the seat has no strategy or its lease lapsed: nothing is executing. */
  engaged: boolean
  leaseExpiresAt: string | null
  decisionPoint: {
    /** Discrete games: the seat can act now and no plan was made for this state yet. */
    ready: boolean
    stateSequence: number
    turn?: number
    deadlineAt?: string
  }
  observation: { state: unknown; actions: { id: string; label: string }[] }
  performance: StrategyPerformanceReport
  history: StrategyHistoryEntry[]
  cadence: {
    refreshMs: number
    leaseMs: number
    turnPlanningMs: number
    maxDecisionsPerSecond: number
  }
  series: {
    round: number
    maximumRounds: number
    scores: Record<string, number>
  }
}
