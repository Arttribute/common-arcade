import { describe, expect, it } from 'vitest'
import { gameDocumentSchema, starterDocument } from '@common-arcade/studio'
import { smokeTestRuntime } from './runtime-validation.js'

function game(
  observe: string,
  validateAction = '(s,a,c)=>s.roster.some(r=>r.seatId===c.seatId)?null:"Unknown seat"',
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
  it('uses declared configuration defaults during publication validation', async () => {
    const configured = game(
      '(s,id)=>({visibleState:s,legalActions:s.roster[s.turn%2].seatId===id?[{type:"move"}]:[]})',
    )
    if (configured.kind !== 'browser')
      throw new Error('Expected browser fixture')
    await expect(
      smokeTestRuntime(
        gameDocumentSchema.parse({
          ...configured,
          configurationSchema: {
            type: 'object',
            properties: {
              rounds: { type: 'integer', default: 3, minimum: 1 },
            },
            required: ['rounds'],
            additionalProperties: false,
          },
          files: configured.files.map((file) =>
            file.path === 'server.js'
              ? {
                  ...file,
                  content: file.content.replace(
                    'initialize:c=>({roster:c.roster,turn:0})',
                    'initialize:c=>{if(!Number.isInteger(c.configuration.rounds)||c.configuration.rounds<1)throw Error("Invalid configuration");return {roster:c.roster,turn:0}}',
                  ),
                }
              : file,
          ),
        }),
        'sha256:test',
      ),
    ).resolves.toBeUndefined()
  })
  it('exercises every configured enum option', async () => {
    const configured = game(
      '(s,id)=>({visibleState:s,legalActions:s.roster[s.turn%2].seatId===id?[{type:"move"}]:[]})',
    )
    if (configured.kind !== 'browser')
      throw new Error('Expected browser fixture')
    await expect(
      smokeTestRuntime(
        gameDocumentSchema.parse({
          ...configured,
          configurationSchema: {
            type: 'object',
            properties: {
              difficulty: {
                type: 'string',
                default: 'expert',
                enum: ['easy', 'unsupported', 'expert'],
              },
            },
            required: ['difficulty'],
            additionalProperties: false,
          },
          files: configured.files.map((file) =>
            file.path === 'server.js'
              ? {
                  ...file,
                  content: file.content.replace(
                    'initialize:c=>({roster:c.roster,turn:0})',
                    'initialize:c=>{if(c.configuration.difficulty==="unsupported")throw Error("Unsupported difficulty");return {roster:c.roster,turn:0}}',
                  ),
                }
              : file,
          ),
        }),
        'sha256:test',
      ),
    ).rejects.toThrow('difficulty option 2')
  })
  it('requires boundary rosters to remain playable', async () => {
    const configured = game(
      '(s,id)=>({visibleState:s,legalActions:s.roster.length>1&&s.roster[s.turn%2].seatId===id?[{type:"move"}]:[]})',
    )
    if (configured.kind !== 'browser')
      throw new Error('Expected browser fixture')
    await expect(
      smokeTestRuntime(
        gameDocumentSchema.parse({
          ...configured,
          play: {
            ...configured.play,
            seats: { min: 1, max: 2, default: 2 },
            roles: [
              {
                id: 'player',
                title: 'Player',
                count: 2,
                minCount: 1,
                maxCount: 2,
              },
            ],
          },
        }),
        'sha256:test',
      ),
    ).rejects.toThrow('minimum roster')
  })
  it('exercises each role-specific bound', async () => {
    const configured = game(
      '(s,id)=>({visibleState:s,legalActions:s.roster[s.turn%s.roster.length].seatId===id?[{type:"move"}]:[]})',
    )
    if (configured.kind !== 'browser')
      throw new Error('Expected browser fixture')
    await expect(
      smokeTestRuntime(
        gameDocumentSchema.parse({
          ...configured,
          play: {
            ...configured.play,
            seats: { min: 1, max: 3, default: 2 },
            roles: [
              {
                id: 'host',
                title: 'Host',
                count: 1,
                minCount: 0,
                maxCount: 2,
              },
              {
                id: 'guest',
                title: 'Guest',
                count: 1,
                minCount: 0,
                maxCount: 2,
              },
            ],
          },
          files: configured.files.map((file) =>
            file.path === 'server.js'
              ? {
                  ...file,
                  content: file.content.replace(
                    'initialize:c=>({roster:c.roster,turn:0})',
                    'initialize:c=>{if(c.roster.filter(s=>s.role==="guest").length===2)throw Error("Too many guests");return {roster:c.roster,turn:0}}',
                  ),
                }
              : file,
          ),
        }),
        'sha256:test',
      ),
    ).rejects.toThrow('guest role maximum')
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
          '(s,a,c)=>s.roster.some(r=>r.seatId===c.seatId)?null:"Unknown seat"',
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
          '(s,a,c)=>s.roster.some(r=>r.seatId===c.seatId)?null:"Unknown seat"',
          'realtime',
        ),
        'sha256:test',
      ),
    ).rejects.toThrow('sea_validation_2')
  })
  it('rejects fallback-to-home rules even when both seats advertise controls', async () => {
    await expect(
      smokeTestRuntime(
        game(
          '(s,id)=>({visibleState:s,legalActions:[{type:"move"}]})',
          '()=>null',
          'realtime',
        ),
        'sha256:test',
      ),
    ).rejects.toThrow('unregistered seat')
  })
})
