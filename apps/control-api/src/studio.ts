import { Hono } from 'hono'
import { z } from 'zod'
import {
  compileGame,
  compilePresentation,
  documentDigest,
  emptyBrowserDocument,
  exampleDocument,
  gameDocumentSchema,
  releaseManifest,
  starterDocument,
  isBrowserGame,
  defaultGameDistribution,
  type StudioProject,
  type StudioRelease,
} from '@common-arcade/studio'
import {
  createPreferencePolicy,
  TicTacToeTestRun,
} from '@common-arcade/test-arena'
import {
  IdentityError,
  arcadeScopes,
  tokenHash,
  type AccessKey,
  type Principal,
} from './identity.js'
import {
  StoreConflict,
  type DocumentStore,
  type StoredDocument,
} from './store.js'
import {
  accessibleProjects,
  projectAccess,
  syncProjectMemberships,
  type ProjectPermission,
  type ProjectRecord,
} from './project-access.js'

/** How long a proposal may run before the studio stops waiting on it. */
const COPILOT_JOB_DEADLINE_MS = 590_000
type CopilotJob = StoredDocument & {
  id: string
  projectId: string
  agentId: string
  sessionId?: string
  status: 'running' | 'ready' | 'failed'
  startedAt: string
  finishedAt?: string
  response?: string
  projectRevision?: number
  events: CopilotActivity[]
  error?: string
}
type CopilotActivity = {
  sequence: number
  type: 'status' | 'tool'
  label: string
  status?: string
  tool?: string
  timestamp: string
}
export type CopilotJobInvocation = {
  jobId: string
  authorization: string
  input: {
    message: string
    attachments?: { fileId: string }[]
    model?: { provider: string; modelId: string }
  }
}
type CommonsProjectSession = StoredDocument & {
  projectId: string
  agentId: string
  sessionId: string
  createdAt: string
  messages: StudioConversationMessage[]
}
type StudioConversationMessage = {
  role: 'user' | 'assistant'
  text: string
  createdAt: string
  jobId?: string
}
type ReleaseRecord = StoredDocument & { release: StudioRelease }
type RunRecord = StoredDocument & {
  id: string
  project: StudioProject
  seed: string
  steps: number
  agents: string[]
  preferences: number[][]
  createdAt: string
}
const COPILOT_INSTRUCTIONS =
  'You are a Common Arcade copilot. Use the assigned build-common-arcade-games skill and the supplied Arcade tools. Read the current project before editing. Every browser game must declare its play mode and seat bounds and synchronously expose window.arcade.seats(), observe(seatId), actions(seatId), and step(actionId, seatId) with stable IDs and JSON-serializable observations. Realtime observations should include actionable derived timing such as time-to-impact rather than only raw positions. Declare capabilities for persistent worlds, teams, 3D presentation, and payment integration hooks when the game needs them; declarations do not activate unavailable hosting or payments. Blender assets must be exported to a web runtime format such as glTF/GLB and rendered through a declared web engine. Save with arcade_write_game, then run arcade_test_game and repair any failure before reporting completion. Report only actions that tools confirm.'
