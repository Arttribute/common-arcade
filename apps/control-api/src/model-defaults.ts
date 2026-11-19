/** Defaults apply to newly provisioned agents and runs without a model override. */
export function defaultArcadeModel() {
  return {
    provider: process.env.ARCADE_AGENT_MODEL_PROVIDER ?? 'openai',
    modelId: process.env.ARCADE_AGENT_MODEL_ID ?? 'gpt-5.5',
  }
}
