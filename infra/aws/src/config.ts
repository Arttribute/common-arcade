export type DeploymentStage = 'development' | 'staging' | 'production'

export interface DeploymentConfig {
  stage: DeploymentStage
  terminationProtection: boolean
}

export function deploymentConfig(value: unknown): DeploymentConfig {
  const stage = value ?? 'development'
  if (
    stage !== 'development' &&
    stage !== 'staging' &&
    stage !== 'production'
  ) {
    throw new Error(`Invalid CDK stage: ${String(stage)}`)
  }

  return {
    stage,
    terminationProtection: stage === 'production',
  }
}
