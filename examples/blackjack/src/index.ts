import type { GameDefinition } from '@common-arcade/match-runtime'
import type { JsonValue } from '@common-arcade/protocol'
import { keccak256, toBytes } from 'viem'
import { BLACKJACK_DIGEST } from './release-digest.js'
export { BLACKJACK_DIGEST } from './release-digest.js'
export interface BlackjackState {
  shoe: number[]
  cursor: number
  seats: string[]
  hands: Record<string, number[]>
  stood: string[]
  turn: number
}
export const BLACKJACK_RULES =
  'blackjack-duel/v1:two-seats;single-52-card-shoe;ace-1-or-11;hit-or-stand;highest-nonbust-wins;natural-no-bonus;equal-or-both-bust-void;no-house'
export function handValue(cards: readonly number[]): number {
  let value = 0,
    aces = 0
  for (const card of cards) {
    const rank = (card % 13) + 1
    if (rank === 1) {
      value += 11
      aces++
    } else value += Math.min(rank, 10)
  }
  while (value > 21 && aces > 0) {
    value -= 10
    aces--
  }
  return value
}
export function shuffledShoe(seed: string): number[] {
  const cards = Array.from({ length: 52 }, (_, i) => i)
  let counter = 0
  for (let i = 51; i > 0; i--) {
    const bound = i + 1,
      limit = Math.floor(0x100000000 / bound) * bound
    let sample: number
    do {
      sample = Number.parseInt(
        keccak256(toBytes(JSON.stringify([seed, counter++]))).slice(2, 10),
        16,
      )
    } while (sample >= limit)
    const j = sample % bound
    ;[cards[i], cards[j]] = [cards[j]!, cards[i]!]
  }
  return cards
}
export function publicBlackjackState(state: BlackjackState): JsonValue {
  return {
    hands: state.hands,
    totals: Object.fromEntries(
      state.seats.map((s) => [s, handValue(state.hands[s]!)]),
    ),
    stood: state.stood,
    turn: state.seats[state.turn] ?? null,
  }
}
function result(state: BlackjackState): JsonValue | undefined {
  if (state.turn < state.seats.length) return undefined
  const [a, b] = state.seats
  const av = handValue(state.hands[a!]!),
    bv = handValue(state.hands[b!]!)
  if (av === bv || (av > 21 && bv > 21)) return { outcome: 'draw' }
  return {
    outcome: 'win',
    winnerSeatId: av <= 21 && (bv > 21 || av > bv) ? a! : b!,
  }
}
export const blackjackGame: GameDefinition<
  BlackjackState,
  { type: 'hit' | 'stand' }
> = {
  releaseId: 'rel_blackjack_duel_v1',
  releaseDigest: BLACKJACK_DIGEST,
  mode: 'turn-based',
  initialize({ seed, roster }) {
    if (roster.length !== 2)
      throw new Error('Blackjack duel requires two seats')
    const shoe = shuffledShoe(seed),
      seats = roster.map((s) => s.seatId)
    return {
      shoe,
      cursor: 4,
      seats,
      hands: {
        [seats[0]!]: [shoe[0]!, shoe[2]!],
        [seats[1]!]: [shoe[1]!, shoe[3]!],
      },
      stood: [],
      turn: 0,
    }
  },
  parseAction(payload) {
    if (
      !payload ||
      typeof payload !== 'object' ||
      Array.isArray(payload) ||
      !['hit', 'stand'].includes(String(payload.type)) ||
      Object.keys(payload).length !== 1
    )
      throw new Error('Expected hit or stand')
    return { type: payload.type as 'hit' | 'stand' }
  },
  validateAction(state, _action, context) {
    if (state.seats[state.turn] !== context.seatId)
      return { code: 'NOT_LEGAL', detail: 'Wait for your turn' }
    return undefined
  },
  applyAction(current, action, context) {
    const state = structuredClone(current)
    if (action.type === 'hit')
      state.hands[context.seatId]!.push(state.shoe[state.cursor++]!)
    if (
      action.type === 'stand' ||
      handValue(state.hands[context.seatId]!) >= 21
    ) {
      state.stood.push(context.seatId)
      state.turn++
    }
    return {
      state,
      events: [
        {
          type: 'blackjack.action',
          visibility: 'public',
          payload: {
            seatId: context.seatId,
            action: action.type,
            state: publicBlackjackState(state),
          },
        },
      ],
    }
  },
  // Private authoritative checkpoints retain the shoe for recovery. Public delivery uses the projection below.
  serializeState: (state) => state as unknown as JsonValue,
  projectObservation(state, seatId) {
    return {
      visibleState: publicBlackjackState(state),
      legalActions:
        state.seats[state.turn] === seatId
          ? [{ type: 'hit' }, { type: 'stand' }]
          : [],
    }
  },
  getResult: result,
}
