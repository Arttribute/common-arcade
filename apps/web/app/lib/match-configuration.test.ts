import type {
  GameConfigurationSchema,
  GameManifest,
  MatchDescriptor,
} from '@common-arcade/protocol'
import { describe, expect, it } from 'vitest'
import {
  configurationEnumValue,
  initializeConfiguration,
  initializeRoleCounts,
  validateRoleCounts,
} from './match-configuration'

const configurationSchema: GameConfigurationSchema = {
  type: 'object',
  properties: {
    map: { type: 'string', default: 'small', enum: ['small', 'large'] },
    speed: { type: 'number', default: 1.5, enum: [1, 1.5, 2] },
    rounds: { type: 'integer', default: 3, minimum: 1, maximum: 9 },
    teams: { type: 'boolean', default: true },
  },
  required: ['map', 'rounds'],
  additionalProperties: false,
}

const seats: GameManifest['spec']['seats'] = {
  min: 2,
  max: 5,
  spectators: true,
  lateJoin: false,
  roles: [
    { id: 'host', title: 'Host', count: 1 },
    {
      id: 'player',
      title: 'Player',
      count: 2,
      minCount: 1,
      maxCount: 4,
    },
  ],
}

describe('match configuration helpers', () => {
  it('initializes every setting from its schema default', () => {
    expect(initializeConfiguration(configurationSchema)).toEqual({
      map: 'small',
      speed: 1.5,
      rounds: 3,
      teams: true,
    })
  })

  it('preserves string and number types when selecting enum options', () => {
    expect(
      configurationEnumValue(configurationSchema.properties.map!, '1'),
    ).toBe('large')
    expect(
      configurationEnumValue(configurationSchema.properties.speed!, '1'),
    ).toBe(1.5)
    expect(
      typeof configurationEnumValue(configurationSchema.properties.speed!, '1'),
    ).toBe('number')
  })

  it('initializes role counts from defaults or concrete seats', () => {
    expect(initializeRoleCounts(seats)).toEqual({ host: 1, player: 2 })
    expect(
      initializeRoleCounts(seats, [
        { role: 'host' },
        { role: 'player' },
        { role: 'player' },
        { role: 'player' },
      ] as MatchDescriptor['seats']),
    ).toEqual({ host: 1, player: 3 })
  })

  it('validates per-role ranges and overall seat totals', () => {
    expect(validateRoleCounts(seats, { host: 1, player: 3 })).toMatchObject({
      valid: true,
      total: 4,
      fieldErrors: {},
    })
    expect(validateRoleCounts(seats, { host: 1, player: 0 })).toMatchObject({
      valid: false,
      total: 1,
      fieldErrors: { player: 'Choose between 1 and 4.' },
      totalError: 'Total players must be between 2 and 5.',
    })
    expect(
      validateRoleCounts({ ...seats, min: 3 }, { host: 1, player: 1 }),
    ).toMatchObject({
      valid: false,
      total: 2,
      fieldErrors: {},
      totalError: 'Total players must be between 3 and 5.',
    })
  })
})
