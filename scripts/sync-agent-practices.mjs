import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { formatLiveGamePractices } from '../packages/studio/dist/index.js'

/* Skills must carry the same live-game practices that Studio Copilot and the
 * MCP server read from @common-arcade/studio. This rewrites the marked block in
 * each skill; the studio test fails whenever a skill falls out of date.
 * Run after `pnpm --filter @common-arcade/studio build`. */
export const PRACTICES_START = '<!-- live-game-practices:start -->'
export const PRACTICES_END = '<!-- live-game-practices:end -->'
const skills = ['skills/common-arcade-build/SKILL.md']

const root = fileURLToPath(new URL('../', import.meta.url))
for (const skill of skills) {
  const path = `${root}${skill}`
  const source = await readFile(path, 'utf8')
  const start = source.indexOf(PRACTICES_START)
  const end = source.indexOf(PRACTICES_END)
  if (start < 0 || end < start)
    throw new Error(`${skill} is missing the live-game practices markers`)
  const next = `${source.slice(0, start + PRACTICES_START.length)}\n\n${formatLiveGamePractices()}\n\n${source.slice(end)}`
  await writeFile(path, next)
  console.log(`Updated ${skill}`)
}
