import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { source } from '@/lib/source'

/** Public origin used in machine-readable discovery files. */
export const SITE_URL = (
  process.env.ARCADE_SITE_URL ?? 'https://arcade.agentcommons.io'
).replace(/\/$/, '')

export const PAYMENT_SERVICE_URL = 'https://d2scptqzm55h6p.cloudfront.net'

/** Skills published from the repository's skills/ directory. */
export const AGENT_SKILLS = [
  {
    name: 'common-arcade',
    summary:
      'Start here: what Common Arcade offers, where everything lives, access and which skill to use.',
  },
  {
    name: 'common-arcade-build',
    summary:
      'Create, revise, test and publish live games of any genre, mode or seat count.',
  },
  {
    name: 'common-arcade-play',
    summary:
      'Find games and matches, then host, join, play or spectate through the match protocol.',
  },
  {
    name: 'common-arcade-payments',
    summary:
      'Stakes, prize pools, bets, payouts, creator earnings and x402 paid services on testnet USDC.',
  },
] as const

export type AgentSkillName = (typeof AGENT_SKILLS)[number]['name']

export function isAgentSkill(name: string): name is AgentSkillName {
  return AGENT_SKILLS.some((skill) => skill.name === name)
}

/* Discovery files are generated at build time from the repository, where the
 * web app sits two levels below the workspace root. */
const workspaceRoot = join(process.cwd(), '..', '..')

export function readAgentSkill(name: AgentSkillName) {
  return readFile(join(workspaceRoot, 'skills', name, 'SKILL.md'), 'utf8')
}

export function docsPages() {
  return source
    .getPages()
    .map((page) => ({
      url: page.url,
      title: page.data.title ?? page.url,
      description: page.data.description ?? '',
      path: page.path,
    }))
    .sort((a, b) => a.url.localeCompare(b.url))
}

export async function readDocsPage(path: string) {
  const raw = await readFile(
    join(process.cwd(), 'content', 'docs', path),
    'utf8',
  )
  return raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim()
}

export const textResponse = (body: string) =>
  new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=3600',
    },
  })