const ARCADE_COPILOT_TOOLS = [
  {
    name: 'arcade_read_project',
    description:
      'Read the current Common Arcade Studio project, including every source file, open annotation, revision, and project limit. Call before changing a game.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'arcade_write_game',
    description:
      'Validate and save a complete, agent-playable browser game into the current Common Arcade Studio project. Supply every authoritative source file, the play contract, and a synchronous window.arcade bridge with seats, observe, actions, and step. Replaces the prior game and creates a revision.',
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Game title, at most 100 characters.',
        },
        description: {
          type: 'string',
          description: 'Short description of the playable game.',
        },
        entryFile: {
          type: 'string',
          description: 'HTML entry file path, usually index.html.',
        },
        dependencies: {
          type: 'object',
          description:
            'Optional npm packages mapped to exact semantic versions.',
          additionalProperties: { type: 'string' },
        },
        play: {
          type: 'object',
          description:
            'Playable seat and cadence contract used by Studio and release manifests.',
          properties: {
            mode: {
              type: 'string',
              enum: ['turn-based', 'simultaneous', 'realtime', 'hybrid'],
            },
            seats: {
              type: 'object',
              properties: {
                min: { type: 'integer', minimum: 1, maximum: 16 },
                max: { type: 'integer', minimum: 1, maximum: 16 },
                default: { type: 'integer', minimum: 1, maximum: 16 },
              },
              required: ['min', 'max', 'default'],
              additionalProperties: false,
            },
            maxDecisionsPerSecond: {
              type: 'integer',
              minimum: 1,
              maximum: 20,
            },
          },
          required: ['mode', 'seats', 'maxDecisionsPerSecond'],
          additionalProperties: false,
        },
        capabilities: {
          type: 'object',
          description:
            'Optional requirements for richer games. These declarations make future runtime, team, asset and payment integrations explicit without claiming they are active.',
          properties: {
            genres: {
              type: 'array',
              items: { type: 'string' },
              maxItems: 12,
            },
            world: {
              type: 'object',
              properties: {
                persistence: {
                  type: 'string',
                  enum: ['session', 'campaign', 'persistent-world'],
                },
                authority: {
                  type: 'string',
                  enum: [
                    'browser-preview',
                    'arcade-managed',
                    'external-conformant-host',
                  ],
                },
                cadence: {
                  type: 'string',
                  enum: ['turn', 'window', 'fixed-tick', 'event-driven'],
                },
                checkpointing: {
                  type: 'string',
                  enum: ['end-only', 'periodic', 'event-and-periodic'],
                },
              },
              required: [
                'persistence',
                'authority',
                'cadence',
                'checkpointing',
              ],
              additionalProperties: false,
            },
            presentation: {
              type: 'object',
              properties: {
                dimension: { type: 'string', enum: ['2d', '3d', 'mixed'] },
                engine: {
                  type: 'string',
                  enum: [
                    'dom',
                    'canvas',
                    'phaser',
                    'pixi',
                    'three',
                    'react-three-fiber',
                    'babylon',
                    'playcanvas',
                    'custom-webgl',
                  ],
                },
                contentPipeline: {
                  type: 'object',
                  properties: {
                    authoringTools: {
                      type: 'array',
                      items: {
                        type: 'string',
                        enum: ['blender', 'procedural', 'other'],
                      },
                    },
                    runtimeFormats: {
                      type: 'array',
                      items: {
                        type: 'string',
                        enum: [
                          'html',
                          'svg',
                          'png',
                          'webp',
                          'spritesheet',
                          'gltf',
                          'glb',
                          'ktx2',
                          'basis',
                        ],
                      },
                    },
                  },
                  required: ['authoringTools', 'runtimeFormats'],
                  additionalProperties: false,
                },
              },
              required: ['dimension', 'engine'],
              additionalProperties: false,
            },
            teams: {
              type: 'object',
              properties: {
                enabled: { type: 'boolean' },
                maxTeams: { type: 'integer', minimum: 1, maximum: 32 },
                membersPerTeam: {
                  type: 'integer',
                  minimum: 1,
                  maximum: 64,
                },
                control: {
                  type: 'string',
                  enum: ['individual', 'centralized', 'hybrid'],
                },
                sharedStrategy: { type: 'boolean' },
              },
              required: [
                'enabled',
                'maxTeams',
                'membersPerTeam',
                'control',
                'sharedStrategy',
              ],
              additionalProperties: false,
            },
            economy: {
              type: 'object',
              properties: {
                payments: {
                  type: 'string',
                  enum: ['disabled', 'integration-ready'],
                },
                valueMode: {
                  type: 'string',
                  enum: ['none', 'virtual', 'regulated'],
                },
                hooks: {
                  type: 'array',
                  items: {
                    type: 'string',
                    enum: [
                      'entry-authorization',
                      'escrow-reservation',
                      'settlement-proposal',
                      'refund-proposal',
                      'ledger-export',
                    ],
                  },
                },
              },
              required: ['payments', 'valueMode', 'hooks'],
              additionalProperties: false,
            },
          },
          required: ['world', 'presentation', 'teams', 'economy'],
          additionalProperties: false,
        },
        files: {
          type: 'array',
          description: 'Every complete source file in the game.',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              content: { type: 'string' },
            },
            required: ['path', 'content'],
            additionalProperties: false,
          },
        },
      },
      required: ['title', 'description', 'entryFile', 'play', 'files'],
      additionalProperties: false,
    },
  },
  {
    name: 'arcade_test_game',
    description:
      'Compile and validate the current saved game through the same isolated presentation pipeline used by Studio. Repair and retry if it reports an error.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'arcade_publish_game',
    description:
      'Publish the current validated game as an immutable Common Arcade release. Use only when the user asks to publish or make the game live.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
] as const
const id = (prefix: string) =>
  `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
const expected = z.coerce.number().int().positive()
const annotationBody = z
  .object({
    body: z.string().trim().min(1).max(4000),
    revision: z.number().int().positive(),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().min(0).max(1).optional(),
    height: z.number().min(0).max(1).optional(),
    entityId: z.string().max(100).optional(),
    tick: z.number().int().nonnegative().optional(),
    context: z
      .object({
        viewport: z.object({ width: z.literal(1280), height: z.literal(720) }),
        moment: z.unknown().optional(),
        observation: z.unknown().optional(),
        snapshotRecordingId: z
          .string()
          .regex(/^rec_[a-f0-9]{32}$/)
          .optional(),
      })
      .optional(),
  })
  .strict()

export function createStudioApi(
  store: DocumentStore,
  authenticate: (authorization?: string, scope?: string) => Promise<Principal>,
  options: {
    workerSecret?: string
    dispatchCopilotJob?: (invocation: CopilotJobInvocation) => Promise<void>
  } = {},
) {
  const app = new Hono()
  const owned = (
    actorId: string,
    projectId: string,
    permission: ProjectPermission = 'edit',
  ) => projectAccess(store, actorId, projectId, permission)
  const checkSize = (project: StudioProject) => {
    if (new TextEncoder().encode(JSON.stringify(project)).length > 340000)
      throw new IdentityError(
        403,
        'Project context reached its storage limit. Export older notes before adding more.',
      )
  }
  const save = async (record: ProjectRecord, project: StudioProject) => {
    checkSize(project)
    await store.put(
      `owner:${project.ownerId}`,
      project.id,
      { version: record.version + 1, project },
      record.version,
    )
    return project
  }
  const revision = async (p: StudioProject) => {
    checkSize(p)
    // Immutable snapshots are written first. A failed CAS can only leave an unreferenced snapshot.
    await store
      .put(`revisions:${p.id}`, `${p.revision}:${p.digest}`, {
        version: 1,
        project: p,
      })
      .catch((e) => {
        if (!(e instanceof StoreConflict)) throw e
      })
  }
  app.get('/v1/me', async (c) => {
    const p = await authenticate(c.req.header('Authorization'))
    return c.json({ id: p.id, provider: p.provider, scopes: p.scopes })
  })
  /**
   * Gives a new account something finished to open. The id is derived from the
   * owner so a repeated seed is a conflict rather than a duplicate, and the
   * project is an ordinary owned project afterwards: editable, playable and
   * publishable, with nothing special-cased about it.
   */
  const seedExampleProject = async (owner: string) => {
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(`arcade-example:${owner}`),
    )
    const projectId = `prj_${Array.from(
      new Uint8Array(digest).slice(0, 16),
      (n) => n.toString(16).padStart(2, '0'),
    ).join('')}`
    const now = new Date().toISOString()
    const project: StudioProject = {
      id: projectId,
      ownerId: owner,
      revision: 1,
      digest: await documentDigest(exampleDocument),
      document: exampleDocument,
      annotations: [],
      createdAt: now,
      updatedAt: now,
    }
    await revision(project)
    await store.put(`owner:${owner}`, projectId, { version: 1, project })
    return project
  }
  app.get('/v1/projects', async (c) => {
    const p = await authenticate(c.req.header('Authorization'), 'projects:read')
    let projects = await accessibleProjects(store, p.id)
    if (!projects.length) {
      // A failed seed must never block the listing: an empty studio is a far
      // smaller problem than a studio that will not open at all.
      const example = await seedExampleProject(p.id).catch(() => undefined)
      if (example) projects = [example]
    }
    return c.json({ projects })
  })
  app.post('/v1/projects', async (c) => {
    const p = await authenticate(
      c.req.header('Authorization'),
      'projects:write',
    )
    const body = z
      .object({ document: gameDocumentSchema.optional() })
      .strict()
      .parse(await c.req.json())
    const document = body.document ?? emptyBrowserDocument,
      now = new Date().toISOString()
    const project: StudioProject = {
      id: id('prj'),
      ownerId: p.id,
      revision: 1,
      digest: await documentDigest(document),
      document,
      annotations: [],
      createdAt: now,
      updatedAt: now,
    }
    await revision(project)
    await store.put(`owner:${p.id}`, project.id, { version: 1, project })
    return c.json(project, 201)
  })
  app.get('/v1/projects/:id', async (c) => {
    const p = await authenticate(c.req.header('Authorization'), 'projects:read')
    return c.json((await owned(p.id, c.req.param('id'), 'view')).project)
  })
  app.put('/v1/projects/:id', async (c) => {
    const p = await authenticate(
        c.req.header('Authorization'),
        'projects:write',
      ),
      record = await owned(p.id, c.req.param('id'))
    if (expected.parse(c.req.header('If-Match')) !== record.project.revision)
      throw new StoreConflict()
    const document = gameDocumentSchema.parse(await c.req.json())
    compilePresentation(document)
    const project = {
      ...record.project,
      document,
      digest: await documentDigest(document),
      revision: record.project.revision + 1,
      updatedAt: new Date().toISOString(),
    }
    await revision(project)
    return c.json(await save(record, project))
  })
  app.get('/v1/projects/:id/revisions', async (c) => {
    const p = await authenticate(c.req.header('Authorization'), 'projects:read')
    const { project } = await owned(p.id, c.req.param('id'), 'view')
    return c.json({
      revisions: (await store.list<ProjectRecord>(`revisions:${project.id}`))
        .filter((r) => r.project.revision <= project.revision)
        .map((r) => r.project)
        .sort((a, b) => b.revision - a.revision),
    })
  })
  app.post('/v1/projects/:id/annotations', async (c) => {
    const p = await authenticate(
        c.req.header('Authorization'),
        'projects:write',
      ),
      record = await owned(p.id, c.req.param('id'), 'comment'),
      body = annotationBody.parse(await c.req.json())
    const targetRevision =
      body.revision === record.project.revision
        ? record.project
        : (await store.list<ProjectRecord>(`revisions:${record.project.id}`))
            .map((candidate) => candidate.project)
            .find((candidate) => candidate.revision === body.revision)
    if (!targetRevision) throw new StoreConflict()
    if (record.project.annotations.length >= 50)
      throw new IdentityError(
        403,
        'This project has reached its 50-note limit.',
      )
    return c.json(
      await save(record, {
        ...record.project,
        annotations: [
          ...record.project.annotations,
          {
            ...body,
            id: id('ann'),
            digest: targetRevision.digest,
            status: 'open',
            createdAt: new Date().toISOString(),
          },
        ],
      }),
    )
  })
  app.patch('/v1/projects/:id/annotations/:annotationId', async (c) => {
    const p = await authenticate(
        c.req.header('Authorization'),
        'projects:write',
      ),
      record = await owned(p.id, c.req.param('id'), 'comment')
    const body = z
      .object({ status: z.enum(['open', 'resolved']) })
      .strict()
      .parse(await c.req.json())
    return c.json(
      await save(record, {
        ...record.project,
        annotations: record.project.annotations.map((a) =>
          a.id === c.req.param('annotationId')
            ? { ...a, status: body.status }
            : a,
        ),
      }),
    )
  })
  app.post('/v1/projects/:id/publish', async (c) => {
    const p = await authenticate(
        c.req.header('Authorization'),
        'releases:publish',
      ),
      record = await owned(p.id, c.req.param('id')),
      project = record.project
    if (project.ownerId !== p.id)
      throw new IdentityError(
        403,
        'Only the project owner can publish releases.',
      )
    if (expected.parse(c.req.header('If-Match')) !== project.revision)
      throw new StoreConflict()
    compilePresentation(project.document)
    const releaseId = `rel_${project.id.slice(4)}_${project.revision}_${project.digest.slice(7, 19)}`
    const existing = await store.get<ReleaseRecord>('releases', releaseId)
    if (existing) return c.json(existing.release)
    const release: StudioRelease = {
      id: releaseId,
      projectId: project.id,
      revision: project.revision,
      document: project.document,
      digest: project.digest,
      manifest: await releaseManifest(project, releaseId),
      ownerId: project.ownerId,
      distribution: project.document.distribution ?? defaultGameDistribution,
      publishedAt: new Date().toISOString(),
    }
    await store.put('releases', releaseId, { version: 1, release })
    await save(record, { ...project, releaseId })
    return c.json(release, 201)
  })
  app.get('/v1/studio/releases/:id', async (c) => {
    const record = await store.get<ReleaseRecord>('releases', c.req.param('id'))
    if (!record) return c.json({ error: 'Release not found' }, 404)
    return c.json(record.release)
  })
  app.put('/v1/projects/:id/collaborators', async (c) => {
    const p = await authenticate(
      c.req.header('Authorization'),
      'projects:write',
    )
    const record = await owned(p.id, c.req.param('id'))
    if (record.project.ownerId !== p.id)
      throw new IdentityError(403, 'Only the project owner can manage access.')
    const body = z
      .object({
        collaborators: z
          .array(
            z
              .object({
                actorId: z.string().trim().min(1).max(200),
                permissions: z
                  .array(z.enum(['test', 'comment', 'edit']))
                  .min(1)
                  .max(3),
              })
              .strict(),
          )
          .max(50),
      })
      .strict()
      .parse(await c.req.json())
    if (
      new Set(body.collaborators.map((member) => member.actorId)).size !==
      body.collaborators.length
    )
      throw new IdentityError(403, 'Each collaborator may appear only once.')
    const project: StudioProject = {
      ...record.project,
      collaborators: body.collaborators.map((member) => ({
        actorId: member.actorId,
        permissions: [...new Set(member.permissions)],
      })),
      updatedAt: new Date().toISOString(),
    }
    await syncProjectMemberships(store, record.project.collaborators, project)
    return c.json(await save(record, project))
  })
  app.post('/v1/studio/releases/:id/fork', async (c) => {
    const p = await authenticate(
      c.req.header('Authorization'),
      'projects:write',
    )
    const record = await store.get<ReleaseRecord>('releases', c.req.param('id'))
    if (!record) return c.json({ error: 'Release not found' }, 404)
    const original = await projectAccess(
      store,
      p.id,
      record.release.projectId,
      'view',
    ).catch(() => undefined)
    if (original) return c.json(original.project)
    const distribution = record.release.distribution ?? defaultGameDistribution
    if (distribution.remixing !== 'allowed')
      throw new IdentityError(
        403,
        'The creator has not enabled remixes for this release.',
      )
    const now = new Date().toISOString()
    const project: StudioProject = {
      id: id('prj'),
      ownerId: p.id,
      revision: 1,
      digest: await documentDigest(record.release.document),
      document: record.release.document,
      annotations: [],
      forkedFrom: {
        releaseId: record.release.id,
        digest: record.release.digest,
        originalCreatorId:
          record.release.ownerId ??
          record.release.manifest.metadata.publisher.id,
      },
      createdAt: now,
      updatedAt: now,
    }
    await revision(project)
    await store.put(`owner:${p.id}`, project.id, { version: 1, project })
    return c.json(
      {
        ...project,
        forkedFrom: project.forkedFrom,
      },
      201,
    )
  })
  app.get('/v1/studio/releases/:id/preview', async (c) => {
    const record = await store.get<ReleaseRecord>('releases', c.req.param('id'))
    if (!record) return c.text('Release not found', 404)
    c.header(
      'Content-Security-Policy',
      "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' https://esm.sh; connect-src https://esm.sh; img-src data: blob: https:; media-src data: blob: https:; style-src 'unsafe-inline'; frame-ancestors *",
    )
    return c.html(compilePresentation(record.release.document))
  })
  const executeRun = async (r: RunRecord, steps: number) => {
    const releaseId = `rel_${r.project.id.slice(4)}_${r.project.revision}`
    const policies = await Promise.all(
      r.preferences.map((preferredCells, index) =>
        createPreferencePolicy({
          id: `pol_${r.id}_${index}`,
          name: `arcade-player-${index + 1}`,
          preferredCells,
          releaseId,
        }),
      ),
    )
    const run = await TicTacToeTestRun.create({
      runId: r.id,
      matchId: r.id.replace('tst_', 'mat_'),
      seed: r.seed,
      game: compileGame(r.project.document, releaseId, r.project.digest),
      controllers: policies.map((policy, index) => ({
        seatId: `sea_${r.id}_${index}`,
        policy,
      })),
      now: () => new Date(r.createdAt),
    })
    for (let i = 0; i < steps; i++) await run.step()
    return {
      ...(await run.result()),
      projectId: r.project.id,
      document: r.project.document,
      revision: r.project.revision,
      digest: r.project.digest,
      agents: r.agents,
      seed: r.seed,
    }
  }
  app.post('/v1/projects/:id/runs', async (c) => {
    const p = await authenticate(
        c.req.header('Authorization'),
        'projects:write',
      ),
      { project } = await owned(p.id, c.req.param('id'), 'test')
    const body = z
      .object({
        seed: z.string().max(200).default('studio-42'),
        agents: z.array(z.string().max(200)).length(2).optional(),
        preferences: z
          .array(z.array(z.number().int().nonnegative()).max(64))
          .length(2)
          .optional(),
      })
      .strict()
      .parse(await c.req.json())
    if (body.agents) {
      if (p.provider !== 'commons')
        throw new IdentityError(
          403,
          'Use a Commons session to attach Commons agents.',
        )
      for (const agentId of body.agents)
        await commonsRequest(p, `/v1/agents/${encodeURIComponent(agentId)}`)
    }
    if (isBrowserGame(project.document))
      throw new IdentityError(
        403,
        'Use browser playtesting for this project. Grid policies only apply to grid games.',
      )
    const cells = Array.from(
      { length: project.document.boardSize ** 2 },
      (_, i) => i,
    )
    let preferences = body.preferences
    if (!preferences && body.agents) {
      preferences = await Promise.all(
        body.agents.map(async (agentId, index) => {
          const result = await commonsRequest(p, '/v1/agents/run', {
            agentId,
            initiatorId: p.id,
            messages: [
              {
                role: 'user',
                content: `Choose a deterministic cell preference policy for seat ${index + 1}. Game: ${JSON.stringify(project.document)}. Seed: ${body.seed}. Return ONLY JSON: {"preferredCells": [all cell indices in priority order]}. Cells are row-major integers 0 through ${cells.length - 1}. Prefer winning opportunities through strong openings. No tools.`,
              },
            ],
          })
          const plan = z
            .object({
              preferredCells: z
                .array(
                  z
                    .number()
                    .int()
                    .min(0)
                    .max(cells.length - 1),
                )
                .min(1)
                .max(64),
            })
            .parse(extractAgentJson(result))
          return [...new Set([...plan.preferredCells, ...cells])]
        }),
      )
    }
    const r: RunRecord = {
      version: 1,
      id: id('tst'),
      project: { ...project, annotations: [] },
      seed: body.seed,
      steps: 0,
      agents: body.agents ?? [
        'Built-in center policy',
        'Built-in corner policy',
      ],
      preferences: preferences ?? [
        [Math.floor(cells.length / 2), ...cells],
        [...cells].reverse(),
      ],
      createdAt: new Date().toISOString(),
    }
    await store.put(`runs:${p.id}`, r.id, r)
    return c.json(await executeRun(r, 0), 201)
  })
  app.get('/v1/studio/runs/:id', async (c) => {
    const p = await authenticate(
        c.req.header('Authorization'),
        'projects:read',
      ),
      r = await store.get<RunRecord>(`runs:${p.id}`, c.req.param('id'))
    if (!r) throw new IdentityError(403, 'Run is unavailable to this account.')
    return c.json(await executeRun(r, r.steps))
  })
  app.post('/v1/studio/runs/:id/step', async (c) => {
    const p = await authenticate(
        c.req.header('Authorization'),
        'projects:write',
      ),
      r = await store.get<RunRecord>(`runs:${p.id}`, c.req.param('id'))
    if (!r) throw new IdentityError(403, 'Run is unavailable to this account.')
    const body = z
      .object({ steps: z.number().int().nonnegative().max(64) })
      .strict()
      .parse(await c.req.json())
    if (body.steps !== r.steps) throw new StoreConflict()
    const result = await executeRun(
      r,
      Math.min(
        r.steps + 1,
        isBrowserGame(r.project.document)
          ? 0
          : r.project.document.boardSize ** 2,
      ),
    )
    await store.put(
      `runs:${p.id}`,
      r.id,
      { ...r, steps: result.steps, version: r.version + 1 },
      r.version,
    )
    return c.json(result)
  })
  app.get('/v1/access-keys', async (c) => {
    const p = await authenticate(c.req.header('Authorization'), 'keys:manage')
    if (p.provider === 'api-key')
      throw new IdentityError(403, 'Use your Commons session to manage keys.')
    return c.json({
      keys: (await store.list<AccessKey>(`keys:${p.id}`)).map(
        ({ hash, ...key }) => ({ ...key, id: hash }),
      ),
    })
  })
  app.post('/v1/access-keys', async (c) => {
    const p = await authenticate(c.req.header('Authorization'), 'keys:manage')
    if (p.provider === 'api-key')
      throw new IdentityError(403, 'Use your Commons session to manage keys.')
    const body = z
      .object({
        name: z.string().min(1).max(100),
        scopes: z.array(z.enum(arcadeScopes)).min(1),
        days: z.number().int().min(1).max(90).default(30),
      })
      .strict()
      .parse(await c.req.json())
    if (body.scopes.some((s) => s === 'keys:manage' || !p.scopes.includes(s)))
      throw new IdentityError(
        403,
        'Access keys cannot escalate permissions or manage other keys.',
      )
    const token = `arc_${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url')}`,
      hash = await tokenHash(token)
    const key: AccessKey = {
      version: 1,
      hash,
      ownerId: p.id,
      name: body.name,
      scopes: body.scopes,
      expiresAt: Date.now() + body.days * 86400000,
      revoked: false,
      createdAt: new Date().toISOString(),
    }
    await store.put(`keys:${p.id}`, hash, key)
    await store.put('access-keys', hash, key)
    return c.json(
      { token, id: hash, expiresAt: key.expiresAt, scopes: key.scopes },
      201,
    )
  })
  app.delete('/v1/access-keys/:id', async (c) => {
    const p = await authenticate(c.req.header('Authorization'), 'keys:manage')
    if (p.provider === 'api-key')
      throw new IdentityError(403, 'Use your Commons session to manage keys.')
    const key = await store.get<AccessKey>('access-keys', c.req.param('id'))
    if (!key || key.ownerId !== p.id)
      throw new IdentityError(403, 'Key is unavailable to this account.')
    await store.put(
      'access-keys',
      key.hash,
      { ...key, revoked: true, version: key.version + 1 },
      key.version,
    )
    await store.put(
      `keys:${p.id}`,
      key.hash,
      { ...key, revoked: true, version: key.version + 1 },
      key.version,
    )
    return c.json({ revoked: true })
  })
  app.get('/v1/commons/models', async (c) => {
    const p = await authenticate(c.req.header('Authorization'), 'projects:read')
    return c.json({ models: await commonsRequest(p, '/v1/models') })
  })
  app.get('/v1/commons/agents', async (c) => {
    const p = await authenticate(c.req.header('Authorization'), 'projects:read')
    return c.json({
      agents: await commonsRequest(
        p,
        `/v1/agents?owner=${encodeURIComponent(p.id)}`,
      ),
    })
  })
  app.post('/v1/commons/agents', async (c) => {
    const p = await authenticate(
      c.req.header('Authorization'),
      'projects:write',
    )
    const body = z
      .object({
        name: z.string().trim().min(1).max(100),
        role: z.enum(['copilot', 'player']),
      })
      .strict()
      .parse(await c.req.json())
    const agent = await createCommonsAgent(p, body.name, body.role)
    return c.json(agent, 201)
  })
  async function createCommonsAgent(
    p: Principal,
    name: string,
    role: 'copilot' | 'player',
  ) {
    const agent = (await commonsRequest(p, '/v1/agents', {
      name: name,
      owner: p.id,
      ownerUserId: p.id,
      modelProvider: process.env.ARCADE_AGENT_MODEL_PROVIDER ?? 'openai',
      modelId: process.env.ARCADE_AGENT_MODEL_ID ?? 'gpt-5.4-mini',
      temperature: 0.3,
      instructions:
        role === 'copilot'
          ? COPILOT_INSTRUCTIONS
          : 'You are a Common Arcade player agent. Follow the configured strategy, choose only legal actions exposed for your seat, and report only actions that tools confirm.',
      commonTools: [
        'invoke_skill',
        'startAgentComputer',
        'runComputerCommand',
        'readComputerFile',
        'writeComputerFiles',
        'openComputerBrowser',
        'testComputerBrowser',
      ],
      externalTools: [],
      metadata: { source: 'common_arcade', role: role },
    })) as { agentId?: string }
    if (!agent.agentId) throw new Error('Commons returned an invalid agent.')
    await assignArcadeSkill(p, agent.agentId)
    return agent
  }
  const assignArcadeSkill = async (p: Principal, agentId: string) =>
    commonsRequestMethod(
      p,
      `/v1/skills/build-common-arcade-games/agents/${encodeURIComponent(agentId)}`,
      'PUT',
      { isEnabled: true },
    )
  app.post('/v1/commons/copilot', async (c) => {
    const p = await authenticate(
      c.req.header('Authorization'),
      'projects:write',
    )
    const partition = `commons:${p.id}`
    type CopilotRecord = StoredDocument & {
      agentId?: string
      pendingUntil?: number
    }
    const current = await store.get<CopilotRecord>(partition, 'copilot')
    if (current?.agentId) {
      const agent = await commonsRequest(
        p,
        `/v1/agents/${encodeURIComponent(current.agentId)}`,
      )
      await commonsRequestMethod(
        p,
        `/v1/agents/${encodeURIComponent(current.agentId)}`,
        'PUT',
        {
          instructions: COPILOT_INSTRUCTIONS,
          commonTools: [
            'invoke_skill',
            'startAgentComputer',
            'runComputerCommand',
            'readComputerFile',
            'writeComputerFiles',
            'openComputerBrowser',
            'testComputerBrowser',
          ],
        },
      )
      await assignArcadeSkill(p, current.agentId)
      return c.json(agent)
    }
    if ((current?.pendingUntil ?? 0) > Date.now()) throw new StoreConflict()
    const result = (await commonsRequest(
      p,
      `/v1/agents?owner=${encodeURIComponent(p.id)}`,
    )) as any
    const agents = Array.isArray(result) ? result : (result.agents ?? [])
    const existing = agents.find(
      (a: any) =>
        a.metadata?.source === 'common_arcade' &&
        a.metadata?.role === 'copilot',
    )
    const version = (current?.version ?? 0) + 1
    await store.put(
      partition,
      'copilot',
      { version, pendingUntil: Date.now() + 120000 },
      current?.version,
    )
    try {
      const agent =
        existing ??
        ((await createCommonsAgent(p, 'Arcade Copilot', 'copilot')) as any)
      if (!agent.agentId) throw new Error('Commons returned an invalid agent.')
      if (existing) {
        await commonsRequestMethod(
          p,
          `/v1/agents/${encodeURIComponent(agent.agentId)}`,
          'PUT',
          {
            instructions: COPILOT_INSTRUCTIONS,
            commonTools: [
              'invoke_skill',
              'startAgentComputer',
              'runComputerCommand',
              'readComputerFile',
              'writeComputerFiles',
              'openComputerBrowser',
              'testComputerBrowser',
            ],
          },
        )
        await assignArcadeSkill(p, agent.agentId)
      }
      await store.put(
        partition,
        'copilot',
        { version: version + 1, agentId: agent.agentId },
        version,
      )
      return c.json(agent)
    } catch (error) {
      await store.put(
        partition,
        'copilot',
        { version: version + 1, pendingUntil: 0 },
        version,
      )
      throw error
    }
  })
  app.get('/v1/projects/:id/copilot-session', async (c) => {
    const p = await authenticate(c.req.header('Authorization'), 'projects:read')
    const { project } = await owned(p.id, c.req.param('id'))
    const agentId = z.string().min(1).max(200).parse(c.req.query('agentId'))
    const current = await store.get<CommonsProjectSession>(
      `commons-project-sessions:${p.id}`,
      commonsProjectSessionKey(project.id, agentId),
    )
    return c.json(
      current ?? {
        projectId: project.id,
        agentId,
        messages: [],
      },
    )
  })
  app.post('/v1/projects/:id/copilot', async (c) => {
    const p = await authenticate(
        c.req.header('Authorization'),
        'projects:write',
      ),
      { project } = await owned(p.id, c.req.param('id'))
    const body = z
      .object({
        message: z
          .string()
          .max(8000)
          .refine((value) => value.trim().length > 0, 'Message is required'),
        agentId: z.string().min(1).max(200),
        model: z
          .object({
            provider: z.string().min(1).max(40),
            modelId: z.string().min(1).max(120),
          })
          .strict()
          .optional(),
        attachments: z
          .array(z.object({ fileId: z.string().min(1).max(200) }).strict())
          .max(20)
          .optional(),
      })
      .strict()
      .parse(await c.req.json())
    await commonsRequest(p, `/v1/agents/${encodeURIComponent(body.agentId)}`)
    const sessionId = await ensureCommonsProjectSession(
      p,
      project,
      body.agentId,
    )
    // Building a game routinely takes minutes, and every CDN and gateway in
    // front of this service closes a response long before then. The run is
    // started here and its result is collected by polling, so a slow game is a
    // slow job rather than a failed request.
    const jobId = id('job')
    const job: CopilotJob = {
      version: 1,
      id: jobId,
      projectId: project.id,
      agentId: body.agentId,
      sessionId,
      status: 'running',
      startedAt: new Date().toISOString(),
      events: [],
    }
    await store.put(`copilot:${p.id}`, jobId, job)
    await appendCommonsProjectHistory(p, project, body.agentId, {
      role: 'user',
      text: body.message,
      createdAt: job.startedAt,
      jobId,
    })
    const invocation: CopilotJobInvocation = {
      jobId,
      authorization: `Bearer ${p.token}`,
      input: {
        message: body.message,
        attachments: body.attachments,
        model: body.model,
      },
    }
    if (options.dispatchCopilotJob) await options.dispatchCopilotJob(invocation)
    else void runCopilotJob(p, job, invocation.input)
    return c.json({ jobId, status: 'running' as const }, 202)
  })
  app.post('/v1/internal/copilot-jobs/:jobId/run', async (c) => {
    if (
      !options.workerSecret ||
      c.req.header('X-Arcade-Worker-Secret') !== options.workerSecret
    )
      return c.json({ error: 'Not found' }, 404)
    const p = await authenticate(
      c.req.header('Authorization'),
      'projects:write',
    )
    const invocation = z
      .object({
        message: z.string().min(1),
        attachments: z
          .array(z.object({ fileId: z.string().min(1) }).strict())
          .optional(),
        model: z
          .object({ provider: z.string().min(1), modelId: z.string().min(1) })
          .strict()
          .optional(),
      })
      .strict()
      .parse(await c.req.json()) as CopilotJobInvocation['input']
    const job = await store.get<CopilotJob>(
      `copilot:${p.id}`,
      c.req.param('jobId'),
    )
    if (!job || job.status !== 'running')
      return c.json({ error: 'Job is unavailable' }, 404)
    await runCopilotJob(p, job, invocation)
    return c.json({ ok: true })
  })
  /**
   * Reports on a running proposal. A job whose host died mid-run would
   * otherwise stay "running" forever, so a job past its deadline reads as
   * failed rather than leaving the studio waiting on nothing.
   */
  app.get('/v1/studio/copilot-jobs/:jobId', async (c) => {
    const p = await authenticate(c.req.header('Authorization'), 'projects:read')
    const job = await store.get<CopilotJob>(
      `copilot:${p.id}`,
      c.req.param('jobId'),
    )
    if (!job)
      return c.json({ error: 'This request is no longer available.' }, 404)
    if (
      job.status === 'running' &&
      Date.now() - Date.parse(job.startedAt) > COPILOT_JOB_DEADLINE_MS
    )
      return c.json({
        jobId: job.id,
        status: 'failed',
        error:
          'The agent did not finish in time. Try again, or ask for a smaller change.',
      })
    return c.json({
      jobId: job.id,
      status: job.status,
      ...(job.status === 'ready'
        ? {
            response: job.response,
            projectRevision: job.projectRevision,
            agentId: job.agentId,
            sessionId: job.sessionId,
            durationSeconds: Math.max(
              0,
              Math.round(
                (Date.parse(job.finishedAt ?? new Date().toISOString()) -
                  Date.parse(job.startedAt)) /
                  1000,
              ),
            ),
          }
        : {}),
      events: job.events,
      ...(job.status === 'failed' ? { error: job.error } : {}),
    })
  })
  /**
   * Runs one proposal to completion and records the outcome. It never rejects:
   * a failure belongs in the job so the studio can show the creator what went
   * wrong, not in an unhandled rejection on the server.
   */
  async function runCopilotJob(
    p: Principal,
    job: CopilotJob,
    input: {
      message: string
      attachments?: { fileId: string }[]
      model?: { provider: string; modelId: string }
    },
  ) {
    let current = job
    const persist = async (patch: Partial<CopilotJob>, finished = false) => {
      const next: CopilotJob = {
        ...current,
        ...patch,
        version: current.version + 1,
        ...(finished ? { finishedAt: new Date().toISOString() } : {}),
      }
      await store.put(`copilot:${p.id}`, job.id, next, current.version)
      current = next
    }
    const activity = async (
      event: Omit<CopilotActivity, 'sequence' | 'timestamp'>,
    ) => {
      const previous = current.events.at(-1)
      const next = {
        ...event,
        sequence:
          event.type === 'tool' &&
          previous?.type === 'tool' &&
          previous.tool === event.tool &&
          previous.status === 'running'
            ? previous.sequence
            : current.events.length + 1,
        timestamp: new Date().toISOString(),
      }
      await persist({
        events:
          next.sequence === previous?.sequence
            ? [...current.events.slice(0, -1), next]
            : [...current.events, next].slice(-120),
      })
    }
    try {
      await assignArcadeSkill(p, job.agentId)
      let response = ''
      for await (const event of commonsAgentStream(p, {
        agentId: job.agentId,
        sessionId: job.sessionId,
        initiatorId: p.id,
        messages: [{ role: 'user', content: input.message }],
        attachments: input.attachments,
        model: input.model,
        computerRequest: { enabled: true },
        cliContext: `Common Arcade Studio project ${job.projectId} is connected through the supplied arcade_* tools. Read it first. A completed browser game must include the play contract and a synchronous, per-seat window.arcade bridge, then pass arcade_test_game.`,
        cliTools: ARCADE_COPILOT_TOOLS,
      })) {
        if (
          event.type === 'token' &&
          typeof event.content === 'string' &&
          (!event.phase || event.phase === 'final_answer')
        )
          response += event.content
        else if (event.type === 'final')
          response = response.trim() || agentEventText(event)
        else if (event.type === 'cli_tool_request') {
          const tool = String(event.tool ?? event.toolName ?? '')
          const requestId = String(event.requestId ?? '')
          await activity({
            type: 'tool',
            tool,
            label: copilotToolLabel(tool),
            status: 'running',
          })
          const result = await executeArcadeCopilotTool(
            p,
            job.projectId,
            tool,
            event.args,
          )
          if (requestId)
            await commonsRequest(p, '/v1/agents/cli-tool-result', {
              requestId,
              result,
            })
          await activity({
            type: 'tool',
            tool,
            label: copilotToolLabel(tool),
            status: result.includes('"error"') ? 'failed' : 'completed',
          })
        } else if (event.type === 'tool') {
          const tool = String(event.toolName ?? event.tool ?? event.name ?? '')
          if (tool)
            await activity({
              type: 'tool',
              tool,
              label: copilotToolLabel(tool),
              status: String(event.status ?? 'completed'),
            })
        } else if (event.type === 'status' && event.content) {
          await activity({
            type: 'status',
            label: String(event.content),
            status: String(event.status ?? 'running'),
          })
        } else if (event.type === 'error' || event.type === 'failed') {
          throw new CommonsServiceError(
            502,
            String(event.message ?? event.content ?? 'The agent run failed.'),
          )
        }
      }
      const latest = (await owned(p.id, job.projectId)).project
      await persist(
        {
          status: 'ready',
          response: response.trim() || 'Done.',
          projectRevision: latest.revision,
        },
        true,
      )
      await appendCommonsProjectHistory(p, latest, job.agentId, {
        role: 'assistant',
        text: response.trim() || 'Done.',
        createdAt: new Date().toISOString(),
        jobId: job.id,
      })
    } catch (error) {
      await persist(
        {
          status: 'failed',
          error:
            error instanceof CommonsServiceError ||
            error instanceof IdentityError
              ? error.message
              : error instanceof Error && error.name === 'TimeoutError'
                ? 'The agent did not finish in time. Try again, or ask for a smaller change.'
                : `The agent could not build this game: ${error instanceof Error ? error.message : 'unknown error'}.`,
        },
        true,
      ).catch(() => undefined)
    }
  }

  async function executeArcadeCopilotTool(
    p: Principal,
    projectId: string,
    tool: string,
    rawArgs: unknown,
  ) {
    try {
      const args =
        typeof rawArgs === 'string' ? JSON.parse(rawArgs) : (rawArgs ?? {})
      if (tool === 'arcade_read_project') {
        const { project } = await owned(p.id, projectId)
        return JSON.stringify({
          project,
          limits: { sourceBytes: 120000, files: 60 },
          previewPath: `/studio/${project.id}`,
        })
      }
      if (tool === 'arcade_write_game') {
        const record = await owned(p.id, projectId)
        const document = gameDocumentSchema.parse({ kind: 'browser', ...args })
        assertAgentPlayable(document)
        compilePresentation(document)
        const project = {
          ...record.project,
          document,
          digest: await documentDigest(document),
          revision: record.project.revision + 1,
          updatedAt: new Date().toISOString(),
        }
        await revision(project)
        await save(record, project)
        return JSON.stringify({
          ok: true,
          projectId,
          revision: project.revision,
          title: document.title,
          fileCount: isBrowserGame(document) ? document.files.length : 0,
        })
      }
      if (tool === 'arcade_test_game') {
        const { project } = await owned(p.id, projectId)
        assertAgentPlayable(project.document)
        const compiled = compilePresentation(project.document)
        return JSON.stringify({
          ok: true,
          projectId,
          revision: project.revision,
          checks: [
            'schema',
            'agent play bridge',
            'source compilation',
            'sandbox presentation',
          ],
          compiledBytes: new TextEncoder().encode(compiled).length,
        })
      }
      if (tool === 'arcade_publish_game') {
        if (!p.scopes.includes('releases:publish'))
          throw new IdentityError(403, 'This account cannot publish releases.')
        const record = await owned(p.id, projectId)
        const project = record.project
        compilePresentation(project.document)
        const releaseId = `rel_${project.id.slice(4)}_${project.revision}_${project.digest.slice(7, 19)}`
        const existing = await store.get<ReleaseRecord>('releases', releaseId)
        if (!existing) {
          const release: StudioRelease = {
            id: releaseId,
            projectId: project.id,
            revision: project.revision,
            document: project.document,
            digest: project.digest,
            manifest: await releaseManifest(project, releaseId),
            ownerId: project.ownerId,
            distribution:
              project.document.distribution ?? defaultGameDistribution,
            publishedAt: new Date().toISOString(),
          }
          await store.put('releases', releaseId, { version: 1, release })
          await save(record, { ...project, releaseId })
        }
        return JSON.stringify({
          ok: true,
          releaseId,
          previewPath: `/play/${releaseId}`,
        })
      }
      return JSON.stringify({ error: `Unknown Arcade tool: ${tool}` })
    } catch (error) {
      return JSON.stringify({
        error:
          error instanceof z.ZodError
            ? error.issues.map((issue) => ({
                path: issue.path.join('.'),
                message: issue.message,
              }))
            : error instanceof Error
              ? error.message
              : String(error),
      })
    }
  }

  /**
   * Give each project/agent pair one ordinary Commons web session. This is the
   * same durable conversation model used by CommonLab: Arcade supplies the
   * current project context while Commons owns history, memory, usage, logs,
   * model routing and the agent runtime itself.
   */
  async function ensureCommonsProjectSession(
    p: Principal,
    project: StudioProject,
    agentId: string,
  ) {
    const partition = `commons-project-sessions:${p.id}`
    // JSON proposal sessions contain the retired response contract in their
    // history. A versioned key gives the native tool runtime a clean first turn
    // while preserving every prior Commons session for audit and review.
    const key = commonsProjectSessionKey(project.id, agentId)
    const current = await store.get<CommonsProjectSession>(partition, key)
    if (current?.sessionId) return current.sessionId
    const created = (await commonsRequest(p, '/v1/sessions', {
      agentId,
      initiator: p.id,
      title: `Common Arcade · ${project.document.title}`.slice(0, 120),
      source: 'web',
    })) as { sessionId?: string }
    if (!created.sessionId)
      throw new CommonsServiceError(
        502,
        'Commons could not create a conversation for this game. Try again.',
      )
    const record: CommonsProjectSession = {
      version: 1,
      projectId: project.id,
      agentId,
      sessionId: created.sessionId,
      createdAt: new Date().toISOString(),
      messages: [],
    }
    try {
      await store.put(partition, key, record)
      return record.sessionId
    } catch (error) {
      if (!(error instanceof StoreConflict)) throw error
      const winner = await store.get<CommonsProjectSession>(partition, key)
      if (!winner?.sessionId) throw error
      return winner.sessionId
    }
  }
  async function appendCommonsProjectHistory(
    p: Principal,
    project: StudioProject,
    agentId: string,
    message: StudioConversationMessage,
  ) {
    const partition = `commons-project-sessions:${p.id}`
    const key = commonsProjectSessionKey(project.id, agentId)
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = await store.get<CommonsProjectSession>(partition, key)
      if (!current) {
        await ensureCommonsProjectSession(p, project, agentId)
        continue
      }
      if (
        current.messages?.some(
          (candidate) =>
            candidate.jobId === message.jobId &&
            candidate.role === message.role,
        )
      )
        return
      try {
        await store.put(
          partition,
          key,
          {
            ...current,
            version: current.version + 1,
            messages: [...(current.messages ?? []), message].slice(-100),
          },
          current.version,
        )
        return
      } catch (error) {
        if (!(error instanceof StoreConflict) || attempt === 2) throw error
      }
    }
  }
  return app
}

