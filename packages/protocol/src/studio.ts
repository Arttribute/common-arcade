import { z } from 'zod'
import type { GameManifest } from './index.js'

export const gameDistributionSchema = z
  .object({
    license: z.enum([
      'all-rights-reserved',
      'cc-by-4.0',
      'cc-by-sa-4.0',
      'cc0-1.0',
      'custom',
    ]),
    customLicenseUrl: z.string().url().optional(),
    remixing: z.enum(['disabled', 'allowed']),
    attributionRequired: z.boolean(),
    commercialUse: z.boolean(),
    revenueShareBps: z.number().int().min(0).max(10_000),
  })
  .strict()
  .superRefine((distribution, context) => {
    if (
      distribution.license === 'custom' &&
      distribution.customLicenseUrl === undefined
    )
      context.addIssue({
        code: 'custom',
        path: ['customLicenseUrl'],
        message: 'Custom licenses require a public license URL.',
      })
  })

export const defaultGameDistribution = {
  license: 'all-rights-reserved',
  remixing: 'disabled',
  attributionRequired: true,
  commercialUse: false,
  revenueShareBps: 0,
} as const

export const gridGameDocumentSchema = z
  .object({
    title: z.string().trim().min(1).max(100),
    description: z.string().max(1000),
    boardSize: z.number().int().min(3).max(8),
    winLength: z.number().int().min(3).max(8),
    marks: z.tuple([z.string().min(1).max(3), z.string().min(1).max(3)]),
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    background: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    distribution: gameDistributionSchema.optional(),
  })
  .strict()
  .superRefine((d, c) => {
    if (d.winLength > d.boardSize)
      c.addIssue({
        code: 'custom',
        message: 'Win length cannot exceed board size',
      })
    if (d.marks[0] === d.marks[1])
      c.addIssue({ code: 'custom', message: 'Players need distinct marks' })
  })
