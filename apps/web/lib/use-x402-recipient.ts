'use client'

import { useEffect, useState } from 'react'
import type { PaymentNetwork } from '@common-arcade/economy'
import { analysisRecipient, serviceOrigin } from './x402-service'

/** Scope defaults and edits to their service/network so stale responses cannot change a budget. */
export function useX402Recipient(
  origin: string,
  network: PaymentNetwork,
  enabled: boolean,
  arcadeOrigin: string,
) {
  const normalized = serviceOrigin(origin)
  const scope = `${enabled}:${normalized ?? origin}:${network}`
  const automatic =
    enabled && !!normalized && normalized === serviceOrigin(arcadeOrigin)
  const [edited, setEdited] = useState({ scope: '', value: '' })
  const [discovery, setDiscovery] = useState({
    scope: '',
    value: '',
    failed: false,
  })
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (!automatic) return
    const controller = new AbortController()
    setDiscovery({ scope, value: '', failed: false })
    fetch(`${normalized}/.well-known/x402`, {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('Discovery unavailable')
        const value = analysisRecipient(await response.json(), network)
        if (!value) throw new Error('Analysis not advertised on this network')
        if (!controller.signal.aborted)
          setDiscovery({ scope, value, failed: false })
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setDiscovery({ scope, value: '', failed: true })
      })
    return () => controller.abort()
  }, [automatic, normalized, network, scope, retry])
  const manual = edited.scope === scope
  const current = discovery.scope === scope ? discovery : undefined
  return {
    recipient: manual ? edited.value : (current?.value ?? ''),
    setRecipient: (value: string) => setEdited({ scope, value }),
    retry: () => setRetry((value) => value + 1),
    failed: automatic && !manual && !!current?.failed,
    hint:
      manual || !automatic
        ? 'The service wallet this agent may pay.'
        : current?.value
          ? 'Filled from Arcade’s payment service for this network.'
          : current?.failed
            ? 'Could not load the service recipient. Retry or enter it manually.'
            : 'Loading the service recipient…',
  }
}
