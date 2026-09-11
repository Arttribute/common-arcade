import { describe, expect, it } from 'vitest'
import {
  EMPTY_GAME_CONFIGURATION_SCHEMA,
  configurationDefaults,
  resolveGameConfiguration,
  type GameConfigurationSchema,
} from './index.js'

const schema: GameConfigurationSchema = {
  type: 'object',
  properties: {
    arena: {
      type: 'string',
      default: 'forest',
      enum: ['forest', 'desert'],
      minLength: 3,
      maxLength: 10,
    },
    gravity: {
      type: 'number',
      default: 1,
      minimum: 0.5,
      maximum: 2,
      multipleOf: 0.1,
    },
    rounds: {
      type: 'integer',
      default: 3,
      enum: [1, 3, 5],
    },
    friendlyFire: { type: 'boolean', default: false },
  },
  required: ['arena', 'gravity', 'rounds', 'friendlyFire'],
  additionalProperties: false,
}

describe('game configuration resolution', () => {
  it('exports the empty schema and only permits an empty configuration for it', () => {
    expect(configurationDefaults()).toEqual({})
    expect(resolveGameConfiguration(undefined, {})).toEqual({})
    expect(EMPTY_GAME_CONFIGURATION_SCHEMA).toEqual({
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    })
    expect(() => resolveGameConfiguration(undefined, { extra: true })).toThrow(
      /Unknown.*extra/,
    )
  })

  it('fills omitted properties and validates provided overrides', () => {
    expect(configurationDefaults(schema)).toEqual({
      arena: 'forest',
      gravity: 1,
      rounds: 3,
      friendlyFire: false,
    })
    expect(
      resolveGameConfiguration(schema, {
        arena: 'desert',
        gravity: 0.7,
        friendlyFire: true,
      }),
    ).toEqual({
      arena: 'desert',
      gravity: 0.7,
      rounds: 3,
      friendlyFire: true,
    })
  })

  it('rejects invalid configuration objects and primitive values', () => {
    for (const input of [null, [], 'forest', new Date()])
      expect(() => resolveGameConfiguration(schema, input)).toThrow(/object/)

    for (const input of [
      { arena: 'ocean' },
      { arena: 'FO' },
      { gravity: Number.NaN },
      { gravity: 0.55 },
      { rounds: 2 },
      { rounds: 1.5 },
      { friendlyFire: 'yes' },
    ])
      expect(() => resolveGameConfiguration(schema, input)).toThrow(
        /Invalid game configuration property/,
      )
  })

  it('limits the aggregate serialized configuration size', () => {
    const largeSchema: GameConfigurationSchema = {
      type: 'object',
      properties: Object.fromEntries(
        Array.from({ length: 24 }, (_, index) => [
          `value${index}`,
          { type: 'string' as const, default: '' },
        ]),
      ),
      required: Array.from({ length: 24 }, (_, index) => `value${index}`),
      additionalProperties: false,
    }
    expect(() =>
      resolveGameConfiguration(
        largeSchema,
        Object.fromEntries(
          Array.from({ length: 24 }, (_, index) => [
            `value${index}`,
            '\\'.repeat(500),
          ]),
        ),
      ),
    ).toThrow(/at most 16384 bytes/)
  })

  it('rejects invalid schemas passed by untyped callers', () => {
    expect(() =>
      configurationDefaults({
        ...schema,
        required: ['missing'],
      } as GameConfigurationSchema),
    ).toThrow(/Invalid game configuration schema/)
  })
})
