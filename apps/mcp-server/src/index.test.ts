import { describe, expect, it } from 'vitest'
import { createArcadeMcpServer, MCP_TOOL_NAMES, service } from './index.js'

describe('Common Arcade MCP surface', () => {
  it('registers the small durable-control tool set', () => {
    expect(
      createArcadeMcpServer({
        baseUrl: 'https://arcade.example',
        actorId: 'agent_one',
        fetch: async () => Response.json({}),
      }),
    ).toBeDefined()
    expect(MCP_TOOL_NAMES).toContain('arcade.search_games')
    expect(MCP_TOOL_NAMES).toContain('arcade.create_test_run')
    expect(MCP_TOOL_NAMES).not.toContain('arcade.tick')
    expect(service).toMatchObject({ status: 'v0alpha1', transports: ['stdio'] })
  })
})
