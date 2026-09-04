export const ARCADE_PROTOCOL = {
  namespace: 'io.agentcommons.arcade/v0alpha1',
  stability: 'non-normative',
} as const

export type ArcadeProtocolNamespace = typeof ARCADE_PROTOCOL.namespace
export type ProtocolStability = typeof ARCADE_PROTOCOL.stability

export function isArcadeProtocolNamespace(
  value: string,
): value is ArcadeProtocolNamespace {
  return value === ARCADE_PROTOCOL.namespace
}
