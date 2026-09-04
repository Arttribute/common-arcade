import { describe, expect, it } from 'vitest'
import { DiagnosticTimeline } from './index.js'

describe('DiagnosticTimeline', () => {
  it('assigns stable sequence numbers and filters structured records', () => {
    const timeline = new DiagnosticTimeline(
      2,
      () => new Date('2026-09-04T10:00:00.000Z'),
    )
    for (const [category, type] of [
      ['policy', 'policy.decision.made'],
      ['runtime', 'runtime.action.resolved'],
    ] as const) {
      timeline.append({
        runId: 'tst_diagnostic01',
        matchId: 'mat_diagnostic01',
        gameTimeMs: 1,
        source: { kind: 'test', id: 'test-harness' },
        visibility: 'test-owner',
        category,
        level: 'info',
        type,
        summary: type,
        data: {},
        correlation: {},
      })
    }
    expect(timeline.query({ category: 'policy' })).toMatchObject([
      { sequence: 1, type: 'policy.decision.made' },
    ])
    expect(() =>
      timeline.append({
        runId: 'tst_diagnostic01',
        matchId: 'mat_diagnostic01',
        gameTimeMs: 2,
        source: { kind: 'test', id: 'test-harness' },
        visibility: 'test-owner',
        category: 'test',
        level: 'warn',
        type: 'test.budget.exceeded',
        summary: 'Budget exceeded.',
        data: {},
        correlation: {},
      }),
    ).toThrow('budget')
  })
})
