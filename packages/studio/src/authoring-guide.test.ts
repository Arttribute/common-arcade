import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  LIVE_GAME_DOCS_BASE,
  LIVE_GAME_PRACTICES,
  formatLiveGamePractices,
} from './authoring-guide.js'

const workspace = fileURLToPath(new URL('../../../', import.meta.url))

describe('live-game practices shared by every agent surface', () => {
  it('keeps the published build skill identical to the shared practices', () => {
    const skill = readFileSync(
      `${workspace}skills/common-arcade-build/SKILL.md`,
      'utf8',
    )
    const start = '<!-- live-game-practices:start -->'
    const end = '<!-- live-game-practices:end -->'
    const block = skill
      .slice(skill.indexOf(start) + start.length, skill.indexOf(end))
      .trim()
    expect(block, 'Run `pnpm sync:agent-practices` to refresh the skill.').toBe(
      formatLiveGamePractices(),
    )
  })

  it('links every section to a docs page that exists', () => {
    for (const section of LIVE_GAME_PRACTICES) {
      expect(section.docs.startsWith(LIVE_GAME_DOCS_BASE)).toBe(true)
      const slug = section.docs.slice(LIVE_GAME_DOCS_BASE.length) || '/index'
      expect(
        existsSync(
          `${workspace}apps/web/content/docs/guides/designing-live-games${slug}.mdx`,
        ),
        section.docs,
      ).toBe(true)
      expect(section.practices.length).toBeGreaterThan(0)
    }
  })
})
