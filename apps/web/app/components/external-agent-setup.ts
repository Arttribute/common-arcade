export type ExternalClient = 'claude-code' | 'codex' | 'other'

export const SKILL_URL =
  'https://raw.githubusercontent.com/Arttribute/common-arcade/main/skills/common-arcade/SKILL.md'

const KEY_FILE = '~/.config/common-arcade/token'
const KEY_PLACEHOLDER = 'YOUR_ARCADE_KEY'

/** Where each client's copy of the Arcade skill lives. Claude Code discovers
 *  skills in ~/.claude/skills; other agents are pointed at the file. */
function skillPath(client: ExternalClient) {
  return client === 'claude-code'
    ? '~/.claude/skills/common-arcade/SKILL.md'
    : '~/.config/common-arcade/SKILL.md'
}

/**
 * The terminal setup and prompt shown in the external-agent dialog. The key
 * is written to a private file rather than an environment variable: Codex
 * strips variables named like *TOKEN* / *KEY* from the commands it runs, and
 * a file works the same way for every agent.
 */
export function buildAgentSetup({
  client,
  origin,
  token,
  idea,
  project,
}: {
  client: ExternalClient
  origin: string
  token: string
  idea: string
  project?: { id: string; title: string; revision: number }
}) {
  const apiUrl = `${origin}/api/arcade`
  const skill = skillPath(client)
  const skillDir = skill.slice(0, skill.lastIndexOf('/'))
  const key = token || KEY_PLACEHOLDER

  const install = [
    `mkdir -p ~/.config/common-arcade ${skillDir}`,
    `(umask 077 && printf '%s' '${key}' > ${KEY_FILE})`,
    `curl -fsSL ${SKILL_URL} -o ${skill}`,
  ].join('\n')

  const task = project
    ? `Work on my existing game "${project.title}" (project ${project.id}, currently revision ${project.revision}). Read it first, then make these changes: <describe the changes>.`
    : `Create a new game: ${idea.trim() || '<describe your game>'}.`

  const prompt = [
    `Use the Common Arcade skill at ${skill} to build on Common Arcade.`,
    task,
    `API base URL: ${apiUrl}`,
    `Authenticate every request with the header "Authorization: Bearer $(cat ${KEY_FILE})". Never print the key or put it in game files.`,
    project
      ? `Save your work as a new revision of that project, run a test, and tell me what changed.`
      : `Create the project with POST /v1/projects, run a test, and give me its ${origin}/studio/<project id> link.`,
  ].join('\n')

  const connectNote =
    client === 'claude-code'
      ? 'Saves your key to a private file and installs the Arcade skill where Claude Code finds it.'
      : client === 'codex'
        ? 'Saves your key to a private file and downloads the Arcade skill for Codex to read.'
        : 'Saves your key to a private file and downloads the Arcade skill. Any agent that can read files and make HTTPS requests can use it.'

  const launchNote =
    client === 'claude-code'
      ? 'Start claude in any folder and paste this prompt.'
      : client === 'codex'
        ? 'Codex blocks network access by default, so start it with: codex -c sandbox_workspace_write.network_access=true — then paste this prompt.'
        : 'Paste this prompt into your agent.'

  return { install, prompt, connectNote, launchNote, apiUrl }
}
