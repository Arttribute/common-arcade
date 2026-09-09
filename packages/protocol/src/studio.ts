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
    kind: z.literal('grid').optional(),
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
        roles: z
          .array(
            z
              .object({
                id: z.string().regex(/^[a-z][a-z0-9-]{0,62}$/),
                title: z.string().min(1).max(80),
                count: z.number().int().min(1).max(16),
                team: z.string().min(1).max(64).optional(),
              })
              .strict(),
          )
          .min(1)
          .max(16)
          .optional(),
        spectators: z.boolean().optional(),
        lateJoin: z.boolean().optional(),
        maxDurationSeconds: z.number().int().min(10).max(3600).optional(),
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
    if (d.play?.roles) {
      if (
        new Set(d.play.roles.map((role) => role.id)).size !==
        d.play.roles.length
      )
        c.addIssue({
          code: 'custom',
          path: ['play', 'roles'],
          message: 'Role ids must be unique.',
        })
      if (
        d.play.roles.reduce((sum, role) => sum + role.count, 0) !==
        d.play.seats.default
      )
        c.addIssue({
          code: 'custom',
          path: ['play', 'roles'],
          message: 'Role counts must equal the default seat count.',
        })
    }
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
export const gameDocumentSchema = z.discriminatedUnion('kind', [
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
/** Minimal managed game demonstrating the shared live contract without genre-specific UI. */
export const exampleDocument: BrowserGameDocument = {
  kind: 'browser',
  title: 'Signal Relay',
  description:
    'Send five signals together. A small cooperative example with authoritative state and per-seat feedback.',
  entryFile: 'index.html',
  play: {
    mode: 'turn-based',
    seats: { min: 1, max: 8, default: 2 },
    maxDecisionsPerSecond: 2,
  },
  runtime: {
    kind: 'sandboxed-script',
    entryFile: 'rules.js',
    tickRate: 30,
    memoryMiB: 16,
    timeoutMs: 20,
  },
  files: [
    {
      path: 'index.html',
      content: `<!doctype html><html><body style="font:20px system-ui;text-align:center;padding:40px"><h1>Signal Relay</h1><p id="progress">Connect to send signals together.</p><button onclick="window.arcade.submit({id:'signal'})">Send signal</button><script>window.arcade={render:function(state){if(!state)return;document.getElementById('progress').textContent=state.signals+' / 5 signals';document.querySelector('button').disabled=state.signals>=5}}</script></body></html>`,
    },
    {
      path: 'rules.js',
      content: `globalThis.arcadeGame={
      initialize:context=>({signals:0,seats:context.roster.map(seat=>seat.seatId)}),
      validateAction:(state,action,context)=>!state.seats.includes(context.seatId)?'Unknown seat':action.id!=='signal'?'Choose signal':state.signals>=5?'Complete':null,
      applyAction:state=>({state:{...state,signals:state.signals+1},events:[]}),
      observe:(state,seatId)=>({visibleState:{signals:state.signals,you:{seatId},others:state.seats.filter(id=>id!==seatId).map(seatId=>({seatId}))},legalActions:state.signals<5?[{id:'signal',label:'Send signal'}]:[],feedback:{reward:state.signals/5,outcome:'neutral',summary:state.signals+' signals sent together.'}}),
      result:state=>state.signals>=5?{outcome:'complete',standings:state.seats.map(seatId=>({seatId,rank:1,score:state.signals}))}:null
    }`,
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
