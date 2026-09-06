import { z } from 'zod'
import type { GameManifest } from './index.js'

export const gridGameDocumentSchema = z
  .object({
    title: z.string().trim().min(1).max(100),
    description: z.string().max(1000),
    boardSize: z.number().int().min(3).max(8),
    winLength: z.number().int().min(3).max(8),
    marks: z.tuple([z.string().min(1).max(3), z.string().min(1).max(3)]),
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    background: z.string().regex(/^#[0-9a-fA-F]{6}$/),
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
export function isBrowserGame(d: GameDocument): d is BrowserGameDocument {
  return 'kind' in d && d.kind === 'browser'
}
export const emptyBrowserDocument: BrowserGameDocument = {
  kind: 'browser',
  title: 'Untitled game',
  description: '',
  entryFile: 'index.html',
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
        "const LINES = [\n  [0, 1, 2], [3, 4, 5], [6, 7, 8],\n  [0, 3, 6], [1, 4, 7], [2, 5, 8],\n  [0, 4, 8], [2, 4, 6],\n];\nconst board = document.getElementById('board');\nconst status = document.getElementById('status');\nconst cells = Array.from({ length: 9 }, (_, index) => {\n  const cell = document.createElement('button');\n  cell.type = 'button';\n  cell.className = 'cell';\n  cell.dataset.arcadeNode = `cell:${index}`;\n  cell.addEventListener('click', () => play(index));\n  board.append(cell);\n  return cell;\n});\n\nlet squares = Array(9).fill(null);\nlet turn = 0;\nlet winner = null;\nlet winningLine = null;\n\nfunction findWinner() {\n  for (const line of LINES) {\n    const [a, b, c] = line;\n    if (squares[a] && squares[a] === squares[b] && squares[a] === squares[c])\n      return { mark: squares[a], line };\n  }\n  return null;\n}\n\nfunction isOver() {\n  return Boolean(winner) || squares.every(Boolean);\n}\n\nfunction play(index) {\n  if (isOver() || squares[index]) return false;\n  squares[index] = turn % 2 === 0 ? 'X' : 'O';\n  turn += 1;\n  const result = findWinner();\n  winner = result?.mark ?? null;\n  winningLine = result?.line ?? null;\n  render();\n  return true;\n}\n\nfunction reset() {\n  squares = Array(9).fill(null);\n  turn = 0;\n  winner = null;\n  winningLine = null;\n  render();\n}\n\nfunction render() {\n  cells.forEach((cell, index) => {\n    cell.textContent = squares[index] ?? '';\n    cell.disabled = isOver() || Boolean(squares[index]);\n    cell.classList.toggle('win', Boolean(winningLine?.includes(index)));\n    cell.setAttribute(\n      'aria-label',\n      `Square ${index + 1}, ${squares[index] ?? 'empty'}`,\n    );\n  });\n  status.textContent = winner\n    ? `${winner} wins`\n    : isOver()\n      ? 'A draw'\n      : `${turn % 2 === 0 ? 'X' : 'O'} to play`;\n}\n\ndocument.getElementById('reset').addEventListener('click', reset);\nrender();\n\n// Agent play bridge. Studio playtests and Arcade policies read `observe`,\n// choose from `actions`, and submit through `step` — the same legal moves a\n// person has, never a privileged one.\nwindow.arcade = {\n  observe: () => ({\n    squares: [...squares],\n    turnMark: turn % 2 === 0 ? 'X' : 'O',\n    winner,\n    over: isOver(),\n  }),\n  actions: () =>\n    isOver()\n      ? [{ id: 'reset', label: 'Start a new game' }]\n      : squares.flatMap((mark, index) =>\n          mark ? [] : [{ id: `place:${index}`, label: `Play square ${index + 1}` }],\n        ),\n  step: (id) => {\n    if (id === 'reset') {\n      reset();\n      return true;\n    }\n    const index = Number(String(id).split(':')[1]);\n    return Number.isInteger(index) ? play(index) : false;\n  },\n};\n",
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
}
export type StudioRelease = {
  id: string
  projectId: string
  revision: number
  document: GameDocument
  digest: string
  manifest: GameManifest
  publishedAt: string
}
