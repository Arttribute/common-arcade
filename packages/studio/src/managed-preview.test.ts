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
  async function start(preview = true, project = document) {
    const window: any = {
      fetch: vi.fn(),
      parent: {},
      addEventListener: vi.fn(),
    }
    let tick: () => void = () => {}
    const html = compilePresentation(project, undefined, true, {
      managedPreview: preview,
    })
    const script = html.match(/<script>([\s\S]*?)<\/script>/)![1]!
    await runInNewContext(script, {
      window,
      location: { origin: 'null' },
      document: { body: { innerText: '' }, addEventListener: vi.fn() },
      setInterval: (fn: () => void) => {
        tick = fn
        return 1
      },
      clearInterval: vi.fn(),
      requestAnimationFrame: (fn: () => void) => {
        fn()
        return 1
      },
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
  it('preserves prepared data, roles, and input availability from the current live contract', async () => {
    if (document.kind !== 'browser') throw new Error('Expected browser fixture')
    const project = gameDocumentSchema.parse({
      ...document,
      play: {
        ...document.play,
        roles: [
          { id: 'home', title: 'Home', count: 1, team: 'home' },
          { id: 'away', title: 'Away', count: 1, team: 'away' },
        ],
      },
      files: document.files.map((file) =>
        file.path === 'server.js'
          ? {
              ...file,
              content: source.replace(
                'initialize:c=>({roster:c.roster,ball:0,ticks:0})',
                'prepare:c=>({start:7}),initialize:c=>({roster:c.roster,ball:globalThis.arcadePrepared.start,ticks:0})',
              ),
            }
          : file.path === 'main.js'
            ? {
                ...file,
                content:
                  'window.arcade={render:(s,c)=>{window.lastRender=s;window.inputEnabled=c.inputEnabled}};',
              }
            : file,
      ),
    })
    const { window } = await start(true, project)
    expect(window.lastRender.ball).toBe(7)
    expect(window.lastRender.roster.map((s: any) => s.role)).toEqual([
      'home',
      'away',
    ])
    expect(window.inputEnabled).toBe(true)
  })
  it('initializes managed previews with declared configuration defaults', async () => {
    if (document.kind !== 'browser') throw new Error('Expected browser fixture')
    const project = gameDocumentSchema.parse({
      ...document,
      configurationSchema: {
        type: 'object',
        properties: {
          startingBall: { type: 'integer', default: 9, minimum: 0 },
        },
        required: ['startingBall'],
        additionalProperties: false,
      },
      files: document.files.map((file) =>
        file.path === 'server.js'
          ? {
              ...file,
              content: source.replace(
                'initialize:c=>({roster:c.roster,ball:0,ticks:0})',
                'initialize:c=>({roster:c.roster,ball:c.configuration.startingBall,ticks:0})',
              ),
            }
          : file,
      ),
    })
    const { window } = await start(true, project)
    expect(window.lastRender.ball).toBe(9)
  })
  it('maps hold-release controls to the same stable actions used by the frame policy', async () => {
    if (document.kind !== 'browser') throw new Error('Expected browser fixture')
    const project = gameDocumentSchema.parse({
      ...document,
      files: document.files.map((file) =>
        file.path === 'server.js'
          ? {
              ...file,
              content: source
                .replace(
                  "[{type:'shoot'}]",
                  "[{type:'shoot',control:{mode:'hold',releaseActionId:'stop'}},{type:'stop'}]",
                )
                .replace(
                  "a.type==='shoot'&&",
                  "['shoot','stop'].includes(a.type)&&",
                )
                .replace(
                  "ball:s.ball+(c.seatId==='seat-1'?1:-1)",
                  "ball:a.type==='stop'?0:1",
                ),
            }
          : file,
      ),
    })
    const { window } = await start(true, project)
    const actions = window.arcade.actions()
    expect(actions[0].control.releaseActionId).toBe(actions[1].id)
    window.arcade.step(actions[0].id)
    expect(window.lastRender.ball).toBe(1)
    window.arcade.release('seat-1-1')
    expect(window.lastRender.ball).toBe(0)
  })
  it('never starts local rules in a hosted presentation', async () => {
    const { window } = await start(false)
    expect(window.lastRender).toBeUndefined()
    expect(window.arcade.actions()).toEqual([])
  })
})
