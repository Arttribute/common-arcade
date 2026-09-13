import { describe, expect, it } from 'vitest'
import type { MatchDescriptor } from '@common-arcade/protocol'
import { formatDuration, matchOutcome } from './live-result'

const base = {
  status: 'completed',
  createdAt: '2026-09-13T10:00:00.000Z',
  updatedAt: '2026-09-13T10:04:12.000Z',
  seats: [
    { id: 'a', role: 'player', status: 'connected', label: 'Ada' },
    { id: 'b', role: 'player', status: 'connected', label: 'Bot' },
  ],
} as unknown as MatchDescriptor

const series = (scores: Record<string, number>) =>
  ({
    currentRound: 3,
    maximumRounds: 3,
    restartPolicy: 'owner',
    status: 'complete',
    scores,
    restartVotes: [],
  }) as MatchDescriptor['series']

describe('matchOutcome', () => {
  it('uses the round winner for a single game', () => {
    expect(matchOutcome({ ...base, result: { winner: 'b' } }, true)).toEqual({
      kind: 'winner',
      seatId: 'b',
      scope: 'round',
    })
  })
  it('decides an ended series by rounds won, not the last round', () => {
    const match = {
      ...base,
      series: series({ a: 2, b: 1 }),
      result: { winner: 'b' },
    }
    expect(matchOutcome(match, true)).toEqual({
      kind: 'winner',
      seatId: 'a',
      scope: 'session',
    })
  })
  it('reports a tied series as a session draw', () => {
    const match = { ...base, series: series({ a: 1, b: 1 }) }
    expect(matchOutcome(match, true)).toEqual({
      kind: 'draw',
      scope: 'session',
    })
  })
  it('treats a null winner as a draw', () => {
    expect(matchOutcome({ ...base, result: { winner: null } }, true)).toEqual({
      kind: 'draw',
      scope: 'round',
    })
  })
  it('reports stopped sessions by status', () => {
    expect(matchOutcome({ ...base, status: 'expired' }, true)).toEqual({
      kind: 'stopped',
      status: 'expired',
    })
  })
})

describe('formatDuration', () => {
  it('formats seconds, minutes and hours', () => {
    expect(formatDuration(base.createdAt, base.updatedAt)).toBe('4m 12s')
    expect(formatDuration(base.createdAt, '2026-09-13T10:00:38.000Z')).toBe(
      '38s',
    )
    expect(formatDuration(base.createdAt, '2026-09-13T11:03:00.000Z')).toBe(
      '1h 03m',
    )
  })
})
