'use client'

import { useEffect, useRef, useState } from 'react'
import type { JsonValue, Observation } from '@common-arcade/protocol'

export function actionLabel(action: JsonValue, index = 0): string {
  if (action && typeof action === 'object' && !Array.isArray(action)) {
    if (typeof action.label === 'string') return action.label
    if (typeof action.type === 'string') return action.type
    if (typeof action.id === 'string') return action.id
  }
  const encoded = JSON.stringify(action)
  return encoded.length <= 80 ? encoded : `Action ${index + 1}`
}

function releaseAction(action: JsonValue, actions: readonly JsonValue[]) {
  if (!action || typeof action !== 'object' || Array.isArray(action)) return
  const control = action.control as
    { mode?: string; releaseActionId?: string } | undefined
  if (control?.mode !== 'hold' || !control.releaseActionId) return
  return actions.find(
    (candidate) =>
      candidate &&
      typeof candidate === 'object' &&
      !Array.isArray(candidate) &&
      candidate.id === control.releaseActionId,
  )
}

export function LiveControls({
  observation,
  inputMode,
  onInputMode,
  disabled,
  feedback,
  onAction,
}: {
  observation: Observation
  inputMode: 'standard' | 'game'
  onInputMode: (mode: 'standard' | 'game') => void
  disabled: boolean
  feedback: string
  onAction: (action: JsonValue) => void
}) {
  const [held, setHeld] = useState<number>()
  const heldRelease = useRef<JsonValue | undefined>(undefined)
  const submit = useRef(onAction)
  submit.current = onAction
  const endHold = () => {
    const release = heldRelease.current
    heldRelease.current = undefined
    setHeld(undefined)
    if (release !== undefined) submit.current(release)
  }
  useEffect(() => {
    const hidden = () => {
      if (document.hidden) endHold()
    }
    window.addEventListener('blur', endHold)
    document.addEventListener('visibilitychange', hidden)
    return () => {
      window.removeEventListener('blur', endHold)
      document.removeEventListener('visibilitychange', hidden)
      // Seat handoff also cancels held input on the server.
      if (heldRelease.current !== undefined) submit.current(heldRelease.current)
      heldRelease.current = undefined
    }
  }, [])
  useEffect(() => {
    if (disabled) endHold()
  }, [disabled])
  const beginHold = (action: JsonValue, index: number) => {
    if (disabled) return
    endHold()
    heldRelease.current = releaseAction(action, observation.legalActions)
    setHeld(index)
    onAction(action)
  }
  return (
    <section className="human-controls" aria-label="Your game controls">
      <div className="human-controls-heading">
        <strong>Your controls</strong>
        <span>Your move.</span>
      </div>
      <div className="control-mode" aria-label="Control method">
        <button
          aria-pressed={inputMode === 'standard'}
          onClick={() => {
            endHold()
            onInputMode('standard')
          }}
        >
          Action buttons
        </button>
        <button
          aria-pressed={inputMode === 'game'}
          onClick={() => {
            endHold()
            onInputMode('game')
          }}
        >
          In-game controls
        </button>
      </div>
      {inputMode === 'game' ? (
        <p>
          Click inside the game to use its keyboard, pointer or touch controls.
          Switch to action buttons if you need them.
        </p>
      ) : null}
      {disabled ? (
        <p>Waiting for the game and your seat connection to be ready.</p>
      ) : null}
      {inputMode === 'standard' ? (
        <div className="live-action-strip">
          {observation.legalActions.map((action, index) => {
            const hold =
              releaseAction(action, observation.legalActions) !== undefined
            return (
              <button
                key={JSON.stringify(action)}
                disabled={disabled}
                aria-pressed={hold ? held === index : undefined}
                onClick={() => {
                  if (!hold) onAction(action)
                }}
                onPointerDown={(event) => {
                  if (hold) {
                    event.preventDefault()
                    event.currentTarget.focus()
                    event.currentTarget.setPointerCapture(event.pointerId)
                    beginHold(action, index)
                  }
                }}
                onPointerUp={() => {
                  if (hold) endHold()
                }}
                onPointerCancel={endHold}
                onLostPointerCapture={endHold}
                onKeyDown={(event) => {
                  if (hold && [' ', 'Enter'].includes(event.key)) {
                    event.preventDefault()
                    if (!event.repeat) beginHold(action, index)
                  }
                }}
                onKeyUp={(event) => {
                  if (hold && [' ', 'Enter'].includes(event.key)) {
                    event.preventDefault()
                    endHold()
                  }
                }}
                onBlur={() => {
                  if (held === index) endHold()
                }}
              >
                {actionLabel(action, index)}
                {hold ? (
                  <small>{held === index ? 'Holding…' : 'Hold'}</small>
                ) : null}
              </button>
            )
          })}
        </div>
      ) : null}
      {!observation.legalActions.length ? (
        <p>Waiting for your next available action.</p>
      ) : null}
      <p className="live-control-feedback" role="status" aria-live="polite">
        {feedback}
      </p>
      <details className="human-game-state">
        <summary>Game status & keyboard help</summary>
        <p>
          Tab moves between actions. Enter or Space activates an action. Hold
          marked controls to keep them pressed.
        </p>
        <dl className="human-state-summary">
          {stateFields(observation.visibleState).map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </details>
      <details className="human-game-state">
        <summary>Your current game state</summary>
        <pre>{JSON.stringify(observation.visibleState, null, 2)}</pre>
      </details>
    </section>
  )
}

function stateFields(value: JsonValue): [string, string][] {
  const result: [string, string][] = []
  const visit = (value: JsonValue, prefix = '', depth = 0) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return
    for (const [key, item] of Object.entries(value)) {
      if (result.length >= 18) break
      const label = `${prefix}${key.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ')}`
      if (
        item !== null &&
        ['string', 'number', 'boolean'].includes(typeof item)
      ) {
        const text =
          typeof item === 'boolean'
            ? item
              ? 'Yes'
              : 'No'
            : typeof item === 'number' && !Number.isInteger(item)
              ? item.toFixed(2)
              : String(item)
        if (text.length <= 80) result.push([label, text])
      } else if (depth < 1 && item && !Array.isArray(item))
        visit(item, `${label} · `, depth + 1)
    }
  }
  visit(value)
  return result
}
