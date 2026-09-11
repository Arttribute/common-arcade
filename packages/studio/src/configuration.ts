import {
  gameConfigurationSchema,
  MAX_GAME_CONFIGURATION_BYTES,
  MAX_GAME_CONFIGURATION_STRING_LENGTH,
  type GameConfigurationProperty,
  type GameConfigurationSchema,
  type JsonValue,
} from '@common-arcade/protocol'

export const EMPTY_GAME_CONFIGURATION_SCHEMA: GameConfigurationSchema = {
  type: 'object',
  properties: {},
  required: [],
  additionalProperties: false,
}

const isMultipleOf = (value: number, multipleOf: number) => {
  const quotient = value / multipleOf
  return (
    Number.isInteger(quotient) ||
    Math.abs(quotient - Math.round(quotient)) <=
      Number.EPSILON * Math.max(1, Math.abs(quotient)) * 4
  )
}

function validatedSchema(
  schema: GameConfigurationSchema | undefined,
): GameConfigurationSchema {
  const result = gameConfigurationSchema.safeParse(
    schema ?? EMPTY_GAME_CONFIGURATION_SCHEMA,
  )
  if (result.success) return result.data
  const issue = result.error.issues[0]
  const location = issue?.path.join('.')
  throw new Error(
    `Invalid game configuration schema${location ? ` at ${location}` : ''}: ${issue?.message ?? 'unknown error'}`,
  )
}

export function configurationDefaults(
  schema?: GameConfigurationSchema,
): Record<string, JsonValue> {
  const parsed = validatedSchema(schema)
  const resolved = Object.fromEntries(
    Object.entries(parsed.properties).map(([name, property]) => [
      name,
      property.default,
    ]),
  )
  if (
    new TextEncoder().encode(JSON.stringify(resolved)).byteLength >
    MAX_GAME_CONFIGURATION_BYTES
  )
    throw new Error(
      `Game configuration must serialize to at most ${MAX_GAME_CONFIGURATION_BYTES} bytes.`,
    )
  return resolved
}

function validateValue(
  name: string,
  property: GameConfigurationProperty,
  value: unknown,
): JsonValue {
  const invalid = (message: string): never => {
    throw new Error(`Invalid game configuration property "${name}": ${message}`)
  }

  if (property.type === 'string') {
    const stringValue =
      typeof value === 'string' ? value : invalid('must be a string')
    const length = Array.from(stringValue).length
    if (length > MAX_GAME_CONFIGURATION_STRING_LENGTH)
      invalid(
        `must contain at most ${MAX_GAME_CONFIGURATION_STRING_LENGTH} characters`,
      )
    if (property.minLength !== undefined && length < property.minLength)
      invalid(`must contain at least ${property.minLength} characters`)
    if (property.maxLength !== undefined && length > property.maxLength)
      invalid(`must contain at most ${property.maxLength} characters`)
    if (property.enum && !property.enum.includes(stringValue))
      invalid(`must be one of ${property.enum.join(', ')}`)
    return stringValue
  }

  if (property.type === 'boolean')
    return typeof value === 'boolean' ? value : invalid('must be a boolean')

  const numericValue =
    typeof value === 'number' && Number.isFinite(value)
      ? value
      : invalid('must be a finite number')
  if (property.type === 'integer' && !Number.isInteger(numericValue))
    invalid('must be an integer')
  if (property.minimum !== undefined && numericValue < property.minimum)
    invalid(`must be greater than or equal to ${property.minimum}`)
  if (property.maximum !== undefined && numericValue > property.maximum)
    invalid(`must be less than or equal to ${property.maximum}`)
  if (
    property.multipleOf !== undefined &&
    !isMultipleOf(numericValue, property.multipleOf)
  )
    invalid(`must be a multiple of ${property.multipleOf}`)
  if (property.enum && !property.enum.includes(numericValue))
    invalid(`must be one of ${property.enum.join(', ')}`)
  return numericValue
}

export function resolveGameConfiguration(
  schema: GameConfigurationSchema | undefined,
  input: unknown,
): Record<string, JsonValue> {
  const parsed = validatedSchema(schema)
  if (
    input === null ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    throw new Error('Game configuration must be an object.')

  const values = input as Record<string, unknown>
  const unknownProperty = Object.keys(values)
    .filter((name) => !Object.hasOwn(parsed.properties, name))
    .sort()[0]
  if (unknownProperty !== undefined)
    throw new Error(`Unknown game configuration property "${unknownProperty}".`)

  const resolved = Object.fromEntries(
    Object.entries(parsed.properties).map(([name, property]) => [
      name,
      validateValue(
        name,
        property,
        Object.hasOwn(values, name) ? values[name] : property.default,
      ),
    ]),
  )
  if (
    new TextEncoder().encode(JSON.stringify(resolved)).byteLength >
    MAX_GAME_CONFIGURATION_BYTES
  )
    throw new Error(
      `Game configuration must serialize to at most ${MAX_GAME_CONFIGURATION_BYTES} bytes.`,
    )
  return resolved
}
