#!/usr/bin/env node
import { ControlClient } from '@common-arcade/control-client'
import { McpServer } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'

export const MCP_TOOL_NAMES = [
  'arcade.search_games',
  'arcade.get_game',
  'arcade.create_match',
  'arcade.join_match',
  'arcade.get_match',
  'arcade.get_replay',
  'arcade.create_test_run',
  'arcade.get_test_run',
  'arcade.query_test_logs',
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
        'Use discovery and durable control tools here. For autonomous or realtime play, obtain a session with arcade.join_match and connect a policy runner to the returned realtimeUrl; do not drive a realtime tick loop through MCP.',
    },
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

  server.registerTool(
    'arcade.create_test_run',
    {
      title: 'Create an autonomous Test Arena run',
      description:
        'Run or step two deterministic policies against an exact Tic-tac-toe build and retain structured diagnostics.',
      inputSchema: z.object({
        seed: z.string().min(1).optional(),
        firstPreference: z.array(z.number().int().min(0).max(8)).optional(),
        secondPreference: z.array(z.number().int().min(0).max(8)).optional(),
        execution: z.enum(['step', 'complete']).optional(),
        idempotencyKey: z.string().min(8).max(200).optional(),
      }),
    },
    async (input) => response('testRun', await client.createTestRun(input)),
  )

  server.registerTool(
    'arcade.get_test_run',
    {
      title: 'Inspect a Test Arena run',
      description: 'Return its status, replay, assertions, and diagnostics.',
      inputSchema: z.object({ runId: z.string().min(1) }),
    },
    async ({ runId }) => response('testRun', await client.getTestRun(runId)),
  )

  server.registerTool(
    'arcade.query_test_logs',
    {
      title: 'Query Test Arena diagnostics',
      description:
        'Filter the structured observation, decision, action, runtime, adaptation, and coordination timeline.',
      inputSchema: z.object({
        runId: z.string().min(1),
        category: z.string().optional(),
        seatId: z.string().optional(),
        level: z.string().optional(),
        type: z.string().optional(),
        afterSequence: z.number().int().nonnegative().optional(),
      }),
    },
    async ({ runId, ...query }) =>
      response('diagnostics', await client.getTestDiagnostics(runId, query)),
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
