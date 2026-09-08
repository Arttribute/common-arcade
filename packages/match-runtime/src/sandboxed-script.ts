import { jsonValueSchema, type JsonValue } from '@common-arcade/protocol'
import {
  RELEASE_SYNC,
  newQuickJSWASMModule,
  shouldInterruptAfterDeadline,
  type QuickJSWASMModule,
} from 'quickjs-emscripten'
import type {
  GameActionContext,
  GameDefinition,
  GameEventDraft,
  GameInitializationContext,
  GameTransition,
  GameTickContext,
} from './index.js'

export interface SandboxedScriptRuleSet {
  readonly releaseId: string
  readonly releaseDigest: string
  readonly mode: GameDefinition<JsonValue, JsonValue>['mode']
  readonly source: string
  readonly memoryMiB: number
  readonly timeoutMs: number
}

const eventType = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/
const rejectionCodes = new Set([
  'NOT_LEGAL',
  'CONTROL_REVOKED',
  'TOO_LATE',
  'RATE_LIMITED',
])
let quickjsModule: Promise<QuickJSWASMModule> | undefined

function json(value: unknown, label: string): JsonValue {
  const parsed = jsonValueSchema.safeParse(value)
  if (!parsed.success)
    throw new TypeError(`${label} must be JSON-serializable.`)
  return parsed.data
}

function transition(value: unknown): GameTransition<JsonValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Runtime transitions must return { state, events }.')
  const record = value as Record<string, unknown>
  const state = json(record.state, 'Runtime state')
  const rawEvents = record.events ?? []
  if (!Array.isArray(rawEvents) || rawEvents.length > 256)
    throw new TypeError('Runtime events must be an array of at most 256 items.')
  const events: GameEventDraft[] = rawEvents.map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      throw new TypeError('Every runtime event must be an object.')
    const event = raw as Record<string, unknown>
    if (typeof event.type !== 'string' || !eventType.test(event.type))
      throw new TypeError('Runtime event types must be dotted identifiers.')
    if (
      !['public', 'team', 'seat', 'referee'].includes(String(event.visibility))
    )
      throw new TypeError('Runtime event visibility is invalid.')
    if (event.audienceId !== undefined && typeof event.audienceId !== 'string')
      throw new TypeError('Runtime event audienceId must be a string.')
    return {
      type: event.type,
      visibility: event.visibility as GameEventDraft['visibility'],
      ...(event.audienceId === undefined
        ? {}
        : { audienceId: event.audienceId }),
      payload: json(event.payload ?? {}, 'Runtime event payload'),
    }
  })
  return { state, events }
}

function projection(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError(
      'Runtime observe() must return visibleState and legalActions.',
    )
  const record = value as Record<string, unknown>
  if (!Array.isArray(record.legalActions) || record.legalActions.length > 512)
    throw new TypeError('legalActions must be an array of at most 512 items.')
  return {
    visibleState: json(record.visibleState, 'Visible state'),
    legalActions: record.legalActions.map((action) =>
      json(action, 'Legal action'),
    ),
    ...(record.feedback === undefined
      ? {}
      : { feedback: json(record.feedback, 'Observation feedback') }),
  }
}

function safeArgs(args: readonly unknown[]): string {
  return JSON.stringify(args).replaceAll('<', '\\u003c')
}

