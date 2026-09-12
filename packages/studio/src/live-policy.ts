import { canonicalJson } from '@common-arcade/manifest'
import type { Observation, JsonValue } from '@common-arcade/protocol'

/** Preserve payload identity (including coordinates/targets), independent of list order. */
export function livePolicyObservation(
  observation: Pick<Observation, 'visibleState' | 'legalActions'>,
) {
  const payloads = new Map<string, JsonValue>()
  const aliases = new Map<string, string[]>()
  const actions = observation.legalActions.slice(0, 80).map((payload) => {
    const encoded = canonicalJson(payload)
    let hash = 2166136261
    for (let i = 0; i < encoded.length; i++)
      hash = Math.imul(hash ^ encoded.charCodeAt(i), 16777619)
    const object =
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? payload
        : {}
    const label = String(
      object.label ?? object.id ?? object.type ?? object.action ?? 'Action',
    ).slice(0, 100)
    let id = `${label.replace(/[^a-zA-Z0-9_-]/g, '_')}-${(hash >>> 0).toString(16)}`
    // Collisions never silently select another payload.
    while (payloads.has(id) && canonicalJson(payloads.get(id)!) !== encoded)
      id += '_'
    payloads.set(id, payload)
    const alias = object.id ?? object.type
    if (typeof alias === 'string')
      aliases.set(alias, [...(aliases.get(alias) ?? []), id])
    return { id, label: `${label} ${encoded}`.slice(0, 200) }
  })
  const state = observation.visibleState
  const visible =
    state && typeof state === 'object' && !Array.isArray(state)
      ? state
      : undefined
  const context = visible?.arcadeDecisionContext
  const decision =
    context && typeof context === 'object' && !Array.isArray(context)
      ? context
      : undefined
  const scores = decision?.actionScores
  const remapList = (value: JsonValue | undefined) =>
    Array.isArray(value)
      ? value.flatMap((id) =>
          typeof id === 'string' ? (aliases.get(id) ?? [id]) : [],
        )
      : []
  return {
    observation: {
      actions,
      state: decision
        ? {
            ...visible,
            arcadeDecisionContext: {
              ...decision,
              actionScores:
                scores && typeof scores === 'object' && !Array.isArray(scores)
                  ? Object.fromEntries(
                      Object.entries(scores).flatMap(([id, score]) =>
                        (aliases.get(id) ?? [id]).map((key) => [key, score]),
                      ),
                    )
                  : {},
              preferredActions: remapList(decision.preferredActions),
              avoidActions: remapList(decision.avoidActions),
            },
          }
        : state,
    },
    payloads,
  }
}
