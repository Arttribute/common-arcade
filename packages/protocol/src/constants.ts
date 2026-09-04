export const ARCADE_API_VERSION = 'io.agentcommons.arcade/v0alpha1' as const
export const ARCADE_WIRE_VERSION = 'v0alpha1' as const

export const ARCADE_PROTOCOL = {
  namespace: ARCADE_API_VERSION,
  wireVersion: ARCADE_WIRE_VERSION,
  stability: 'v0alpha1',
} as const

export type ArcadeProtocolNamespace = typeof ARCADE_API_VERSION
export type ArcadeWireVersion = typeof ARCADE_WIRE_VERSION
export type ProtocolStability = typeof ARCADE_PROTOCOL.stability

export function isArcadeProtocolNamespace(
  value: string,
): value is ArcadeProtocolNamespace {
  return value === ARCADE_API_VERSION
}
