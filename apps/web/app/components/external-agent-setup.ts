export type ExternalClient = 'claude-code' | 'codex' | 'other'

/** Arcade serves its own copy of skills/common-arcade/SKILL.md (kept in sync
 *  by `pnpm sync:skill` and a test), so the skill matches the deployed API. */
export const SKILL_PATH = '/skills/common-arcade/SKILL.md'

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
  skillText,
}: {
  client: ExternalClient
  origin: string
  token: string
  idea: string
  project?: { id: string; title: string; revision: number }
  /** When given, the full skill is pasted into the prompt, so the agent
   *  needs neither a local copy nor network access to read it. */
  skillText?: string
}) {
  const apiUrl = `${origin}/api/arcade`
  const skillUrl = `${origin}${SKILL_PATH}`
  const skill = skillPath(client)
  const skillDir = skill.slice(0, skill.lastIndexOf('/'))
  const key = token || KEY_PLACEHOLDER

  const install = [
    `mkdir -p ~/.config/common-arcade ${skillDir}`,
    `(umask 077 && printf '%s' '${key}' > ${KEY_FILE})`,
    `curl -fsSL ${skillUrl} -o ${skill}`,
  ].join('\n')

  const task = project
    ? `Work on my existing game "${project.title}" (project ${project.id}, currently revision ${project.revision}). Read it first, then make these changes: <describe the changes>.`
    : `Create a new game: ${idea.trim() || '<describe your game>'}.`

  const skillLine = skillText
    ? 'Follow the Common Arcade skill included at the end of this message.'
    : `Use the Common Arcade skill at ${skill}. If that file is not on this machine, fetch it from ${skillUrl} and follow it.`

  const prompt = [
    skillLine,
    task,
    `API base URL: ${apiUrl}`,
    `Authenticate every request with the header "Authorization: Bearer $(cat ${KEY_FILE})". Never print the key or put it in game files.`,
    project
      ? `Save your work as a new revision of that project, run a test, and tell me what changed.`
      : `Create the project with POST /v1/projects, run a test, and give me its ${origin}/studio/<project id> link.`,
    ...(skillText
      ? ['', '--- Common Arcade skill (SKILL.md) ---', skillText.trim()]
      : []),
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

  return { install, prompt, connectNote, launchNote, apiUrl, skillUrl }
}