export const browserGameDocumentSchema = z
  .object({
    kind: z.literal('browser'),
    title: z.string().trim().min(1).max(100),
    description: z.string().max(1000),
    entryFile: z.string().max(160),
    dependencies: z
      .record(
        z.string().regex(/^(?:@[a-z0-9-]+\/)?[a-z0-9._-]+$/),
        z.string().regex(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/),
      )
      .refine((d) => Object.keys(d).length <= 20)
      .optional(),
    play: z
      .object({
        mode: z
          .enum(['turn-based', 'simultaneous', 'realtime', 'hybrid'])
          .default('turn-based'),
        seats: z
          .object({
            min: z.number().int().min(1).max(16),
            max: z.number().int().min(1).max(16),
            default: z.number().int().min(1).max(16),
          })
          .strict()
          .superRefine((seats, context) => {
            if (seats.min > seats.max)
              context.addIssue({
                code: 'custom',
                message: 'Minimum seats cannot exceed maximum seats.',
              })
            if (seats.default < seats.min || seats.default > seats.max)
              context.addIssue({
                code: 'custom',
                message: 'Default seats must be within the supported range.',
              })
          }),
        maxDecisionsPerSecond: z.number().int().min(1).max(20).default(2),
      })
      .strict()
      .optional(),
    runtime: z
      .object({
        kind: z.literal('sandboxed-script'),
        entryFile: z
          .string()
          .min(1)
          .max(160)
          .regex(/^[a-zA-Z0-9_./-]+$/),
        tickRate: z.number().int().min(1).max(60).default(30),
        memoryMiB: z.number().int().min(4).max(32).default(16),
        timeoutMs: z.number().int().min(1).max(50).default(20),
      })
      .strict()
      .optional(),
    capabilities: z
      .object({
        genres: z
          .array(z.string().regex(/^[a-z][a-z0-9-]{0,39}$/))
          .max(12)
          .default([]),
        world: z
          .object({
            persistence: z.enum(['session', 'campaign', 'persistent-world']),
            authority: z.enum([
              'browser-preview',
              'arcade-managed',
              'external-conformant-host',
            ]),
            cadence: z.enum(['turn', 'window', 'fixed-tick', 'event-driven']),
            checkpointing: z.enum([
              'end-only',
              'periodic',
              'event-and-periodic',
            ]),
          })
          .strict(),
        presentation: z
          .object({
            dimension: z.enum(['2d', '3d', 'mixed']),
            engine: z.enum([
              'dom',
              'canvas',
              'phaser',
              'pixi',
              'three',
              'react-three-fiber',
              'babylon',
              'playcanvas',
              'custom-webgl',
            ]),
            contentPipeline: z
              .object({
                authoringTools: z
                  .array(z.enum(['blender', 'procedural', 'other']))
                  .max(8),
                runtimeFormats: z
                  .array(
                    z.enum([
                      'html',
                      'svg',
                      'png',
                      'webp',
                      'spritesheet',
                      'gltf',
                      'glb',
                      'ktx2',
                      'basis',
                    ]),
                  )
                  .max(12),
              })
              .strict()
              .optional(),
          })
          .strict(),
        teams: z
          .object({
            enabled: z.boolean(),
            maxTeams: z.number().int().min(1).max(32),
            membersPerTeam: z.number().int().min(1).max(64),
            control: z.enum(['individual', 'centralized', 'hybrid']),
            sharedStrategy: z.boolean(),
          })
          .strict(),
        economy: z
          .object({
            payments: z.enum(['disabled', 'integration-ready']),
            valueMode: z.enum(['none', 'virtual', 'regulated']),
            hooks: z
              .array(
                z.enum([
                  'entry-authorization',
                  'escrow-reservation',
                  'settlement-proposal',
                  'refund-proposal',
                  'ledger-export',
                ]),
              )
              .max(8),
          })
          .strict()
          .superRefine((economy, context) => {
            if (economy.payments === 'disabled' && economy.hooks.length)
              context.addIssue({
                code: 'custom',
                path: ['hooks'],
                message: 'Payment hooks require integration-ready mode.',
              })
          }),
      })
      .strict()
      .optional(),
    distribution: gameDistributionSchema.optional(),
    files: z
      .array(
        z
          .object({
            path: z
              .string()
              .min(1)
              .max(160)
              .regex(/^[a-zA-Z0-9_./-]+$/)
              .refine(
                (p) =>
                  !p.startsWith('/') &&
                  !p.split('/').some((s) => s === '..' || s === '.' || !s),
              ),
            content: z.string().max(120000),
          })
          .strict(),
      )
      .min(1)
      .max(60),
  })
  .strict()
  .superRefine((d, c) => {
    if (
      !d.files.some((f) => f.path === d.entryFile) ||
      !d.entryFile.endsWith('.html')
    )
      c.addIssue({
        code: 'custom',
        message: 'Entry file must name an HTML file in this project.',
      })
    if (new Set(d.files.map((f) => f.path)).size !== d.files.length)
      c.addIssue({
        code: 'custom',
        message: 'Source file paths must be unique.',
      })
    if (
      d.runtime &&
      (!d.files.some((f) => f.path === d.runtime?.entryFile) ||
        !/\.[cm]?js$/.test(d.runtime.entryFile))
    )
      c.addIssue({
        code: 'custom',
        path: ['runtime', 'entryFile'],
        message:
          'Managed runtime entryFile must name a JavaScript file in this project.',
      })
    if (new TextEncoder().encode(JSON.stringify(d)).byteLength > 120000)
      c.addIssue({
        code: 'custom',
        message:
          'Project source must be smaller than 120 KB. Store media as separate assets.',
      })
  })
export const gameDocumentSchema = z.union([
  gridGameDocumentSchema,
  browserGameDocumentSchema,
])
export type GridGameDocument = z.infer<typeof gridGameDocumentSchema>
export type BrowserGameDocument = z.infer<typeof browserGameDocumentSchema>
export type GameDocument = z.infer<typeof gameDocumentSchema>
export type GameDistribution = z.infer<typeof gameDistributionSchema>
export function isBrowserGame(d: GameDocument): d is BrowserGameDocument {
  return 'kind' in d && d.kind === 'browser'
}
export function isManagedBrowserGame(
  d: GameDocument,
): d is BrowserGameDocument & {
  runtime: NonNullable<BrowserGameDocument['runtime']>
} {
  return isBrowserGame(d) && d.runtime?.kind === 'sandboxed-script'
}
export const emptyBrowserDocument: BrowserGameDocument = {
  kind: 'browser',
  title: 'Untitled game',
  description: '',
  entryFile: 'index.html',
  play: {
    mode: 'turn-based',
    seats: { min: 1, max: 8, default: 2 },
    maxDecisionsPerSecond: 2,
  },
  files: [
    {
      path: 'index.html',
      content:
        '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#fafaf9;color:#78716c;font:14px system-ui}main{text-align:center;max-width:340px;padding:24px}h1{font-size:20px;font-weight:500;color:#292524}p{line-height:1.7}</style></head><body><main><h1>Your game starts here</h1><p>Describe what you want to make in the conversation. Your copilot will build a playable first version.</p></main></body></html>',
    },
  ],
}
/**
 * The worked example every new creator account starts with. It is a complete
 * browser project rather than a grid template so the first thing a creator
 * opens shows the whole surface: real source files, a live preview, an agent
 * play bridge to test against, and something publishable without edits.
 */
