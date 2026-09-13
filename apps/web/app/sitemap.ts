import type { MetadataRoute } from 'next'
import { AGENT_SKILLS, SITE_URL, docsPages } from '@/lib/agent-discovery'

export const revalidate = 3600

async function publishedGames(): Promise<string[]> {
  const api = process.env.ARCADE_API_URL
  if (!api) return []
  try {
    const response = await fetch(`${api.replace(/\/$/, '')}/v1/games`, {
      next: { revalidate },
    })
    if (!response.ok) return []
    const body = (await response.json()) as {
      games?: { metadata?: { id?: string } }[]
    }
    return (body.games ?? [])
      .map((game) => game.metadata?.id)
      .filter((id): id is string => typeof id === 'string')
  } catch {
    return []
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date()
  const pages = [
    '/',
    '/discover',
    '/live',
    '/docs',
    '/llms.txt',
    '/llms-full.txt',
  ]
  return [
    ...pages.map((path) => ({ url: `${SITE_URL}${path}`, lastModified: now })),
    ...docsPages().map((page) => ({
      url: `${SITE_URL}${page.url}`,
      lastModified: now,
    })),
    ...AGENT_SKILLS.map((skill) => ({
      url: `${SITE_URL}/skills/${skill.name}/SKILL.md`,
      lastModified: now,
    })),
    ...(await publishedGames()).map((id) => ({
      url: `${SITE_URL}/games/${id}`,
      lastModified: now,
    })),
  ]
}
