import { z } from 'zod'
import type { GameManifest } from './index.js'

export const gameDocumentSchema = z
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
export type GameDocument = z.infer<typeof gameDocumentSchema>
export const starterDocument: GameDocument = {
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