export const exampleDocument: BrowserGameDocument = {
  kind: 'browser',
  title: 'Tic-tac-toe',
  description:
    'A finished example you can play, read, change and publish. Ask your copilot for a twist to see how a change lands.',
  entryFile: 'index.html',
  play: {
    mode: 'turn-based',
    seats: { min: 2, max: 2, default: 2 },
    maxDecisionsPerSecond: 2,
  },
  files: [
    {
      path: 'index.html',
      content:
        '<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="utf-8" />\n    <meta name="viewport" content="width=device-width,initial-scale=1" />\n    <title>Tic-tac-toe</title>\n    <link rel="stylesheet" href="style.css" />\n  </head>\n  <body>\n    <main>\n      <h1>Tic-tac-toe</h1>\n      <p class="hint">Take turns. Three in a row wins. Click a square, or let an agent play a seat.</p>\n      <div class="board" id="board" role="group" aria-label="Game board"></div>\n      <p class="status" id="status" role="status">X to play</p>\n      <button class="reset" id="reset" type="button">New game</button>\n    </main>\n    <script type="module" src="main.js"></script>\n  </body>\n</html>\n',
    },
    {
      path: 'style.css',
      content:
        ':root {\n  color-scheme: light;\n  --line: #e7e5e4;\n  --ink: #292524;\n  --muted: #78716c;\n  --accent: #4f46e5;\n}\n* { box-sizing: border-box; }\nbody {\n  margin: 0;\n  min-height: 100vh;\n  display: grid;\n  place-items: center;\n  background: #fafaf9;\n  color: var(--ink);\n  font: 14px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif;\n}\nmain { width: min(88vw, 380px); padding: 32px 0; text-align: center; }\nh1 { margin: 0 0 6px; font-size: 24px; font-weight: 500; letter-spacing: -0.03em; }\n.hint { margin: 0; color: var(--muted); }\n.board {\n  display: grid;\n  grid-template-columns: repeat(3, 1fr);\n  gap: 8px;\n  margin: 28px 0 20px;\n}\n.cell {\n  aspect-ratio: 1;\n  border: 1px solid var(--line);\n  border-radius: 14px;\n  background: #fff;\n  color: var(--ink);\n  font-size: clamp(24px, 9vw, 44px);\n  font-weight: 500;\n  cursor: pointer;\n}\n.cell:hover:not(:disabled) { border-color: #d6d3d1; }\n.cell:disabled { cursor: default; }\n.cell.win { border-color: var(--accent); color: var(--accent); }\n.cell:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }\n.status { min-height: 24px; margin: 0 0 16px; color: var(--muted); }\n.reset {\n  border: 1px solid var(--line);\n  border-radius: 10px;\n  background: #fff;\n  color: var(--ink);\n  padding: 8px 16px;\n  font: inherit;\n  cursor: pointer;\n}\n.reset:hover { border-color: #d6d3d1; }\n@media (prefers-reduced-motion: no-preference) {\n  .cell, .reset { transition: border-color 0.15s, color 0.15s; }\n}\n',
    },
    {
      path: 'main.js',
      content:
        "const LINES = [\n  [0, 1, 2], [3, 4, 5], [6, 7, 8],\n  [0, 3, 6], [1, 4, 7], [2, 5, 8],\n  [0, 4, 8], [2, 4, 6],\n];\nconst board = document.getElementById('board');\nconst status = document.getElementById('status');\nconst cells = Array.from({ length: 9 }, (_, index) => {\n  const cell = document.createElement('button');\n  cell.type = 'button';\n  cell.className = 'cell';\n  cell.dataset.arcadeNode = `cell:${index}`;\n  cell.addEventListener('click', () => play(index));\n  board.append(cell);\n  return cell;\n});\n\nlet squares = Array(9).fill(null);\nlet turn = 0;\nlet winner = null;\nlet winningLine = null;\n\nfunction findWinner() {\n  for (const line of LINES) {\n    const [a, b, c] = line;\n    if (squares[a] && squares[a] === squares[b] && squares[a] === squares[c])\n      return { mark: squares[a], line };\n  }\n  return null;\n}\n\nfunction isOver() {\n  return Boolean(winner) || squares.every(Boolean);\n}\n\nfunction play(index) {\n  if (isOver() || squares[index]) return false;\n  squares[index] = turn % 2 === 0 ? 'X' : 'O';\n  turn += 1;\n  const result = findWinner();\n  winner = result?.mark ?? null;\n  winningLine = result?.line ?? null;\n  render();\n  return true;\n}\n\nfunction reset() {\n  squares = Array(9).fill(null);\n  turn = 0;\n  winner = null;\n  winningLine = null;\n  render();\n}\n\nfunction render() {\n  cells.forEach((cell, index) => {\n    cell.textContent = squares[index] ?? '';\n    cell.disabled = isOver() || Boolean(squares[index]);\n    cell.classList.toggle('win', Boolean(winningLine?.includes(index)));\n    cell.setAttribute(\n      'aria-label',\n      `Square ${index + 1}, ${squares[index] ?? 'empty'}`,\n    );\n  });\n  status.textContent = winner\n    ? `${winner} wins`\n    : isOver()\n      ? 'A draw'\n      : `${turn % 2 === 0 ? 'X' : 'O'} to play`;\n}\n\ndocument.getElementById('reset').addEventListener('click', reset);\nrender();\n\n// Agent play bridge. Every seat receives the same public board but only the\n// current seat receives placement actions. Humans and agents use `play`.\nwindow.arcade = {\n  seats: () => [\n    { id: 'seat-1', label: 'Player 1 · X' },\n    { id: 'seat-2', label: 'Player 2 · O' },\n  ],\n  observe: (seatId) => ({\n    squares: [...squares],\n    seatId,\n    currentSeatId: `seat-${(turn % 2) + 1}`,\n    turnMark: turn % 2 === 0 ? 'X' : 'O',\n    winner,\n    over: isOver(),\n  }),\n  actions: (seatId) => {\n    if (isOver()) return [{ id: 'reset', label: 'Start a new game' }];\n    if (seatId !== `seat-${(turn % 2) + 1}`) return [];\n    return squares.flatMap((mark, index) =>\n      mark ? [] : [{ id: `place:${index}`, label: `Play square ${index + 1}` }],\n    );\n  },\n  step: (id, seatId) => {\n    if (id === 'reset') {\n      reset();\n      return true;\n    }\n    if (seatId !== `seat-${(turn % 2) + 1}`) return false;\n    const index = Number(String(id).split(':')[1]);\n    return Number.isInteger(index) ? play(index) : false;\n  },\n};\n",
    },
  ],
}
export const starterDocument: GridGameDocument = {
  title: 'Three in a row',
  description:
    'Take turns. Find your line. A small game with room for a clever opponent.',
  boardSize: 3,
  winLength: 3,
  marks: ['X', 'O'],
  accent: '#78716c',
  background: '#fafaf9',
}
export type StudioAnnotation = {
  id: string
  revision: number
  digest: string
  body: string
  status: 'open' | 'resolved'
  x: number
  y: number
  width?: number
  height?: number
  entityId?: string
  context?: {
    viewport: { width: 1280; height: 720 }
    moment?: unknown
    snapshotRecordingId?: string
    observation?: unknown
  }
  tick?: number
  createdAt: string
}
export type StudioProject = {
  id: string
  ownerId: string
  revision: number
  digest: string
  document: GameDocument
  annotations: StudioAnnotation[]
  createdAt: string
  updatedAt: string
  releaseId?: string
  collaborators?: {
    actorId: string
    permissions: ('test' | 'comment' | 'edit')[]
  }[]
  forkedFrom?: {
    releaseId: string
    digest: string
    originalCreatorId: string
  }
}
export type StudioRelease = {
  id: string
  projectId: string
  revision: number
  document: GameDocument
  digest: string
  manifest: GameManifest
  ownerId?: string
  distribution?: GameDistribution
  publishedAt: string
}
