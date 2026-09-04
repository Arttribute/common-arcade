import type { JsonValue } from '@common-arcade/protocol'
import type {
  GameDefinition,
  GameEventDraft,
  GameInitializationContext,
} from './index.js'

export interface GridPlacementRuleSet {
  readonly kind: 'grid-placement'
  readonly releaseId: string
  readonly releaseDigest: string
  readonly marks: readonly string[]
  readonly cellCount: number
  readonly winningLines: readonly (readonly number[])[]
  readonly objective: string
}

export interface GridPlacementState {
  readonly board: readonly (string | null)[]
  readonly seats: readonly string[]
  readonly currentSeatId: string
  readonly turn: number
  readonly winnerSeatId: string | null
  readonly draw: boolean
}

export interface GridPlacementAction {
  readonly type: 'place'
  readonly cell: number
}

function validateRules(rules: GridPlacementRuleSet): void {
  if (!Number.isInteger(rules.cellCount) || rules.cellCount < 1) {
    throw new TypeError('cellCount must be a positive integer')
  }
  if (
    rules.marks.length < 2 ||
    new Set(rules.marks).size !== rules.marks.length
  ) {
    throw new TypeError('marks must contain at least two unique values')
  }
  if (
    rules.winningLines.length === 0 ||
    rules.winningLines.some(
      (line) =>
        line.length < 2 ||
        line.some(
          (cell) =>
            !Number.isInteger(cell) || cell < 0 || cell >= rules.cellCount,
        ),
    )
  ) {
    throw new TypeError('winningLines must reference valid cells')
  }
}

function initialize(
  rules: GridPlacementRuleSet,
  context: GameInitializationContext,
): GridPlacementState {
  if (context.roster.length !== rules.marks.length) {
    throw new RangeError(
      `Grid placement requires ${rules.marks.length} roster entries`,
    )
  }
  const first = context.roster[0]
  if (first === undefined) throw new RangeError('The roster cannot be empty')
  return {
    board: Array<string | null>(rules.cellCount).fill(null),
    seats: context.roster.map((entry) => entry.seatId),
    currentSeatId: first.seatId,
    turn: 1,
    winnerSeatId: null,
    draw: false,
  }
}

function parseAction(payload: JsonValue): GridPlacementAction {
  if (
    payload === null ||
    Array.isArray(payload) ||
    typeof payload !== 'object' ||
    payload.type !== 'place' ||
    typeof payload.cell !== 'number' ||
    !Number.isInteger(payload.cell) ||
    Object.keys(payload).some((key) => key !== 'type' && key !== 'cell')
  ) {
    throw new TypeError('Expected a place action with an integer cell')
  }
  return { type: 'place', cell: payload.cell }
}

function serializeState(state: GridPlacementState): JsonValue {
  return {
    board: [...state.board],
    seats: [...state.seats],
    currentSeatId: state.currentSeatId,
    turn: state.turn,
    winnerSeatId: state.winnerSeatId,
    draw: state.draw,
  }
}

function winningMark(
  rules: GridPlacementRuleSet,
  board: readonly (string | null)[],
): string | undefined {
  for (const line of rules.winningLines) {
    const firstIndex = line[0]
    if (firstIndex === undefined) continue
    const mark = board[firstIndex]
    if (mark !== null && line.every((cell) => board[cell] === mark)) return mark
  }
  return undefined
}

export function createGridPlacementGame(
  rules: GridPlacementRuleSet,
): GameDefinition<GridPlacementState, GridPlacementAction> {
  validateRules(rules)
  return {
    releaseId: rules.releaseId,
    releaseDigest: rules.releaseDigest,
    mode: 'turn-based',
    initialize(context) {
      return initialize(rules, context)
    },
    parseAction,
    validateAction(state, action, context) {
      if (state.winnerSeatId !== null || state.draw) {
        return { code: 'MATCH_NOT_RUNNING', detail: 'The game is complete' }
      }
      if (context.seatId !== state.currentSeatId) {
        return { code: 'NOT_LEGAL', detail: 'It is another seat’s turn' }
      }
      if (action.cell < 0 || action.cell >= rules.cellCount) {
        return { code: 'NOT_LEGAL', detail: 'Cell is outside the board' }
      }
      if (state.board[action.cell] !== null) {
        return { code: 'NOT_LEGAL', detail: 'That cell is occupied' }
      }
      return undefined
    },
    applyAction(state, action, context) {
      const board = [...state.board]
      const seatIndex = state.seats.indexOf(context.seatId)
      const mark = rules.marks[seatIndex]
      if (mark === undefined) throw new Error('Seat has no configured mark')
      board[action.cell] = mark
      const winner = winningMark(rules, board)
      const winnerIndex =
        winner === undefined ? -1 : rules.marks.indexOf(winner)
      const winnerSeatId =
        winnerIndex < 0 ? null : (state.seats[winnerIndex] ?? null)
      const draw = winnerSeatId === null && board.every((cell) => cell !== null)
      const nextSeatIndex = (seatIndex + 1) % state.seats.length
      const nextSeatId = state.seats[nextSeatIndex]
      if (nextSeatId === undefined) throw new Error('No next seat is available')
      const nextState: GridPlacementState = {
        board,
        seats: state.seats,
        currentSeatId:
          winnerSeatId !== null || draw ? state.currentSeatId : nextSeatId,
        turn: state.turn + 1,
        winnerSeatId,
        draw,
      }
      const events: GameEventDraft[] = [
        {
          type: 'game.move',
          visibility: 'public',
          payload: { seatId: context.seatId, mark, cell: action.cell },
        },
      ]
      if (winnerSeatId !== null) {
        events.push({
          type: 'game.won',
          visibility: 'public',
          payload: { winnerSeatId },
        })
      } else if (draw) {
        events.push({
          type: 'game.draw',
          visibility: 'public',
          payload: {},
        })
      }
      return { state: nextState, events }
    },
    serializeState,
    projectObservation(state, seatId) {
      const seatIndex = state.seats.indexOf(seatId)
      const legalActions =
        state.winnerSeatId === null &&
        !state.draw &&
        state.currentSeatId === seatId
          ? state.board.flatMap((cell, index) =>
              cell === null ? [{ type: 'place', cell: index }] : [],
            )
          : []
      return {
        visibleState: serializeState(state),
        legalActions,
        feedback: {
          objective: rules.objective,
          yourMark: rules.marks[seatIndex] ?? null,
          outcome:
            state.winnerSeatId === seatId
              ? 'win'
              : state.winnerSeatId === null
                ? state.draw
                  ? 'draw'
                  : 'in-progress'
                : 'loss',
        },
      }
    },
    getResult(state): JsonValue | undefined {
      if (state.winnerSeatId !== null) {
        return { outcome: 'win', winnerSeatId: state.winnerSeatId }
      }
      return state.draw ? { outcome: 'draw' } : undefined
    },
  }
}
