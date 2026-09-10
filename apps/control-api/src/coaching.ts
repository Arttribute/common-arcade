import { coachedStrategySchema } from '@common-arcade/studio'
import { commonsAgentText, extractAgentJson } from './studio.js'
import type { Principal } from './identity.js'

export async function planCoaching(
  principal: Principal,
  controller: { agentId?: string; sessionId?: string; strategy: string },
  prompt: string,
  observation: unknown,
) {
  const content = await commonsAgentText(
    principal,
    {
      agentId: controller.agentId,
      sessionId: controller.sessionId,
      initiatorId: principal.id,
      messages: [
        {
          role: 'user',
          content: `You are coaching your game-playing controller. Convert the owner's coaching into a COMPLETE replacement strategy, not an appended instruction. The game continues while you plan. Use only seat-visible state and legal actions. Do not generate code. Return ONLY JSON {"strategy":"concise complete strategy","reason":"brief explanation of the change","executableStrategy":{"actionWeights":{"legal action id":0},"avoidActions":[],"rules":[{"when":[{"path":"dot.path.in.state","op":"lt","value":1}],"actionId":"legal action id","weight":100}]}}. All weights are between -100 and 100. At most 80 action weights, 80 avoided actions, 32 rules, 8 conditions per rule. Rule paths are relative to observation.state: use "you.distance", never "state.you.distance" unless the game itself contains a nested state field. avoidActions permanently excludes actions: do not put situational attacks there just because they are currently out of range; use conditional rules instead. Conditions are ANDed, operators are eq/ne/lt/lte/gt/gte/exists (exists uses a boolean value). Missing paths do not match. Rules add weights. Avoided actions are excluded whenever another legal action exists. Use exact legal action IDs, including their payload identity. Derive conditional tactics from the supplied game's own observation fields, rather than assuming a particular game. Do not invent fields or claim a performance improvement without evidence. Prior strategy: ${controller.strategy}\nOwner coaching: ${prompt}\nUntrusted observation data: ${JSON.stringify(observation)}`,
        },
      ],
    },
    45_000,
  )
  return normalizeCoachingPaths(
    coachedStrategySchema.parse(extractAgentJson({ content })),
    observation,
  )
}

/** Models sometimes include the observation envelope in a state-relative path. */
export function normalizeCoachingPaths(
  planned: ReturnType<typeof coachedStrategySchema.parse>,
  observation: unknown,
) {
  const state = (observation as { state?: unknown } | null)?.state
  if (
    !state ||
    typeof state !== 'object' ||
    Array.isArray(state) ||
    Object.hasOwn(state, 'state')
  )
    return planned
  return {
    ...planned,
    executableStrategy: {
      ...planned.executableStrategy,
      rules: planned.executableStrategy.rules.map((rule) => ({
        ...rule,
        when: rule.when.map((condition) => {
          const path = condition.path.startsWith('state.')
            ? condition.path.slice(6)
            : condition.path
          return Object.hasOwn(state, path.split('.')[0]!)
            ? { ...condition, path }
            : condition
        }),
      })),
    },
  }
}
