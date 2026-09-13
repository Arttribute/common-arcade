import {
  AGENT_SKILLS,
  isAgentSkill,
  readAgentSkill,
} from '@/lib/agent-discovery'

export const dynamic = 'force-static'
export const dynamicParams = false

export function generateStaticParams() {
  return AGENT_SKILLS.map((skill) => ({ skill: skill.name }))
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ skill: string }> },
) {
  const { skill } = await params
  if (!isAgentSkill(skill)) return new Response('Not found', { status: 404 })
  return new Response(await readAgentSkill(skill), {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=3600',
    },
  })
}
