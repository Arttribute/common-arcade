/** Normalize API problems and legacy Copilot validation arrays for display. */
export function errorMessage(
  value: unknown,
  fallback = 'Request failed. Please retry.',
): string {
  function describe(input: unknown, depth = 0): string {
    if (depth > 5 || input == null) return ''
    if (typeof input === 'string') return input.trim()
    if (Array.isArray(input))
      return input
        .map((item) => describe(item, depth + 1))
        .filter(Boolean)
        .join('; ')
    if (input instanceof Error) return input.message
    if (typeof input !== 'object') return ''
    const record = input as Record<string, unknown>
    const message = describe(
      record.detail ?? record.error ?? record.message,
      depth + 1,
    )
    const field = record.field ?? record.path
    const path = Array.isArray(field)
      ? field.join('.')
      : typeof field === 'string'
        ? field
        : ''
    const violations = describe(record.violations, depth + 1)
    return [path && message ? `${path}: ${message}` : message, violations]
      .filter(Boolean)
      .join('; ')
  }
  return describe(value) || fallback
}
