export type RealtimeTransportName = 'websocket' | 'webtransport'

export interface RealtimeClientSupport {
  readonly status: 'phase-0-poc-required'
  readonly implementedTransports: readonly RealtimeTransportName[]
}

export const realtimeClientSupport: RealtimeClientSupport = {
  status: 'phase-0-poc-required',
  implementedTransports: [],
}
