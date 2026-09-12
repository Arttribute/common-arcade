import { describe, expect, it } from 'vitest'
import {
  emptyBrowserDocument,
  gameDocumentSchema,
  isBrowserGame,
} from '@common-arcade/protocol'
import { compilePresentation } from './index.js'
import { runInNewContext } from 'node:vm'
describe('browser game projects', () => {
  it('executes the embedded controller in the compiled sandbox with local action IDs and cancellation', async () => {
    const html = compilePresentation({
      ...emptyBrowserDocument,
      play: {
        mode: 'realtime' as const,
        seats: { min: 1, max: 1, default: 1 },
        maxDecisionsPerSecond: 10,
      },
      files: [
        {
          path: 'index.html',
          content: '<body><script src="main.js"></script></body>',
        },
        {
          path: 'main.js',
          content: `
          window.applied=[];
          window.arcade={
            seats:()=>[{id:'one',label:'One'}],
            observe:()=>({phase:'active',arcadeDecisionContext:{actionScores:{focusBeam:40,releaseBeam:0}}}),
            actions:()=>[
              {id:'focusBeam',label:'Focus beam',control:{mode:'hold',releaseActionId:'releaseBeam'}},
              {id:'releaseBeam',label:'Release beam'}
            ],
            step:(id,seat)=>{window.applied.push({id,seat});return true}
          };
        `,
        },
      ],
    })
    let now = 0
    let nextId = 0
    const frames = new Map<number, (time: number) => void>()
    const handlers = new Map<string, ((event: any) => void)[]>()
    const messages: any[] = []
    const parent = { postMessage: (message: any) => messages.push(message) }
    const context: any = {
      console,
      Map,
      URL,
      Response,
      location: { origin: 'null' },
      performance: { now: () => now },
      parent,
      fetch: async () => new Response(''),
      document: {
        addEventListener: () => {},
        body: { append: () => {} },
        querySelectorAll: () => [],
      },
      requestAnimationFrame: (callback: (time: number) => void) => {
        frames.set(++nextId, callback)
        return nextId
      },
      cancelAnimationFrame: (id: number) => frames.delete(id),
      addEventListener: (type: string, callback: (event: any) => void) =>
        handlers.set(type, [...(handlers.get(type) ?? []), callback]),
    }
    context.window = context
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    expect(scripts).toHaveLength(1)
    await runInNewContext(scripts[0]![1]!, context)
    const send = (data: unknown) =>
      handlers
        .get('message')
        ?.forEach((callback) => callback({ source: parent, data }))
    send({
      type: 'arcade.preview-policy.start',
      runId: 'run',
      epoch: 'epoch',
      decisionsPerSecond: 10,
      controllers: [
        { seatId: 'one-1', label: 'One', kind: 'agent', strategy: 'Win' },
      ],
    })
    for (let i = 0; i < 60; i++) {
      now += 16
      const batch = [...frames.values()]
      frames.clear()
      batch.forEach((callback) => callback(now))
    }
    expect(context.applied).toEqual([{ id: 'focusBeam', seat: 'one' }])
    expect(
      messages.some((m) => m.type === 'arcade.preview-policy.sample'),
    ).toBe(true)
    send({ type: 'arcade.preview-policy.stop' })
    expect(context.applied.at(-1)).toEqual({ id: 'releaseBeam', seat: 'one' })
    expect(frames.size).toBe(0)
  })
  it('compiles local TypeScript modules without executing user source in the host', () => {
    const html = compilePresentation({
      ...emptyBrowserDocument,
      files: [
        {
          path: 'index.html',
          content:
            '<html><head><link rel="stylesheet" href="style.css"></head><body><script type="module" src="main.ts"></script></body></html>',
        },
        { path: 'style.css', content: 'body{color:red}' },
        {
          path: 'main.ts',
          content:
            'import {score} from "./state"; document.body.textContent=String(score)',
        },
        { path: 'state.ts', content: 'export const score: number = 7' },
      ],
    })
    expect(html).toContain('body{color:red}')
    expect(html).toContain('score = 7')
    expect(html).toContain('"./state":"state.ts"')
  })
  it('supports unquoted HTML attributes and stylesheet imports', () => {
    const html = compilePresentation({
      ...emptyBrowserDocument,
      files: [
        {
          path: 'index.html',
          content:
            '<html><head><link rel=stylesheet href=base.css></head><body><script type=module src=main.ts></script></body></html>',
        },
        { path: 'base.css', content: 'body{margin:0}' },
        {
          path: 'main.ts',
          content:
            'import "./theme.css"; const score:number=42; document.title=String(score)',
        },
        { path: 'theme.css', content: '.orb{background:gold}' },
      ],
    })
    expect(html).toContain('score = 42')
    expect(html).toContain('body{margin:0}')
    expect(html).toContain('.orb{background:gold}')
  })
  it('rejects missing entries, duplicate files and paths outside the project', () => {
    for (const patch of [
      { entryFile: 'missing.html' },
      { files: [{ path: '../secret', content: 'x' }] },
      { files: [...emptyBrowserDocument.files, ...emptyBrowserDocument.files] },
    ])
      expect(
        gameDocumentSchema.safeParse({ ...emptyBrowserDocument, ...patch })
          .success,
      ).toBe(false)
  })
  it('loads only declared, versioned engine imports through the browser dependency origin', () => {
    const project = {
      ...emptyBrowserDocument,
      dependencies: { three: '0.185.1' },
      files: [
        {
          path: 'index.html',
          content: '<body><script type="module" src="main.js"></script></body>',
        },
        {
          path: 'main.js',
          content: 'import * as THREE from "three"; console.log(THREE.Scene)',
        },
      ],
    }
    expect(isBrowserGame(project)).toBe(true)
    expect(compilePresentation(project)).toContain(
      'https://esm.sh/three@0.185.1',
    )
    expect(() => compilePresentation({ ...project, dependencies: {} })).toThrow(
      'Source file not found',
    )
  })
  it('shadows sandboxed storage globals and always settles the seat bridge', () => {
    const html = compilePresentation({
      ...emptyBrowserDocument,
      files: [
        {
          path: 'index.html',
          content: '<body><script src="main.js"></script></body>',
        },
        {
          path: 'main.js',
          content:
            "localStorage.setItem('score','1'); window.localStorage.getItem('score'); globalThis['sessionStorage'].clear();",
        },
      ],
    })
    expect(html).toContain('__arcadeLocalStorage.setItem')
    expect(html).toContain('__arcadeLocalStorage.getItem')
    expect(html).toContain('__arcadeSessionStorage.clear')
    expect(html).toContain("window.__arcadeRuntime={status:'ready'}")
    expect(html).toContain('finally{try{installArcadeSeats()}')
    expect(html).toContain("bridge='dom-fallback'")
    expect(html).toContain("pointer('pointerdown')")
  })
})
