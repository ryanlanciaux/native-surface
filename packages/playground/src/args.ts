import type { ArgType, Args, ControlKind } from './story-types';

export interface Knob {
  name: string;
  label: string;
  kind: ControlKind;
  value: unknown;
  argType: ArgType | undefined;
}

function inferKind(value: unknown, argType: ArgType | undefined): ControlKind {
  if (argType?.control) return argType.control;
  if (argType?.options) return 'select';
  switch (typeof value) {
    case 'boolean':
      return 'boolean';
    case 'number':
      return 'number';
    case 'string':
      return 'text';
    case 'function':
      return 'action';
    case 'object':
      return value === null ? 'none' : 'json';
    default:
      return 'none';
  }
}

/** One knob per arg, in declaration order, typed from the arg's runtime value. */
export function buildKnobs(args: Args, argTypes: Record<string, ArgType>): Knob[] {
  return Object.keys(args).map((name) => {
    const argType = argTypes[name];
    const value = args[name];
    return {
      name,
      label: argType?.name ?? name,
      kind: inferKind(value, argType),
      value,
      argType,
    };
  });
}

/** Coerces a <select> string back to the option's original type. */
export function coerceOption(raw: string, options: ReadonlyArray<string | number>): string | number {
  return options.find((option) => String(option) === raw) ?? raw;
}

export function optionLabel(option: string | number, argType: ArgType | undefined): string {
  const explicit = argType?.labels?.[String(option)];
  if (explicit) return explicit;
  const text = String(option);
  return text.length > 28 ? `${text.slice(0, 25)}…` : text;
}

const MAX_DEPTH = 3;
const MAX_STRING = 60;

/**
 * JSON-ish rendering of an action payload: depth-capped, cycle-safe, and
 * tolerant of the DOM-free event objects the engine hands back.
 */
export function describeValue(value: unknown, depth = 0, seen = new WeakSet<object>()): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value);
    case 'number':
      return Number.isInteger(value) ? String(value) : value.toFixed(2);
    case 'boolean':
      return String(value);
    case 'function':
      return `ƒ ${value.name || 'anonymous'}()`;
    case 'symbol':
    case 'bigint':
      return String(value);
    default:
      break;
  }
  const object = value as object;
  if (seen.has(object)) return '[circular]';
  if (depth >= MAX_DEPTH) return Array.isArray(object) ? '[…]' : '{…}';
  seen.add(object);
  if (Array.isArray(object)) {
    return `[${object.map((item) => describeValue(item, depth + 1, seen)).join(', ')}]`;
  }
  const entries = Object.entries(object as Record<string, unknown>);
  if (entries.length === 0) return '{}';
  return `{ ${entries
    .map(([key, item]) => `${key}: ${describeValue(item, depth + 1, seen)}`)
    .join(', ')} }`;
}

export function describeCall(callArgs: unknown[]): string {
  return callArgs.map((arg) => describeValue(arg)).join(', ');
}

/**
 * Replaces every function-valued arg with a logging wrapper that still calls
 * through, so a story's `onPress: () => {}` shows up in the actions panel.
 */
export function wrapActions(args: Args, log: (name: string, callArgs: unknown[]) => void): Args {
  const wrapped: Args = {};
  for (const [name, value] of Object.entries(args)) {
    if (typeof value === 'function') {
      const original = value as (...callArgs: unknown[]) => unknown;
      wrapped[name] = (...callArgs: unknown[]) => {
        log(name, callArgs);
        return original(...callArgs);
      };
    } else {
      wrapped[name] = value;
    }
  }
  return wrapped;
}
