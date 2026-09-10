import { canonicalJson } from '@common-arcade/manifest'
import type { Observation, JsonValue } from '@common-arcade/protocol'

/** Preserve payload identity (including coordinates/targets), independent of list order. */
export function livePolicyObservation(
  observation: Pick<Observation, 'visibleState' | 'legalActions'>,
) {
  const payloads = new Map<string, JsonValue>()
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
      object.label ?? object.type ?? object.action ?? 'Action',
    ).slice(0, 100)
    let id = `${label.replace(/[^a-zA-Z0-9_-]/g, '_')}-${(hash >>> 0).toString(16)}`
    // Collisions never silently select another payload.
    while (payloads.has(id) && canonicalJson(payloads.get(id)!) !== encoded)
      id += '_'
    payloads.set(id, payload)
    return { id, label: `${label} ${encoded}`.slice(0, 200) }
  })
  return { observation: { state: observation.visibleState, actions }, payloads }
}
