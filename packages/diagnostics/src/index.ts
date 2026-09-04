export const diagnosticDomains = [
  'build',
  'runtime',
  'transport',
  'policy',
  'adaptation',
  'security',
] as const

export type DiagnosticDomain = (typeof diagnosticDomains)[number]
