import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { SKILL_PATH, buildAgentSetup } from './external-agent-setup'

const origin = 'https://arcade.agentcommons.io'

describe('buildAgentSetup', () => {
  it('installs the skill where Claude Code discovers it and writes the key privately', () => {
    const setup = buildAgentSetup({
      client: 'claude-code',
      origin,
      token: 'arc_abc',
      idea: 'A tactical card duel',
    })
    expect(setup.install).toContain(
      `curl -fsSL ${origin}${SKILL_PATH} -o ~/.claude/skills/common-arcade/SKILL.md`,
    )
    expect(setup.install).toContain(
      "(umask 077 && printf '%s' 'arc_abc' > ~/.config/common-arcade/token)",
    )
    expect(setup.prompt).toContain('Create a new game: A tactical card duel.')
    expect(setup.prompt).toContain(`API base URL: ${origin}/api/arcade`)
    // The prompt reads the key from the file; it never contains the key.
    expect(setup.prompt).not.toContain('arc_abc')
  })

  it('points Codex at a neutral skill path and asks for network access', () => {
    const setup = buildAgentSetup({
      client: 'codex',
      origin,
      token: '',
      idea: '',
    })
    expect(setup.install).toContain('~/.config/common-arcade/SKILL.md')
    expect(setup.install).toContain("'YOUR_ARCADE_KEY'")
    expect(setup.launchNote).toContain(
      'codex -c sandbox_workspace_write.network_access=true',
    )
  })

  it('targets the open project inside the studio', () => {
    const setup = buildAgentSetup({
      client: 'other',
      origin,
      token: 'arc_abc',
      idea: '',
      project: { id: 'prj_123', title: 'Redline Run', revision: 7 },
    })
    expect(setup.prompt).toContain('project prj_123, currently revision 7')
    expect(setup.prompt).not.toContain('POST /v1/projects')
  })
})

describe('the skill Arcade serves', () => {
  const read = (path: string) =>
    readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

  it('matches skills/common-arcade/SKILL.md (run pnpm sync:skill)', () => {
    expect(read('../../public/skills/common-arcade/SKILL.md')).toBe(
      read('../../../../skills/common-arcade/SKILL.md'),
    )
  })

  it('tells the agent where to fetch the skill when it is not installed', () => {
    const setup = buildAgentSetup({
      client: 'claude-code',
      origin,
      token: '',
      idea: '',
    })
    expect(setup.prompt).toContain(`fetch it from ${origin}${SKILL_PATH}`)
  })

  it('can carry the whole skill inside the prompt', () => {
    const setup = buildAgentSetup({
      client: 'other',
      origin,
      token: '',
      idea: '',
      skillText: '---\nname: common-arcade\n---\nBody',
    })
    expect(setup.prompt).toContain('included at the end of this message')
    expect(setup.prompt.endsWith('name: common-arcade\n---\nBody')).toBe(true)
    expect(setup.prompt).not.toContain('fetch it from')
  })
})
