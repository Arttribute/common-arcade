#!/usr/bin/env node
import {
  LIVE_GAME_DOCS_BASE,
  LIVE_GAME_PRACTICES,
  formatLiveGamePractices,
  gameDocumentSchema,
} from '@common-arcade/studio'
import { ControlClient } from '@common-arcade/control-client'
import { McpServer } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'

export const MCP_TOOL_NAMES = [
  'arcade.authoring_guide',
  'arcade.create_project',
  'arcade.get_project',
  'arcade.update_project',
  'arcade.publish_project',
  'arcade.test_project',
  'arcade.search_games',
  'arcade.get_game',
  'arcade.create_match',
  'arcade.join_match',
  'arcade.get_match',
  'arcade.get_replay',
] as const

export interface ArcadeMcpOptions {
  readonly baseUrl?: string
  readonly actorId?: string
  readonly bearerToken?: string
  readonly fetch?: typeof globalThis.fetch
}

function response(key: string, value: unknown) {
  const structuredContent = { [key]: value } as Record<string, unknown>
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
    structuredContent,
  }
}

export function createArcadeMcpServer(
  options: ArcadeMcpOptions = {},
): McpServer {
  const client = new ControlClient({
    baseUrl:
      options.baseUrl ?? process.env.ARCADE_API_URL ?? 'http://localhost:4100',
    ...(options.bearerToken === undefined
      ? options.actorId === undefined
        ? process.env.ARCADE_TOKEN === undefined
          ? process.env.ARCADE_ACTOR_ID === undefined
            ? {}
            : { actorId: process.env.ARCADE_ACTOR_ID }
          : { bearerToken: process.env.ARCADE_TOKEN }
        : { actorId: options.actorId }
      : { bearerToken: options.bearerToken }),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  })
  const server = new McpServer(
    { name: 'common-arcade', version: '0.1.0-v0alpha1' },
    {
      instructions:
        'Before creating or revising a game, call arcade.authoring_guide and follow its practices; they apply to every genre, mode, seat count and control scheme. Test every revision with arcade.test_project and repair failures and warnings before publishing. Use discovery and durable control tools here. For autonomous or realtime play, obtain a session with arcade.join_match and connect a policy runner to the returned realtimeUrl; do not drive a realtime tick loop through MCP.',
    },
  )

  server.registerTool(
    'arcade.authoring_guide',
    {
      title: 'Common Arcade live-game practices',
      description:
        'Return the practices and contract for building a live Common Arcade game of any genre: game shape, authoritative state and performance, actions, observations and feedback, rendering for players and spectators, results, testing and publishing. Call before creating or revising a game.',
      inputSchema: z.object({}),
    },
    async () => ({
      content: [
        {
          type: 'text' as const,
          text: `${formatLiveGamePractices()}\n\nFull guide: ${LIVE_GAME_DOCS_BASE}`,
        },
      ],
      structuredContent: {
        docs: LIVE_GAME_DOCS_BASE,
        schema: '/v1/schemas/v0alpha1/game-document',
        sections: LIVE_GAME_PRACTICES,
      },
    }),
  )
  server.registerTool(
    'arcade.create_project',
    {
      description:
        'Create a durable project from a game document of any genre. A live game is a browser document with play and runtime (kind "sandboxed-script") blocks, a presentation that assigns window.arcade.render, and a rules file that assigns globalThis.arcadeGame. Follow arcade.authoring_guide.',
      inputSchema: z.object({ document: gameDocumentSchema }),
    },
    async ({ document }) =>
      response('project', await client.createProject(document)),
  )
  server.registerTool(
    'arcade.get_project',
    {
      description:
        'Read the exact current revision and annotations before editing.',
      inputSchema: z.object({ projectId: z.string() }),
    },
    async ({ projectId }) =>
      response('project', await client.getProject(projectId)),
  )
  server.registerTool(
    'arcade.update_project',
    {
      description:
        'Save a new revision of the whole document with the revision you read. Rejects stale edits and never overwrites changes made by another collaborator; reload and reconcile on conflict. Run arcade.test_project afterwards.',
      inputSchema: z.object({
        projectId: z.string(),
        revision: z.number().int().positive(),
        document: gameDocumentSchema,
      }),
    },
    async ({ projectId, revision, document }) =>
      response(
        'project',
        await client.updateProject(projectId, document, revision),
      ),
  )
  server.registerTool(
    'arcade.publish_project',
    {
      description:
        'Publish an immutable game revision to the public catalog. Requires releases:publish permission.',
      inputSchema: z.object({
        projectId: z.string(),
        revision: z.number().int().positive(),
      }),
    },
    async ({ projectId, revision }) =>
      response('release', await client.publishProject(projectId, revision)),
  )
  server.registerTool(
    'arcade.test_project',
    {
      title: 'Test a game headlessly',
      description:
        'Run the seeded headless runtime test for any game with authoritative rules, whatever its genre, mode or seat count. Returns determinism, per-step timing against the simulation budget, perception and feedback warnings, the replay and the recorded result. Script seats with actions to reach later phases; a long or slow game reports the steps that fit the test budget with truncated true.',
      inputSchema: z.object({
        projectId: z.string(),
        seed: z.string().max(200).optional(),
        steps: z.number().int().min(1).max(600).optional(),
        configuration: z.json().optional(),
        actions: z
          .array(
            z.object({
              step: z.number().int().nonnegative(),
              seat: z.number().int().nonnegative(),
              action: z.json(),
            }),
          )
          .max(1000)
          .optional(),
      }),
    },
    async ({ projectId, ...input }) =>
      response('runtimeTest', await client.testRuntime(projectId, input)),
  )

  server.registerTool(
    'arcade.search_games',
    {
      title: 'Search Common Arcade games',
      description:
        'Find manifests and compatibility profiles. Call this before creating a match.',
      inputSchema: z.object({ query: z.string().max(200).optional() }),
    },
    async ({ query }) => {
      const result = await client.listGames()
      const normalized = query?.toLowerCase()
      const games =
        normalized === undefined
          ? result.games
          : result.games.filter((game) =>
              [
                game.metadata.title,
                game.metadata.summary,
                ...game.metadata.tags,
              ]
                .join(' ')
                .toLowerCase()
                .includes(normalized),
            )
      return response('games', games)
    },
  )

  server.registerTool(
    'arcade.get_game',
    {
      title: 'Inspect a Common Arcade game',
      description:
        'Return the canonical manifest, profiles, rules references, and action/observation schemas for one game.',
      inputSchema: z.object({ gameId: z.string().min(1) }),
    },
    async ({ gameId }) => {
      const [game, releases] = await Promise.all([
        client.getGame(gameId),
        client.listGameReleases(gameId),
      ])
      return response('game', { manifest: game, releases: releases.releases })
    },
  )

  server.registerTool(
    'arcade.create_match',
    {
      title: 'Create a Common Arcade match',
      description:
        'Create an idempotent match pinned to an immutable release. This is a durable control operation, not a play loop.',
      inputSchema: z.object({
        releaseId: z.string().min(1),
        seed: z.string().min(1).optional(),
        configuration: z.json().optional(),
        idempotencyKey: z.string().min(8).max(200).optional(),
      }),
    },
    async (input) => response('match', await client.createMatch(input)),
  )

  server.registerTool(
    'arcade.join_match',
    {
      title: 'Claim or spectate a match',
      description:
        'Claim a seat when controlling, then return a one-time realtime ticket and endpoint for a persistent runner.',
      inputSchema: z
        .object({
          matchId: z.string().min(1),
          mode: z.enum(['control', 'spectate']),
          seatId: z.string().min(1).optional(),
          controllerId: z.string().min(1).optional(),
        })
        .superRefine((input, context) => {
          if (
            input.mode === 'control' &&
            (input.seatId === undefined || input.controllerId === undefined)
          ) {
            context.addIssue({
              code: 'custom',
              message: 'Control mode requires seatId and controllerId',
            })
          }
        }),
    },
    async ({ matchId, mode, seatId, controllerId }) => {
      if (
        mode === 'control' &&
        seatId !== undefined &&
        controllerId !== undefined
      ) {
        await client.claimSeat({ matchId, seatId, controllerId })
      }
      return response(
        'session',
        await client.createSession({
          matchId,
          mode,
          ...(seatId === undefined ? {} : { seatId }),
          ...(controllerId === undefined ? {} : { controllerId }),
        }),
      )
    },
  )

  server.registerTool(
    'arcade.get_match',
    {
      title: 'Inspect a match',
      description:
        'Return lifecycle, roster, authoritative sequence, and result.',
      inputSchema: z.object({ matchId: z.string().min(1) }),
    },
    async ({ matchId }) => response('match', await client.getMatch(matchId)),
  )

  server.registerTool(
    'arcade.get_replay',
    {
      title: 'Get an authoritative replay',
      description:
        'Return ordered commands, events, checkpoints, and integrity hashes for a match.',
      inputSchema: z.object({ matchId: z.string().min(1) }),
    },
    async ({ matchId }) => response('replay', await client.getReplay(matchId)),
  )

  return server
}

export const service = {
  name: 'common-arcade-mcp-server',
  status: 'v0alpha1',
  transports: ['stdio'],
  tools: MCP_TOOL_NAMES,
} as const

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  serveStdio(() => createArcadeMcpServer())
  console.error('Common Arcade MCP server listening on stdio')
}
