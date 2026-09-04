export const observabilityScopes = [
  'control',
  'realtime',
  'match',
  'policy',
  'studio',
  'build',
] as const

export type ObservabilityScope = (typeof observabilityScopes)[number]
