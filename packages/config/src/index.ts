export type ArcadeEnvironment =
  'local' | 'development' | 'staging' | 'production'

export function parseArcadeEnvironment(
  value: string | undefined,
): ArcadeEnvironment {
  const environment = value ?? 'local'
  if (
    environment === 'local' ||
    environment === 'development' ||
    environment === 'staging' ||
    environment === 'production'
  ) {
    return environment
  }
  throw new Error(`Unsupported ARCADE_ENV: ${environment}`)
}
