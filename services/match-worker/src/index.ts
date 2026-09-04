export const service = {
  name: 'common-arcade-match-worker',
  status: 'phase-0-poc-required',
  authoritative: true,
  responsibilities: ['simulation', 'action-ordering', 'event-log', 'snapshots'],
} as const