const commonsProjectSessionKey = (projectId: string, agentId: string) =>
  `${projectId}:${agentId}:native-v1`

/** Flattens the content shapes a Commons run can return into plain text. */
function agentText(content: unknown): string | undefined {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const text = content
      .map((part) =>
        typeof part === 'string'
          ? part
          : part &&
              typeof part === 'object' &&
              typeof (part as any).text === 'string'
            ? (part as any).text
            : '',
      )
      .join('')
    return text || undefined
  }
  return undefined
}
/**
 * Returns the first balanced JSON object in the text. Models routinely wrap a
 * proposal in a sentence or a fenced block, and a game's own source contains
 * braces and escaped quotes, so the object is located by scanning with string
 * and escape awareness rather than by a regular expression.
 */
function firstJsonObject(text: string): string | undefined {
  const start = text.indexOf('{')
  if (start < 0) return undefined
  let depth = 0,
    inString = false,
    escaped = false
  for (let i = start; i < text.length; i++) {
    const char = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{') depth++
    else if (char === '}' && --depth === 0) return text.slice(start, i + 1)
  }
  return undefined
}
export function extractAgentJson(result: unknown): unknown {
  const r = (result ?? {}) as Record<string, unknown>
  if (r.document) return r
  let content = agentText(r.content ?? r.text ?? r.output ?? r.message)
  if (content === undefined && Array.isArray(r.messages)) {
    const message = [...r.messages]
      .reverse()
      .find((m) => m && typeof m === 'object' && 'content' in m)
    content = agentText((message as any)?.content)
  }
  if (content === undefined)
    throw new CommonsServiceError(
      502,
      'The agent finished without a game proposal. Send the request again.',
    )
  const clean = content
    .replace(/^\s*```(?:json)?\s*/, '')
    .replace(/\s*```\s*$/, '')
    .trim()
  for (const candidate of [clean, firstJsonObject(clean)]) {
    if (!candidate) continue
    try {
      return JSON.parse(candidate)
    } catch {
      // Fall through to the balanced-object scan, then to the reported error.
    }
  }
  throw new CommonsServiceError(
    502,
    `The agent replied with text instead of a game proposal: "${clean.replace(/\s+/g, ' ').slice(0, 200)}". Try again, or ask for a smaller change.`,
  )
}

export async function commonsRequest(
  p: Principal,
  path: string,
  body?: unknown,
) {
  if (p.provider !== 'commons')
    throw new IdentityError(
      403,
      'Sign in with Commons to use your Commons agents.',
    )
  const response = await fetch(
    `${process.env.AGENT_COMMONS_API_URL ?? 'https://api.agentcommons.io'}${path}`,
    {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Authorization: `Bearer ${p.token}`,
        'Content-Type': 'application/json',
        'x-initiator': p.id,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      // Generating a whole game is a minutes-long call. Callers run it as a
      // job, so the budget here is the agent's, not a browser's.
      signal: AbortSignal.timeout(240_000),
    },
  )
  // An error from a proxy in front of Commons arrives as HTML, not JSON.
  // Parsing it blindly turned every such failure into an unexplained 500.
  const raw = await response.text()
  let result: {
    data?: unknown
    message?: string
    error?: { message?: string }
  }
  try {
    result = JSON.parse(raw)
  } catch {
    throw new CommonsServiceError(
      response.ok ? 502 : response.status === 402 ? 402 : 502,
      `Commons agent service returned an unreadable response (${response.status}): ${raw.replace(/\s+/g, ' ').slice(0, 160)}`,
    )
  }
  if (!response.ok)
    throw new CommonsServiceError(
      response.status === 402
        ? 402
        : response.status === 403
          ? 403
          : response.status === 429
            ? 429
            : 502,
      response.status === 402
        ? 'Your Commons account needs credits to run agents. Manage credits in Agent Commons, then retry.'
        : `Commons agent service: ${result.message ?? result.error?.message ?? response.status}`,
    )
  return result.data ?? result
}

async function commonsRequestMethod(
  p: Principal,
  path: string,
  method: 'PUT',
  body: unknown,
) {
  if (p.provider !== 'commons')
    throw new IdentityError(
      403,
      'Sign in with Commons to use your Commons agents.',
    )
  const response = await fetch(
    `${process.env.AGENT_COMMONS_API_URL ?? 'https://api.agentcommons.io'}${path}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${p.token}`,
        'Content-Type': 'application/json',
        'x-initiator': p.id,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(240_000),
    },
  )
  const raw = await response.text()
  let result: any
  try {
    result = JSON.parse(raw)
  } catch {
    throw new CommonsServiceError(
      502,
      `Commons agent service returned an unreadable response (${response.status}): ${raw.replace(/\s+/g, ' ').slice(0, 160)}`,
    )
  }
  if (!response.ok)
    throw new CommonsServiceError(
      response.status === 403 ? 403 : 502,
      `Commons agent service: ${result.message ?? result.error?.message ?? response.status}`,
    )
  return result.data ?? result
}

