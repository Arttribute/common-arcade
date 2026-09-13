import type { JsonValue, MatchDescriptor } from '@common-arcade/protocol'

type Seat = MatchDescriptor['seats'][number]

export function seatName(seat: Seat, seats: readonly Seat[]) {
  return seat.label ?? `Player ${seats.indexOf(seat) + 1}`
}

export function resultLabel(result: JsonValue, seats: readonly Seat[]): string {
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    if (typeof result.message === 'string') return result.message
    const winner = result.winner ?? result.winnerSeatId
    if (typeof winner === 'string') {
      const seat = seats.find((candidate) => candidate.id === winner)
      return `Winner: ${seat ? seatName(seat, seats) : winner}`
    }
    if (result.draw === true || result.winner === null) return 'Draw'
  }
  return typeof result === 'string' ? result : 'Round complete'
}

export type MatchOutcome =
  | { kind: 'winner'; seatId: string; scope: 'session' | 'round' }
  | { kind: 'draw'; scope: 'session' | 'round' }
  | { kind: 'message'; message: string }
  | { kind: 'stopped'; status: MatchDescriptor['status'] }
  | { kind: 'unknown' }

/**
 * What the finished match amounts to. A multi-round session that has ended is
 * decided by rounds won; otherwise the latest round's result decides it.
 */
export function matchOutcome(
  match: MatchDescriptor,
  ended: boolean,
): MatchOutcome {
  if (match.status !== 'completed')
    return { kind: 'stopped', status: match.status }
  const series = match.series
  if (ended && series && series.maximumRounds > 1) {
    const best = Math.max(
      0,
      ...match.seats.map((s) => series.scores[s.id] ?? 0),
    )
    const leaders = match.seats.filter(
      (seat) => (series.scores[seat.id] ?? 0) === best,
    )
    if (best > 0 && leaders.length === 1)
      return { kind: 'winner', seatId: leaders[0]!.id, scope: 'session' }
    if (best > 0) return { kind: 'draw', scope: 'session' }
  }
  const result = match.result
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const winner = result.winner ?? result.winnerSeatId
    if (
      typeof winner === 'string' &&
      match.seats.some((seat) => seat.id === winner)
    )
      return { kind: 'winner', seatId: winner, scope: 'round' }
    if (result.draw === true || result.winner === null)
      return { kind: 'draw', scope: 'round' }
    if (typeof result.message === 'string')
      return { kind: 'message', message: result.message }
  }
  if (typeof result === 'string') return { kind: 'message', message: result }
  return { kind: 'unknown' }
}

/** "4m 12s", "1h 03m", or "38s" between two ISO timestamps. */
export function formatDuration(from: string, to: string) {
  const seconds = Math.max(
    0,
    Math.round((Date.parse(to) - Date.parse(from)) / 1000),
  )
  if (!Number.isFinite(seconds)) return undefined
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`
  if (m) return `${m}m ${String(s).padStart(2, '0')}s`
  return `${s}s`
}

export const STOPPED: Record<string, string> = {
  canceled: 'Session closed by the host',
  expired: 'Session expired',
}
