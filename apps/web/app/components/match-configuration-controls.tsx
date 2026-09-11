'use client'

import type {
  GameConfigurationSchema,
  GameConfigurationProperty,
} from '@common-arcade/protocol'
import { useId } from 'react'
import {
  configurationEnumIndex,
  configurationEnumValue,
  type ConfigurationFormValue,
  type ConfigurationFormValues,
  type GameSeats,
  type RoleCounts,
  validateConfiguration,
  validateRoleCounts,
} from '../lib/match-configuration'

function fieldDescriptionIds(
  baseId: string,
  description: string | undefined,
  error: string | undefined,
): string | undefined {
  const ids = [
    description ? `${baseId}-help` : '',
    error ? `${baseId}-error` : '',
  ]
    .filter(Boolean)
    .join(' ')
  return ids || undefined
}

export function GameConfigurationControls({
  schema,
  values,
  onChange,
  disabled = false,
}: {
  schema?: GameConfigurationSchema
  values: ConfigurationFormValues
  onChange: (name: string, value: ConfigurationFormValue) => void
  disabled?: boolean
}) {
  const id = useId()
  if (!schema || Object.keys(schema.properties).length === 0) return null
  const activeSchema = schema
  const errors = validateConfiguration(activeSchema, values)

  function control(
    name: string,
    property: GameConfigurationProperty,
    inputId: string,
    describedBy: string | undefined,
  ) {
    const common = {
      id: inputId,
      name,
      disabled,
      'aria-invalid': errors[name] ? (true as const) : undefined,
      'aria-describedby': describedBy,
    }
    if ('enum' in property && property.enum)
      return (
        <select
          {...common}
          value={configurationEnumIndex(
            property,
            values[name] ?? property.default,
          )}
          onChange={(event) =>
            onChange(name, configurationEnumValue(property, event.target.value))
          }
        >
          {property.enum.map((option, index) => (
            <option key={`${typeof option}-${option}`} value={index}>
              {String(option)}
            </option>
          ))}
        </select>
      )
    if (property.type === 'boolean')
      return (
        <input
          {...common}
          type="checkbox"
          checked={values[name] === true}
          onChange={(event) => onChange(name, event.target.checked)}
        />
      )
    if (property.type === 'string')
      return (
        <input
          {...common}
          type="text"
          value={String(values[name] ?? '')}
          minLength={property.minLength}
          maxLength={property.maxLength}
          required={activeSchema.required.includes(name)}
          onChange={(event) => onChange(name, event.target.value)}
        />
      )
    return (
      <input
        {...common}
        type="number"
        value={
          typeof values[name] === 'boolean'
            ? ''
            : (values[name] ?? property.default)
        }
        min={property.minimum}
        max={property.maximum}
        step={property.multipleOf ?? (property.type === 'integer' ? 1 : 'any')}
        required={activeSchema.required.includes(name)}
        onChange={(event) =>
          onChange(
            name,
            event.target.value === '' ? '' : Number(event.target.value),
          )
        }
      />
    )
  }

  return (
    <fieldset className="match-config-fieldset" disabled={disabled}>
      <legend>{activeSchema.title ?? 'Game settings'}</legend>
      {activeSchema.description ? (
        <p className="match-config-intro">{activeSchema.description}</p>
      ) : null}
      <div className="match-config-fields">
        {Object.entries(activeSchema.properties).map(([name, property]) => {
          const inputId = `${id}-${name}`
          const describedBy = fieldDescriptionIds(
            inputId,
            property.description,
            errors[name],
          )
          const label = property.title ?? name
          return (
            <div
              className={`match-config-field ${property.type === 'boolean' ? 'is-checkbox' : ''}`}
              key={name}
            >
              {property.type === 'boolean' ? (
                <label htmlFor={inputId}>
                  {control(name, property, inputId, describedBy)}
                  <span>{label}</span>
                </label>
              ) : (
                <label htmlFor={inputId}>{label}</label>
              )}
              {property.type === 'boolean'
                ? null
                : control(name, property, inputId, describedBy)}
              {property.description ? (
                <small id={`${inputId}-help`}>{property.description}</small>
              ) : null}
              {errors[name] ? (
                <small className="field-error" id={`${inputId}-error`}>
                  {errors[name]}
                </small>
              ) : null}
            </div>
          )
        })}
      </div>
    </fieldset>
  )
}

export function RoleCountControls({
  seats,
  values,
  onChange,
  disabled = false,
}: {
  seats: GameSeats
  values: RoleCounts
  onChange: (roleId: string, count: number) => void
  disabled?: boolean
}) {
  const id = useId()
  const validation = validateRoleCounts(seats, values)
  return (
    <fieldset
      className="match-config-fieldset role-count-fieldset"
      disabled={disabled}
    >
      <legend>Player setup</legend>
      <div className="role-count-fields">
        {seats.roles.map((role) => {
          const minimum = role.minCount ?? role.count
          const maximum = role.maxCount ?? role.count
          const inputId = `${id}-${role.id}`
          const error = validation.fieldErrors[role.id]
          return (
            <div className="role-count-field" key={role.id}>
              <span>
                <strong>{role.title}</strong>
                {role.team ? <small>Team {role.team}</small> : null}
              </span>
              {minimum === maximum ? (
                <span className="fixed-role-count">
                  {minimum} {minimum === 1 ? 'seat' : 'seats'}
                </span>
              ) : (
                <input
                  id={inputId}
                  aria-label={`${role.title} seats`}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? `${inputId}-error` : undefined}
                  type="number"
                  min={minimum}
                  max={maximum}
                  step={1}
                  value={values[role.id] ?? ''}
                  onChange={(event) =>
                    onChange(role.id, Number(event.target.value))
                  }
                />
              )}
              {error ? (
                <small className="field-error" id={`${inputId}-error`}>
                  {error}
                </small>
              ) : null}
            </div>
          )
        })}
      </div>
      <p
        className={`role-count-total ${validation.totalError ? 'field-error' : ''}`}
        role="status"
        aria-live="polite"
      >
        <strong>{validation.total} players</strong> · supported total{' '}
        {seats.min}–{seats.max}
        {validation.totalError ? ` · ${validation.totalError}` : ''}
      </p>
    </fieldset>
  )
}
