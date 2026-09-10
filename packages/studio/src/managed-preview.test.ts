import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { gameDocumentSchema } from '@common-arcade/protocol'
import { compilePresentation } from './index.js'

const source = `globalThis.arcadeGame={
  initialize:c=>({roster:c.roster,ball:0,ticks:0}),
  observe:(s,id)=>({visibleState:s,legalActions:s.roster.some(p=>p.seatId===id)?[{type:'shoot'}]:[]}),
  validateAction:(s,a,c)=>a.type==='shoot'&&s.roster.some(p=>p.seatId===c.seatId)?null:'Illegal',
  applyAction:(s,a,c)=>({state:{...s,ball:s.ball+(c.seatId==='seat-1'?1:-1)},events:[]}),
  tick:s=>({state:{...s,ticks:s.ticks+1},events:[]}),result:()=>null
};`
const document = gameDocumentSchema.parse({
  kind: 'browser',
  title: 'Football preview',
  description: 'Shoot the ball from either seat.',
  entryFile: 'index.html',
  play: {
    mode: 'realtime',
    seats: { min: 2, max: 2, default: 2 },
    maxDecisionsPerSecond: 10,
  },
  runtime: {
    kind: 'sandboxed-script',
    entryFile: 'server.js',
    tickRate: 20,
    memoryMiB: 8,
    timeoutMs: 20,
  },
  files: [
    { path: 'index.html', content: '<script src="main.js"></script>' },
    {
      path: 'main.js',
      content: 'window.arcade={render:(s)=>{window.lastRender=s}};',
    },
    { path: 'server.js', content: source },
  ],
})

describe('managed Studio preview', () => {
  async function start(preview = true) {
    const window: any = {
      fetch: vi.fn(),
      parent: {},
      addEventListener: vi.fn(),
    }
    let tick: () => void = () => {}
    const html = compilePresentation(document, undefined, true, {
      managedPreview: preview,
    })
    const script = html.match(/<script>([\s\S]*?)<\/script>/)![1]!
    await runInNewContext(script, {
      window,
      location: { origin: 'null' },
      document: { body: { innerText: '' } },
      setInterval: (fn: () => void) => {
        tick = fn
        return 1
      },
      clearInterval: vi.fn(),
      console,
      Response,
      URL,
      setTimeout,
    })
    return { window, tick: () => tick() }
  }
  it('renders initialized state and exposes validated actions for humans and agents', async () => {
    const { window, tick } = await start()
    expect(window.__arcadeRuntime).toEqual({ status: 'ready' })
    expect(window.lastRender).toMatchObject({ ball: 0, ticks: 0 })
    const actions = window.arcade.actions()
    expect(actions).toHaveLength(2)
    expect(window.arcade.submit({ type: 'shoot' })).toBe(true)
    expect(window.lastRender.ball).toBe(1)
    expect(window.arcade.step(actions[1].id)).toBe(true)
    expect(window.lastRender.ball).toBe(0)
    expect(window.arcade.submit({ type: 'invalid' })).toBe(false)
    tick()
    expect(window.lastRender.ticks).toBe(1)
    expect(
      window.arcade.observe().arcade.observations['seat-2-2'].visibleState.ball,
    ).toBe(0)
  })
  it('never starts local rules in a hosted presentation', async () => {
    const { window } = await start(false)
    expect(window.lastRender).toBeUndefined()
    expect(window.arcade.actions()).toEqual([])
  })
})
