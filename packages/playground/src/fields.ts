// Props panel + state chips over CSF args, on the knob machinery in args.ts:
// which fields a story exposes (object args expand to dotted fields, as in
// `episode.title`), how a chip maps onto args, which chip the args currently
// match, and how callbacks feed the event log and write state back.
import { buildKnobs, controlKind, coerceOption, describeValue, optionLabel, wrapActions } from './args';
import type { StoryEntry } from './csf';
import type { PlaygroundItem } from './items';
import type { ArgType, Args, ControlKind } from './story-types';

export type FieldKind = Exclude<ControlKind, 'action' | 'none'> | 'date';

export interface Field {
  /** Arg name, or a dotted path into an object arg (`episode.title`). */
  key: string;
  kind: FieldKind;
  value: unknown;
  argType: ArgType | undefined;
}

/** Args a chip only forces visually (a `pressed` state): they live on the chips, not the panel. */
const FORCE_KEYS = new Set(['pressed']);
/** Identity fields of an object arg: editing them would detach it from its store. */
const IDENTITY_KEYS = new Set(['id', 'guid', 'key']);

const isPlain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;
const isoDate = (v: unknown): boolean => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v);

/** Deep copy of plain data; functions and other instances are kept by reference. */
export function cloneArgs<T>(v: T): T {
  if (Array.isArray(v)) return v.map(cloneArgs) as T;
  if (isPlain(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, cloneArgs(x)])) as T;
  return v;
}

export function getArg(args: Args, key: string): unknown {
  return key.split('.').reduce<unknown>((o, k) => (o == null ? undefined : (o as Args)[k]), args);
}

/** Copy of args with a (dotted) value set, copying each object along the path. */
export function setArg(args: Args, key: string, value: unknown): Args {
  const [head, ...rest] = key.split('.') as [string, ...string[]];
  const next = rest.length ? setArg((args[head] as Args | undefined) ?? {}, rest.join('.'), value) : value;
  return { ...args, [head]: next };
}

function hidden(at: ArgType | undefined): boolean {
  return controlKind(at) === 'none' || !!at?.table?.disable;
}

function fieldFor(key: string, value: unknown, at: ArgType | undefined): Field | null {
  if (typeof value === 'function' || hidden(at)) return null;
  const control = controlKind(at);
  if (control === 'date' || (control === undefined && isoDate(value))) return { key, kind: 'date', value, argType: at };
  const [knob] = buildKnobs({ [key]: value }, at ? { [key]: at } : {});
  // Unset optional props still get a field, typed from their declared control.
  const kind = knob!.kind === 'none' ? (at?.options ? 'select' : 'text') : knob!.kind;
  return kind === 'action' ? null : { key, kind, value, argType: at };
}

/**
 * The panel's fields for a story: declared argTypes first (in order), then
 * any other args. An object arg with declared dotted fields shows those;
 * without, its primitive fields expand (identity fields excluded). An object
 * arg declared `json` stays one JSON field.
 */
export function buildFields(item: PlaygroundItem, story: StoryEntry, args: Args): Field[] {
  const argTypes = story.argTypes;
  const chipKeys = new Set(item.group.stories.flatMap((s) => Object.keys(s.story.args ?? {})).filter((k) => FORCE_KEYS.has(k)));
  const seen = new Set<string>();
  const out: Field[] = [];
  const push = (f: Field | null): void => {
    if (f && !seen.has(f.key)) {
      seen.add(f.key);
      out.push(f);
    }
  };
  const visit = (key: string): void => {
    if (seen.has(key) || chipKeys.has(key)) return;
    if (key.includes('.')) return push(fieldFor(key, getArg(args, key), argTypes[key]));
    const value = args[key];
    const declared = Object.keys(argTypes).filter((k) => k.startsWith(`${key}.`));
    const control = controlKind(argTypes[key]);
    if (isPlain(value) && (!control || (control === 'json' && declared.length === 0 && expandable(value)))) {
      if (hidden(argTypes[key])) return;
      seen.add(key);
      if (declared.length) return declared.forEach(visit);
      for (const [k, v] of Object.entries(value)) {
        if (!IDENTITY_KEYS.has(k) && (typeof v !== 'object' || v === null)) push(fieldFor(`${key}.${k}`, v, undefined));
      }
      return;
    }
    push(fieldFor(key, value, argTypes[key]));
  };
  Object.keys(argTypes).forEach(visit);
  Object.keys(args).forEach(visit);
  return out;
}

/** A record of mostly primitives (an episode, a user) reads better as fields than as one JSON line. */
function expandable(value: Record<string, unknown>): boolean {
  const entries = Object.entries(value).filter(([k]) => !IDENTITY_KEYS.has(k));
  const primitive = entries.filter(([, v]) => typeof v !== 'object' || v === null);
  return primitive.length >= 2 && primitive.length >= entries.length / 2;
}

/** Select options as label/value pairs (Storybook `mapping` aware). */
export function selectOptions(field: Field): { label: string; value: unknown }[] {
  const at = field.argType;
  return (at?.options ?? []).map((o) => ({
    label: optionLabel(o, at),
    value: at?.mapping && String(o) in at.mapping ? at.mapping[String(o)] : o,
  }));
}

/** Index of the option holding `value`, or -1. */
export function selectIndex(field: Field): number {
  return selectOptions(field).findIndex((o) => o.value === field.value || String(o.value) === String(field.value));
}

