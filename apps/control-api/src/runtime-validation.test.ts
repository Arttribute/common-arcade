import { describe, expect, it } from 'vitest'
import { gameDocumentSchema, starterDocument } from '@common-arcade/studio'
import { smokeTestRuntime } from './runtime-validation.js'

function game(
  observe: string,
  validateAction = '()=>null',
  mode = 'turn-based',
) {
  return gameDocumentSchema.parse({
    kind: 'browser',
    title: 'Action contract',
    description: 'Exercise playable seats.',
    entryFile: 'index.html',
    play: {
      mode,
      seats: { min: 2, max: 2, default: 2 },
      maxDecisionsPerSecond: 10,
    },
    runtime: {
      kind: 'sandboxed-script',
      entryFile: 'server.js',
      tickRate: 10,
      memoryMiB: 8,
      timeoutMs: 20,
    },
    files: [
      { path: 'index.html', content: '<main>Game</main>' },
      {
        path: 'server.js',
        content: `globalThis.arcadeGame={
      initialize:c=>({roster:c.roster,turn:0}),validateAction:${validateAction},
      applyAction:s=>({state:{...s,turn:s.turn+1},events:[]}),
      tick:s=>({state:s,events:[]}),observe:${observe},result:()=>null
    };`,
      },
    ],
  })
}

describe('live runtime playability validation', () => {
  it('checks both turn-based player roles without rejecting a waiting seat', async () => {
    await expect(
      smokeTestRuntime(
        game(
          '(s,id)=>({visibleState:s,legalActions:s.roster[s.turn%2].seatId===id?[{type:"move"}]:[]})',
        ),
        'sha256:test',
      ),
    ).resolves.toBeUndefined()
    await expect(
      smokeTestRuntime(starterDocument, 'sha256:test'),
    ).resolves.toBeUndefined()
  })
  it('rejects an ongoing game with no legal moves', async () => {
    await expect(
      smokeTestRuntime(
        game('(s,id)=>({visibleState:s,legalActions:[]})'),
        'sha256:test',
      ),
    ).rejects.toThrow('no seat has a legal action')
  })
  it('rejects advertised actions that the server refuses', async () => {
    await expect(
      smokeTestRuntime(
        game(
          '(s,id)=>({visibleState:s,legalActions:[{type:"shoot"}]})',
          '()=>"Wrong seat"',
        ),
        'sha256:test',
      ),
    ).rejects.toThrow('advertises an illegal action')
  })
  it('allows a realtime countdown before actions become available', async () => {
    await expect(
      smokeTestRuntime(
        game(
          '(s,id,c)=>({visibleState:s,legalActions:c.elapsedMs>=300?[{type:"shoot"}]:[]})',
          '()=>null',
          'realtime',
        ),
        'sha256:test',
      ),
    ).resolves.toBeUndefined()
  })
  it('rejects hardcoded seat identifiers that starve the other realtime player', async () => {
    await expect(
      smokeTestRuntime(
        game(
          '(s,id)=>({visibleState:s,legalActions:id===s.roster[0].seatId?[{type:"shoot"}]:[]})',
          '()=>null',
          'realtime',
        ),
        'sha256:test',
      ),
    ).rejects.toThrow('sea_validation_2')
  })
})
