import type {
  GameConfigurationProperty,
  GameConfigurationSchema,
  GameManifest,
  JsonValue,
  MatchDescriptor,
} from '@common-arcade/protocol'

export type ConfigurationFormValue = string | number | boolean
export type ConfigurationFormValues = Record<string, ConfigurationFormValue>
export type RoleCounts = Record<string, number>
export type GameSeats = GameManifest['spec']['seats']

function multipleOf(value: number, step: number): boolean {
  const quotient = value / step
  return (
    Number.isInteger(quotient) ||
    Math.abs(quotient - Math.round(quotient)) <=
      Number.EPSILON * Math.max(1, Math.abs(quotient)) * 4
  )
}

function configurationValueError(
  property: GameConfigurationProperty,
  value: unknown,
): string | undefined {
  if (property.type === 'boolean')
    return typeof value === 'boolean' ? undefined : 'Choose on or off.'

  if (property.type === 'string') {
    if (typeof value !== 'string') return 'Enter a text value.'
    const length = Array.from(value).length
    if (property.minLength !== undefined && length < property.minLength)
      return `Enter at least ${property.minLength} characters.`
    if (property.maxLength !== undefined && length > property.maxLength)
      return `Enter no more than ${property.maxLength} characters.`
    if (property.enum && !property.enum.includes(value))
      return 'Choose one of the available options.'
    return undefined
  }

  if (typeof value !== 'number' || !Number.isFinite(value))
    return 'Enter a number.'
  if (property.type === 'integer' && !Number.isInteger(value))
    return 'Enter a whole number.'
  if (property.minimum !== undefined && value < property.minimum)
    return `Enter ${property.minimum} or more.`
  if (property.maximum !== undefined && value > property.maximum)
    return `Enter ${property.maximum} or less.`
  if (
    property.multipleOf !== undefined &&
    !multipleOf(value, property.multipleOf)
  )
    return `Enter a multiple of ${property.multipleOf}.`
  if (property.enum && !property.enum.includes(value))
    return 'Choose one of the available options.'
  return undefined
}

export function initializeConfiguration(
  schema?: GameConfigurationSchema,
  current?: JsonValue,
): ConfigurationFormValues {
  if (!schema) return {}
  const existing =
    current !== null && typeof current === 'object' && !Array.isArray(current)
      ? current
      : {}
  return Object.fromEntries(
    Object.entries(schema.properties).map(([name, property]) => {
      const value = Object.hasOwn(existing, name)
        ? existing[name]
        : property.default
      return [
        name,
        configurationValueError(property, value) === undefined
          ? value
          : property.default,
      ]
    }),
  ) as ConfigurationFormValues
}

export function configurationEnumValue(
  property: GameConfigurationProperty,
  optionIndex: string,
): string | number {
  if (!('enum' in property) || property.enum === undefined)
    throw new Error('This configuration property does not define options.')
  const value = property.enum[Number(optionIndex)]
  if (value === undefined)
    throw new Error('The selected configuration option does not exist.')
  return value
}

export function configurationEnumIndex(
  property: GameConfigurationProperty,
  value: ConfigurationFormValue,
): string {
  if (!('enum' in property) || property.enum === undefined) return ''
  return String(property.enum.findIndex((candidate) => candidate === value))
}

export function validateConfiguration(
  schema: GameConfigurationSchema | undefined,
  values: ConfigurationFormValues,
): Record<string, string> {
  if (!schema) return {}
  return Object.fromEntries(
    Object.entries(schema.properties).flatMap(([name, property]) => {
      const error = configurationValueError(property, values[name])
      return error === undefined ? [] : [[name, error]]
    }),
  )
}

export function configurationPayload(
  schema: GameConfigurationSchema | undefined,
  values: ConfigurationFormValues,
): Record<string, JsonValue> {
  const errors = validateConfiguration(schema, values)
  if (Object.keys(errors).length > 0)
    throw new Error('Fix the invalid game settings before continuing.')
  return Object.fromEntries(
    Object.keys(schema?.properties ?? {}).map((name) => [name, values[name]]),
  ) as Record<string, JsonValue>
}

export function initializeRoleCounts(
  seats: GameSeats,
  currentSeats?: MatchDescriptor['seats'],
): RoleCounts {
  if (!currentSeats)
    return Object.fromEntries(seats.roles.map((role) => [role.id, role.count]))
  const counts = Object.fromEntries(
    seats.roles.map((role) => [role.id, 0]),
  ) as RoleCounts
  for (const seat of currentSeats)
    if (Object.hasOwn(counts, seat.role))
      counts[seat.role] = counts[seat.role]! + 1
  return counts
}

export interface RoleCountValidation {
  readonly valid: boolean
  readonly total: number
  readonly fieldErrors: Readonly<Record<string, string>>
  readonly totalError?: string
}

export function validateRoleCounts(
  seats: GameSeats,
  counts: RoleCounts,
): RoleCountValidation {
  const fieldErrors: Record<string, string> = {}
  for (const role of seats.roles) {
    const count = counts[role.id]
    const minimum = role.minCount ?? role.count
    const maximum = role.maxCount ?? role.count
    if (typeof count !== 'number' || !Number.isInteger(count))
      fieldErrors[role.id] = 'Enter a whole number.'
    else if (count < minimum || count > maximum)
      fieldErrors[role.id] = `Choose between ${minimum} and ${maximum}.`
  }
  const total = seats.roles.reduce((sum, role) => {
    const count = counts[role.id]
    return (
      sum + (typeof count === 'number' && Number.isFinite(count) ? count : 0)
    )
  }, 0)
  const totalError =
    total < seats.min || total > seats.max
      ? `Total players must be between ${seats.min} and ${seats.max}.`
      : undefined
  return {
    valid: Object.keys(fieldErrors).length === 0 && totalError === undefined,
    total,
    fieldErrors,
    totalError,
  }
}

export function roleCountsPayload(
  seats: GameSeats,
  counts: RoleCounts,
): Readonly<Record<string, number>> {
  if (!validateRoleCounts(seats, counts).valid)
    throw new Error('Fix the player allocation before continuing.')
  return Object.fromEntries(
    seats.roles.map((role) => [role.id, counts[role.id]!]),
  ) as Readonly<Record<string, number>>
}