export function optionValue(field: Field, index: number, raw: string): unknown {
  const opt = selectOptions(field)[index];
  if (opt) return opt.value;
  return coerceOption(raw, field.argType?.options ?? []);
}

/** Story's own args (what its chip sets), not meta's shared ones. */
const own = (s: StoryEntry): Args => s.story.args ?? {};

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if ((a ?? false) === (b ?? false)) return true;
  return isPlain(a) && isPlain(b) && JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Switches to a story (chip). A chip that only forces a visual (`pressed`)
 * keeps the data as it is; any other chip resets the args the chips own and
 * keeps the user's edits to everything else.
 */
export function applyStory(item: PlaygroundItem, current: Args, target: StoryEntry): Args {
  const keys = Object.keys(own(target));
  if (keys.length && keys.every((k) => FORCE_KEYS.has(k))) return { ...current, ...cloneArgs(own(target)) };
  const owned = new Set(item.group.stories.flatMap((s) => Object.keys(own(s))));
  const next = cloneArgs(target.args);
  for (const [k, v] of Object.entries(current)) {
    if (!owned.has(k) && typeof v !== 'function') next[k] = v;
  }
  return next;
}

/** The chip the args match: the remembered one if it still holds, else the most specific. */
export function matchStory(item: PlaygroundItem, args: Args, remembered: string | null): string | null {
  const holds = (s: StoryEntry): boolean =>
    Object.entries(own(s)).every(([k, v]) => same(args[k], v)) && [...FORCE_KEYS].every((k) => k in own(s) || !args[k]);
  const stories = item.group.stories;
  const rem = stories.find((s) => s.id === remembered);
  if (rem && holds(rem)) return rem.id;
  const matches = stories.filter(holds).sort((a, b) => Object.keys(own(b)).length - Object.keys(own(a)).length);
  return matches[0]?.id ?? null;
}

// ---------- events ----------

/** Maps a callback's call onto the args the panel shows (null: no change). */
export type WriteBack = (args: Args, ...callArgs: unknown[]) => Args | null;

/** `flip('isFavorite')`: a write-back that toggles a boolean arg. */
export const flip =
  (key: string): WriteBack =>
  (a) =>
    key in a ? { ...a, [key]: !a[key] } : null;

/** React Native's controlled-input conventions: the panel follows what the component reports. */
export const DEFAULT_WRITE_BACK: Record<string, WriteBack> = {
  onValueChange: (a, v) => ('value' in a ? { ...a, value: v } : null),
  onChangeText: (a, t) => ('value' in a ? { ...a, value: t } : null),
};

export interface PlaygroundEvent {
  name: string;
  payload: string;
}

function summarize(v: unknown): string {
  if (isPlain(v)) {
    const id = ['guid', 'id'].find((k) => typeof v[k] === 'string' || typeof v[k] === 'number');
    if (id) return `{ ${id}: '${String(v[id])}' }`;
    if ('nativeEvent' in v) return 'PressEvent';
  }
  if (typeof v === 'string') return `'${v}'`;
  return describeValue(v);
}

/** `{ guid: 'lfr-314' }` for the record a callback was about (from its args, or the story's own record). */
export function describeEvent(callArgs: unknown[], args: Args): string {
  if (callArgs.length) return callArgs.map(summarize).join(', ');
  const subject = Object.values(args).find((v) => isPlain(v) && ('guid' in v || 'id' in v));
  return subject ? summarize(subject) : '';
}

/**
 * The story's args with every callback wrapped (args.ts wrapActions) to log
 * to the event log and write the component's own state change back. Lookup:
 * `<Component>.<callback>`, then `<callback>`.
 */
export function bindActions(
  item: PlaygroundItem,
  args: Args,
  writeBack: Record<string, WriteBack>,
  emit: (event: PlaygroundEvent, update?: (a: Args) => Args) => void
): Args {
  return wrapActions(args, (name, callArgs) => {
    const back = writeBack[`${item.name}.${name}`] ?? writeBack[name];
    emit({ name, payload: describeEvent(callArgs, args) }, back ? (a) => back(a, ...callArgs) ?? a : undefined);
  });
}

/** Callback the event log names before anything fired (the first one the story takes). */
export function primaryAction(args: Args): string | null {
  return Object.keys(args).find((k) => typeof args[k] === 'function') ?? null;
}

/**
 * Light/dark for a story: an arg spelled `theme`/`colorScheme`/`scheme`
 * holding 'light' | 'dark' is the story's own switch; null when the story
 * has none (the chips or the canvas sheet carry the scheme instead).
 */
export function schemeArg(args: Args): string | null {
  return ['colorScheme', 'theme', 'scheme'].find((k) => args[k] === 'light' || args[k] === 'dark') ?? null;
}

/** A chip that IS the dark (or light) variant: named so, or declaring the scheme in parameters. */
export function schemeOfStory(story: StoryEntry): 'light' | 'dark' | null {
  const p = story.parameters as Record<string, unknown>;
  const declared = [p.colorScheme, p.theme, p.igniteTheme, p.scheme].find((v) => v === 'light' || v === 'dark');
  if (declared) return declared as 'light' | 'dark';
  if (/\bdark\b/i.test(story.name)) return 'dark';
  return null;
}
