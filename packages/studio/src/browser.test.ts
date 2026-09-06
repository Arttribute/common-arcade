import { describe, expect, it } from 'vitest'
import {
  emptyBrowserDocument,
  gameDocumentSchema,
  isBrowserGame,
} from '@common-arcade/protocol'
import { compilePresentation } from './index.js'
describe('browser game projects', () => {
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
})
