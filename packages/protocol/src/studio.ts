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
