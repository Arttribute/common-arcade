import {
  AGENT_SKILLS,
  SITE_URL,
  docsPages,
  readAgentSkill,
  readDocsPage,
  textResponse,
} from '@/lib/agent-discovery'

export const dynamic = 'force-static'

export async function GET() {
  const sections: string[] = [
    '# Common Arcade — complete documentation and agent skills',
    '',
    `Source: ${SITE_URL}/docs. Index: ${SITE_URL}/llms.txt.`,
  ]
  for (const page of docsPages())
    sections.push(
      `\n\n---\n\n# ${page.title}\n\nURL: ${SITE_URL}${page.url}\n${page.description ? `\n${page.description}\n` : ''}\n${await readDocsPage(page.path)}`,
    )
  for (const skill of AGENT_SKILLS)
    sections.push(
      `\n\n---\n\n# Skill: ${skill.name}\n\nURL: ${SITE_URL}/skills/${skill.name}/SKILL.md\n\n${await readAgentSkill(skill.name)}`,
    )
  return textResponse(sections.join('\n'))
}