function invocationSource(
  source: string,
  method: string,
  args: readonly unknown[],
  requireTick: boolean,
): string {
  return `(function(){
    'use strict';
    Object.defineProperties(globalThis, {
      Date: { value: undefined, writable: false, configurable: false },
      fetch: { value: undefined, writable: false, configurable: false },
      process: { value: undefined, writable: false, configurable: false },
      require: { value: undefined, writable: false, configurable: false },
      WebAssembly: { value: undefined, writable: false, configurable: false }
    });
    Object.defineProperty(Math, 'random', {
      value: function(){ throw new Error('Use the match seed and serialized state for deterministic randomness.'); },
      writable: false,
      configurable: false
    });
    Object.freeze(Math);
    ${source}
    return (function(game, values, name){
      if (!game || typeof game !== 'object')
        throw new TypeError('Runtime must assign globalThis.arcadeGame.');
      if (name === '__validate__') {
        const required = ['initialize','validateAction','applyAction','observe','result'];
        if (${JSON.stringify(requireTick)}) required.push('tick');
        const missing = required.filter(function(key){ return typeof game[key] !== 'function'; });
        if (missing.length) throw new TypeError('Runtime is missing: ' + missing.join(', '));
        return { ok: true };
      }
      if (typeof game[name] !== 'function')
        throw new TypeError('Runtime method is missing: ' + name);
      return game[name].apply(undefined, values);
    })(globalThis.arcadeGame, ${safeArgs(args)}, ${JSON.stringify(method)});
  })()`
}

/**
 * Compile creator rules into a no-I/O QuickJS runtime hosted inside WebAssembly.
 * Each call receives only canonical JSON and is bounded by memory, stack, and
 * wall-clock interruption. Source cannot access Node, network, files, secrets,
 * the host clock, or ambient randomness.
 */
export async function createSandboxedScriptGame(
  rules: SandboxedScriptRuleSet,
): Promise<GameDefinition<JsonValue, JsonValue>> {
  if (rules.source.length > 120_000)
    throw new RangeError('Managed runtime source exceeds 120 KB.')
  const quickjs = await (quickjsModule ??= newQuickJSWASMModule(RELEASE_SYNC))
  const evaluate = (method: string, args: readonly unknown[]): unknown => {
    try {
      return quickjs.evalCode(
        invocationSource(
          rules.source,
          method,
          args,
          rules.mode === 'realtime' || rules.mode === 'hybrid',
        ),
        {
          shouldInterrupt: shouldInterruptAfterDeadline(
            Date.now() + rules.timeoutMs,
          ),
          memoryLimitBytes: rules.memoryMiB * 1024 * 1024,
          maxStackSizeBytes: 512 * 1024,
        },
      )
    } catch (error) {
      throw new Error(
        `Managed runtime ${method} failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  evaluate('__validate__', [])
  return {
    releaseId: rules.releaseId,
    releaseDigest: rules.releaseDigest,
    mode: rules.mode,
    initialize(context: GameInitializationContext) {
      return json(evaluate('initialize', [context]), 'Initial state')
    },
    parseAction(payload: JsonValue) {
      return json(payload, 'Action')
    },
    validateAction(state, action, context: GameActionContext) {
      const result = evaluate('validateAction', [state, action, context])
      if (result === null || result === undefined || result === true)
        return undefined
      if (typeof result === 'string')
        return { code: 'NOT_LEGAL', detail: result.slice(0, 500) }
      if (typeof result !== 'object' || Array.isArray(result))
        throw new TypeError(
          'validateAction must return null, true, a string, or { code, detail }.',
        )
      const rejection = result as Record<string, unknown>
      return {
        code:
          typeof rejection.code === 'string' &&
          rejectionCodes.has(rejection.code)
            ? (rejection.code as 'NOT_LEGAL')
            : 'NOT_LEGAL',
        detail: String(rejection.detail ?? 'Action is not legal.').slice(
          0,
          500,
        ),
      }
    },
    applyAction(state, action, context: GameActionContext) {
      return transition(evaluate('applyAction', [state, action, context]))
    },
    ...(rules.mode === 'realtime' || rules.mode === 'hybrid'
      ? {
          advanceTick(state: JsonValue, context: GameTickContext) {
            return transition(evaluate('tick', [state, context]))
          },
        }
      : {}),
    serializeState(state) {
      return json(state, 'Runtime state')
    },
    projectObservation(state, seatId, context: GameActionContext) {
      return projection(evaluate('observe', [state, seatId, context]))
    },
    getResult(state) {
      const result = evaluate('result', [state])
      return result === null || result === undefined
        ? undefined
        : json(result, 'Match result')
    },
  }
}
