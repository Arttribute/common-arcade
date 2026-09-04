import {
  jsonValueSchema,
  matchIdSchema,
  testRunIdSchema,
} from '@common-arcade/protocol'
import { z } from 'zod'

export const diagnosticDomains = [
  'build',
  'runtime',
  'transport',
  'policy',
  'adaptation',
  'coordination',
  'security',
  'test',
] as const

export type DiagnosticDomain = (typeof diagnosticDomains)[number]

export const diagnosticRecordSchema = z
  .object({
    runId: testRunIdSchema,
    matchId: matchIdSchema,
    sequence: z.number().int().positive(),
    turn: z.number().int().nonnegative().optional(),
    tick: z.number().int().nonnegative().optional(),
    gameTimeMs: z.number().int().nonnegative(),
    at: z.string().datetime(),
    source: z
      .object({
        kind: z.enum(['game', 'runtime', 'policy', 'agent', 'team', 'test']),
        id: z.string().min(1),
        seatId: z.string().min(1).optional(),
        teamId: z.string().min(1).optional(),
      })
      .strict(),
    visibility: z.enum(['test-owner', 'seat', 'team', 'public']),
    category: z.enum(diagnosticDomains),
    level: z.enum(['debug', 'info', 'warn', 'error']),
    type: z.string().regex(/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/),
    summary: z.string().min(1).max(500),
    data: jsonValueSchema,
    correlation: z
      .object({
        observationSequence: z.number().int().nonnegative().optional(),
        strategyEpoch: z.number().int().positive().optional(),
        actionId: z.string().min(1).optional(),
      })
      .strict(),
  })
  .strict()

export type DiagnosticRecord = z.infer<typeof diagnosticRecordSchema>
export type DiagnosticDraft = Omit<DiagnosticRecord, 'sequence' | 'at'>

export interface DiagnosticQuery {
  readonly category?: DiagnosticDomain
  readonly seatId?: string
  readonly level?: DiagnosticRecord['level']
  readonly type?: string
  readonly afterSequence?: number
}

export class DiagnosticTimeline {
  private readonly records: DiagnosticRecord[] = []

  constructor(
    readonly maxRecords = 20_000,
    private readonly now: () => Date = () => new Date(),
  ) {}

  append(draft: DiagnosticDraft): DiagnosticRecord {
    if (this.records.length >= this.maxRecords)
      throw new Error('Diagnostic record budget exceeded')
    const record = diagnosticRecordSchema.parse({
      ...draft,
      sequence: this.records.length + 1,
      at: this.now().toISOString(),
    })
    this.records.push(record)
    return record
  }

  query(query: DiagnosticQuery = {}): readonly DiagnosticRecord[] {
    return this.records.filter(
      (record) =>
        (query.category === undefined || record.category === query.category) &&
        (query.seatId === undefined || record.source.seatId === query.seatId) &&
        (query.level === undefined || record.level === query.level) &&
        (query.type === undefined || record.type === query.type) &&
        (query.afterSequence === undefined ||
          record.sequence > query.afterSequence),
    )
  }

  toJsonLines(query: DiagnosticQuery = {}): string {
    return this.query(query)
      .map((record) => JSON.stringify(record))
      .join('\n')
  }
}
