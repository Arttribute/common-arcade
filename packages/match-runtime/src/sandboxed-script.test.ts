import { describe, expect, it } from 'vitest'
import { createSandboxedScriptGame } from './sandboxed-script.js'

describe('sandboxed creator rules', () => {
  it('loads the embedded runtime without a companion wasm filename', async () => {
    const game = await createSandboxedScriptGame({
      releaseId: 'rel_embedded_runtime',
      releaseDigest: `sha256:${'a'.repeat(64)}`,
      mode: 'turn-based',
      memoryMiB: 8,
      timeoutMs: 20,
      source: `globalThis.arcadeGame={
        initialize:c=>({roster:c.roster,turn:0}),
        validateAction:()=>null,
        applyAction:(s,a)=>({state:{...s,turn:s.turn+1},events:[{type:'game.action',visibility:'public',payload:a}]}),
        observe:(s,id)=>({visibleState:{turn:s.turn,seatId:id},legalActions:[{type:'play'}]}),
        result:()=>null
      }`,
    })
    const roster = [{ seatId: 'seat-1', role: 'player' }]
    const state = game.initialize({
      matchId: 'match-1',
      seed: 'test-seed',
      configuration: {},
      roster,
    })

    expect(
      game.projectObservation(state, 'seat-1', {
        matchId: 'match-1',
        seatId: 'seat-1',
        stateSequence: 0,
        eventSequence: 0,
        elapsedMs: 0,
        authoritativeTime: '2026-01-01T00:00:00.000Z',
      }),
    ).toMatchObject({ legalActions: [{ type: 'play' }] })
  })

  it('still interrupts creator code that does not terminate', async () => {
    const game = await createSandboxedScriptGame({
      releaseId: 'rel_infinite_runtime',
      releaseDigest: `sha256:${'b'.repeat(64)}`,
      mode: 'turn-based',
      memoryMiB: 8,
      timeoutMs: 1,
      source:
        'globalThis.arcadeGame={initialize:()=>{while(true){}},validateAction:()=>null,applyAction:()=>({state:{},events:[]}),observe:()=>({visibleState:{},legalActions:[]}),result:()=>null}',
    })

    expect(() =>
      game.initialize({
        matchId: 'match-infinite',
        seed: 'test-seed',
        configuration: {},
        roster: [{ seatId: 'seat-1', role: 'player' }],
      }),
    ).toThrow(/interrupted|failed/i)
  })
})

it('caches prepared data while isolating mutable globals between calls', async () => {
  const game = await createSandboxedScriptGame({
    releaseId: 'rel_prepared',
    releaseDigest: `sha256:${'c'.repeat(64)}`,
    mode: 'realtime',
    memoryMiB: 8,
    timeoutMs: 20,
    source: `let hidden=0; globalThis.arcadeGame={
      prepare:c=>({seed:c.seed,values:[1,2,3]}),
      initialize:()=>({n:0,seed:arcadePrepared.seed}),
      validateAction:()=>null,applyAction:s=>({state:s,events:[]}),
      tick:s=>({state:{...s,n:s.n+arcadePrepared.values.length+(hidden++)},events:[]}),
      observe:s=>({visibleState:s,legalActions:[]}),result:()=>null
    }`,
  })
  let state = game.initialize({
    matchId: 'mat_prepared',
    seed: 'static',
    configuration: {},
    roster: [{ seatId: 'sea_one', role: 'player' }],
  })
  for (let tick = 0; tick < 3; tick++)
    state = game.advanceTick!(state, {
      matchId: 'mat_prepared',
      tick,
      stateSequence: tick,
      eventSequence: 0,
      elapsedMs: tick * 33,
      deltaMs: 33,
    }).state
  expect(state).toEqual({ n: 9, seed: 'static' })
})