type CommonsStreamEvent = {
  type?: string
  phase?: string
  content?: string
  status?: string
  name?: string
  toolName?: string
  tool?: string
  args?: unknown
  requestId?: string
  message?: string
  payload?: unknown
}

async function* commonsAgentStream(
  p: Principal,
  body: unknown,
): AsyncGenerator<CommonsStreamEvent> {
  if (p.provider !== 'commons')
    throw new IdentityError(
      403,
      'Sign in with Commons to use your Commons agents.',
    )
  let response: Response
  try {
    response = await fetch(
      `${process.env.AGENT_COMMONS_API_URL ?? 'https://api.agentcommons.io'}/v1/agents/run/stream`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${p.token}`,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          'x-initiator': p.id,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(570_000),
      },
    )
  } catch (error) {
    throw new CommonsServiceError(
      502,
      `Commons agent stream could not be reached: ${error instanceof Error ? error.message : 'network error'}`,
    )
  }
  if (!response.ok) {
    const raw = await response.text()
    let message = raw.replace(/\s+/g, ' ').slice(0, 240)
    try {
      const parsed = JSON.parse(raw)
      message = parsed.message ?? parsed.error?.message ?? message
    } catch {
      // Preserve the readable proxy response above.
    }
    throw new CommonsServiceError(
      response.status === 402
        ? 402
        : response.status === 403
          ? 403
          : response.status === 429
            ? 429
            : 502,
      `Commons agent service: ${message || response.status}`,
    )
  }
  if (!response.body)
    throw new CommonsServiceError(
      502,
      'Commons returned an empty agent stream.',
    )
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data:')) continue
        const raw = line.slice(5).trim()
        if (!raw || raw === '[DONE]') return
        try {
          const event = JSON.parse(raw) as CommonsStreamEvent
          if (event.type !== 'keepalive') yield event
          if (event.type === 'final' || event.type === 'completed') return
        } catch {
          // Ignore malformed keepalive/proxy fragments without losing the run.
        }
      }
      if (done) break
    }
  } catch (error) {
    throw new CommonsServiceError(
      502,
      `Commons agent stream ended unexpectedly: ${error instanceof Error ? error.message : 'connection error'}`,
    )
  }
}

/**
 * Return the final text from the keepalive-capable Commons agent stream.
 * Short browser decisions use the stream too: the synchronous agent endpoint
 * can be terminated by an upstream proxy before a model finishes thinking.
 */
export async function commonsAgentText(p: Principal, body: unknown) {
  let text = ''
  for await (const event of commonsAgentStream(p, body)) {
    if (
      event.type === 'token' &&
      typeof event.content === 'string' &&
      (!event.phase || event.phase === 'final_answer')
    )
      text += event.content
    else if (event.type === 'final') text = text.trim() || agentEventText(event)
  }
  if (!text.trim())
    throw new CommonsServiceError(
      502,
      'Commons finished the agent decision without returning an action.',
    )
  return text.trim()
}

function agentEventText(event: CommonsStreamEvent) {
  if (typeof event.content === 'string') return event.content
  if (event.payload && typeof event.payload === 'object') {
    const payload = event.payload as Record<string, unknown>
    for (const value of [payload.content, payload.text, payload.message])
      if (typeof value === 'string') return value
  }
  return ''
}

function copilotToolLabel(tool: string) {
  const labels: Record<string, string> = {
    arcade_read_project: 'Read Arcade project',
    arcade_write_game: 'Write Arcade game',
    arcade_test_game: 'Test Arcade game',
    arcade_publish_game: 'Publish Arcade game',
    invoke_skill: 'Loaded game-building skill',
    startAgentComputer: 'Started Agent Computer',
    runComputerCommand: 'Ran computer command',
    readComputerFile: 'Read computer file',
    writeComputerFiles: 'Wrote computer files',
    openComputerBrowser: 'Opened computer browser',
    testComputerBrowser: 'Tested in computer browser',
  }
  return (
    labels[tool] ??
    tool
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replaceAll('_', ' ')
      .replace(/^./, (letter) => letter.toUpperCase())
  )
}

function assertAgentPlayable(document: StudioProject['document']) {
  if (!isBrowserGame(document)) return
  if (!document.play)
    throw new Error(
      'Agent-playable browser games must declare play.mode, play.seats, and play.maxDecisionsPerSecond.',
    )
  const source = document.files.map((file) => file.content).join('\n')
  const missing = [
    [
      'window.arcade',
      /\b(?:window|globalThis)\s*(?:\.\s*arcade|\[\s*['"]arcade['"]\s*\])/,
    ],
    ['seats', /\bseats\b/],
    ['observe', /\bobserve\b/],
    ['actions', /\bactions\b/],
    ['step', /\bstep\b/],
  ].flatMap(([name, pattern]) =>
    (pattern as RegExp).test(source) ? [] : [name as string],
  )
  if (missing.length)
    throw new Error(
      `Agent play bridge is incomplete. Add ${missing.join(', ')} synchronously before the entry module finishes.`,
    )
}

export class CommonsServiceError extends Error {
  constructor(
    public status: 402 | 403 | 429 | 502,
    message: string,
  ) {
    super(message)
    this.name = 'Commons agent service'
  }
}
