// The Usage tab: `<Name prop={value} … />` generated from the live args, one
// prop per line. Hosts can teach it their idioms (a store lookup instead of a
// literal, a handler name) through UsageHooks.
import type { Args } from './story-types';

export type Tok = { t: string; c: 'punct' | 'tag' | 'attr' | 'ident' | 'lit' };

export interface UsageHooks {
  /** Tokens for a prop's value (the part after the prop name, `={…}` included), or null for the default. */
  value?: (component: string, prop: string, value: unknown) => Tok[] | null;
  /** Right-hand side for a callback prop, e.g. `navigation.goBack`. */
  handler?: (component: string, prop: string) => string | null;
}

/** Bundled asset URLs are long and build-specific: show the file. */
export function shortAsset(v: string): string {
  if (!/^(\/|https?:|data:|blob:)/.test(v) || !/\.(png|jpe?g|webp|gif|svg)(\?|$)/i.test(v)) return v;
  return v.split('/').pop()!.split('?')[0]!.replace(/-[\w-]{8}(\.\w+)$/, '$1');
}

export function literal(v: unknown): string {
  if (typeof v === 'string') return JSON.stringify(shortAsset(v));
  return JSON.stringify(v, (_k, x) => (typeof x === 'string' ? shortAsset(x) : x)) ?? String(v);
}

export function usageLines(component: string, args: Args, hooks: UsageHooks = {}): Tok[][] {
  const lines: Tok[][] = [[{ t: '<', c: 'punct' }, { t: component, c: 'tag' }]];
  const handlers: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined) continue;
    if (typeof value === 'function') {
      handlers.push(key);
      continue;
    }
    const custom = hooks.value?.(component, key, value);
    if (custom) lines.push([{ t: `  ${key}`, c: 'attr' }, ...custom]);
    else if (typeof value === 'string') lines.push([{ t: `  ${key}`, c: 'attr' }, { t: '=', c: 'punct' }, { t: literal(value), c: 'lit' }]);
    else lines.push([{ t: `  ${key}`, c: 'attr' }, { t: '={', c: 'punct' }, { t: literal(value), c: 'lit' }, { t: '}', c: 'punct' }]);
  }
  for (const prop of handlers) {
    const rhs = hooks.handler?.(component, prop) ?? `handle${prop.replace(/^on/, '')}`;
    lines.push([{ t: `  ${prop}`, c: 'attr' }, { t: '={', c: 'punct' }, { t: rhs, c: 'ident' }, { t: '}', c: 'punct' }]);
  }
  lines.push([{ t: '/>', c: 'punct' }]);
  return lines;
}
