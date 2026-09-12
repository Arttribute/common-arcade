import { describe, expect, it } from 'vitest'
import {
  gameDocumentSchema,
  exampleDocument,
  type BrowserGameDocument,
} from '@common-arcade/protocol'
import { documentDigest, releaseManifest } from './index.js'
import { testGameRuntime } from './runtime.js'

const realtime = gameDocumentSchema.parse({
  ...exampleDocument,
  play: {
    mode: 'realtime',
    seats: { min: 4, max: 4, default: 4 },
    roles: [
      { id: 'leader', title: 'Leader', count: 1 },
      { id: 'member', title: 'Member', count: 3 },
    ],
    lateJoin: true,
  },
  runtime: { kind: 'sandboxed-script', entryFile: 'rules.js' },
  files: [
    exampleDocument.files[0],
    {
      path: 'rules.js',
      content: `globalThis.arcadeGame={
    prepare:c=>({count:c.roster.length}),
    initialize:c=>({elapsed:0,count:arcadePrepared.count}),
    validateAction:()=>null,applyAction:s=>({state:s,events:[]}),
    tick:(s,c)=>({state:{...s,elapsed:s.elapsed+c.deltaMs},events:[]}),
    observe:(s,id)=>({visibleState:{you:{seatId:id},elapsed:s.elapsed,perception:{horizonMs:100}},legalActions:[]}),
    result:()=>null
  }`,
    },
  ],
}) as BrowserGameDocument

describe('genre-independent managed runtime harness', () => {
  it('tests cooperative turn-based games without a DOM', async () => {
    const result = await testGameRuntime(
      exampleDocument,
      await documentDigest(exampleDocument),
    )
    expect(result.deterministic).toBe(true)
    expect(result.status).toBe('completed')
    expect(result.result).toMatchObject({ outcome: 'complete' })
    expect(result.warnings.join(' ')).not.toContain('observation.feedback')
  })
  it('tests four-seat realtime games and reports observation and execution costs', async () => {
    const result = await testGameRuntime(
      realtime,
      await documentDigest(realtime),
      { steps: 20 },
    )
    expect(result.deterministic).toBe(true)
    expect(result.seatCount).toBe(4)
    expect(result.replay.checkpoints.at(-1)?.state).toEqual({
      elapsed: 660,
      count: 4,
    })
    expect(result.replay.checkpoints.length).toBeLessThan(4)
    expect(result.warnings.join(' ')).toContain('horizonMs')
    expect(result.timing.p95Ms).toBeGreaterThan(0)
  })
  it('normalizes runtime defaults and validates role and clock manifests', async () => {
    const raw = structuredClone(realtime)
    delete (raw.runtime as Partial<NonNullable<BrowserGameDocument['runtime']>>)
      .tickRate
    const manifest = await releaseManifest(
      {
        id: 'prj_test_roles',
        ownerId: 'owner',
        revision: 1,
        document: raw,
        digest: await documentDigest(raw),
        annotations: [],
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      },
      'rel_test_roles',
    )
    expect(manifest.spec.clock.simulationHz).toBe(30)
    expect(manifest.spec.seats.roles.map((role) => role.count)).toEqual([1, 3])
    expect(manifest.spec.seats.lateJoin).toBe(true)
  })
  it('reports the browser field instead of a generic document union error', () => {
    const result = gameDocumentSchema.safeParse({
      ...exampleDocument,
      runtime: { kind: 'wrong' },
    })
    expect(result.success).toBe(false)
    if (!result.success)
      expect(result.error.issues[0]?.path).toEqual(['runtime', 'kind'])
  })
})
