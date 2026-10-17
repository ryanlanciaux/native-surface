// Playground state helpers over the ignite-demo catalog: which entries the
// sidebar lists, how a state pill maps onto props, which callbacks feed the
// event log, and the generated Usage snippet.
import { getCatalogEntry, getControlValue, setControlValue } from 'ignite-demo';
import type { AnyCatalogEntry, CatalogVariant } from 'ignite-demo';

export type Props = Record<string, unknown>;

export interface ListItem {
  /** Label as in the design's sidebar. */
  label: string;
  entry: AnyCatalogEntry;
}

const pick = (label: string, name = label): ListItem => {
  const entry = getCatalogEntry(name);
  if (!entry) throw new Error(`ignite-demo catalog has no ${name}`);
  return { label, entry };
};

/** The design's sidebar, in its order; design names map onto catalog entries. */
export const COMPONENT_LIST: ListItem[] = [
  pick('AutoImage'),
  pick('Button'),
  pick('Card'),
  pick('EpisodeCard'),
  pick('Header'),
  pick('ListItem'),
  pick('TextField'),
  pick('Toggle'),
];
export const SCREEN_LIST: ListItem[] = [
  // The demo app has no welcome screen; its entry point is the whole app.
  pick('WelcomeScreen', 'IgniteApp'),
  pick('DemoShowroomScreen'),
  pick('DemoPodcastListScreen'),
];
export const DEFAULT_ENTRY = 'EpisodeCard';
export const DEFAULT_VARIANT = 'favorited';

/** Deep copy of plain data; functions and other instances are kept by reference. */
export function cloneProps<T>(v: T): T {
  if (Array.isArray(v)) return v.map(cloneProps) as T;
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, cloneProps(x)])) as T;
  }
  return v;
}

/**
 * Full props for an entry: always the complete defaultProps (a dotted
 * `setControlValue` on partial overrides would drop sibling fields such as
 * `episode.guid` / `episode.cover`), with the variant on top.
 */
export function seedProps(entry: AnyCatalogEntry, variant?: CatalogVariant<Props>): Props {
  return { ...cloneProps(entry.defaultProps as Props), ...cloneProps(variant?.props ?? {}) };
}

/** Visual-only switches a pill forces; every other pill clears them. */
const FORCE_KEYS = new Set(['pressed']);

/**
 * Applies a state pill. Pills that only force a visual (EpisodeCard
 * "pressed") keep the data as it is (`isFavorite` stays); the others reseed
 * the keys the pills own, keeping the user's edits to every other control.
 */
export function applyVariant(entry: AnyCatalogEntry, current: Props, variant: CatalogVariant<Props>): Props {
  const keys = Object.keys(variant.props);
  if (keys.length && keys.every((k) => FORCE_KEYS.has(k))) return { ...current, ...cloneProps(variant.props) };
  const owned = new Set(entry.variants.flatMap((v) => Object.keys(v.props)));
  let next = seedProps(entry, variant);
  for (const key of Object.keys(entry.controls)) {
    if (!owned.has(key.split('.')[0]!)) next = setControlValue(next, key, getControlValue(current, key));
  }
  return next;
}

/** The pill matching the props: the remembered one if it still holds, else the most specific match. */
export function matchVariant(entry: AnyCatalogEntry, props: Props, remembered: string | null): string | null {
  const holds = (v: CatalogVariant<Props>) =>
    Object.entries(v.props).every(([k, x]) => (props[k] ?? false) === (x ?? false)) &&
    [...FORCE_KEYS].every((k) => k in v.props || !props[k]);
  const rem = entry.variants.find((v) => v.name === remembered);
  if (rem && holds(rem)) return rem.name;
  const matches = entry.variants.filter(holds).sort((a, b) => Object.keys(b.props).length - Object.keys(a.props).length);
  return matches[0]?.name ?? null;
}

export interface PlaygroundEvent {
  name: string;
  payload: string;
}

interface Handler {
  prop: string;
  describe: (...args: unknown[]) => string;
  /** Keeps the panel in sync with what the component just did. */
  apply?: (props: Props, ...args: unknown[]) => Props;
  /** Right-hand side shown in the Usage snippet. */
  usage: string;
}

const flip = (key: string) => (p: Props) => ({ ...p, [key]: !p[key] });
const q = (s: unknown) => `'${String(s)}'`;

const HANDLERS: Record<string, Handler[]> = {
  EpisodeCard: [
    {
      prop: 'onPressFavorite',
      describe: (ep) => `{ guid: ${q((ep as { guid: string }).guid)} }`,
      apply: flip('isFavorite'),
      usage: '() => episodeStore.toggleFavorite(episode)',
    },
  ],
  FavButton: [{ prop: 'onPress', describe: () => '', apply: flip('isFavorite'), usage: 'toggleFavorite' }],
  Toggle: [
    {
      prop: 'onValueChange',
      describe: (v) => String(v),
      apply: (p, v) => ({ ...p, value: v }),
      usage: 'setShowFavorites',
    },
  ],
  TabBar: [{ prop: 'onTabPress', describe: (t) => q(t), apply: (p, t) => ({ ...p, active: t }), usage: 'navigation.navigate' }],
  Button: [{ prop: 'onPress', describe: () => '', usage: '() => subscribe()' }],
  ListItem: [{ prop: 'onPress', describe: () => '', usage: '() => open()' }],
  Header: [
    { prop: 'onLeftPress', describe: () => '', usage: 'navigation.goBack' },
    { prop: 'onRightPress', describe: () => '', usage: '() => search()' },
  ],
  TextField: [
    { prop: 'onChangeText', describe: (t) => q(t), apply: (p, t) => ({ ...p, value: t }), usage: 'setEmail' },
  ],
  IgniteApp: [
    { prop: 'onTabChange', describe: (t) => q(t), usage: 'analytics.screen' },
    {
      prop: 'onPressFavorite',
      describe: (ep, fav) => `{ guid: ${q((ep as { guid: string }).guid)}, isFavorite: ${String(fav)} }`,
      usage: 'episodeStore.toggleFavorite',
    },
  ],
};

/**
 * The entry's props with its callbacks bound to the event log. `apply` writes
 * the component's own state change back (Like → isFavorite), so the props
 * panel and Usage snippet follow taps on the canvas.
 */
export function withHandlers(
  entry: AnyCatalogEntry,
  props: Props,
  emit: (event: PlaygroundEvent, update?: (p: Props) => Props) => void,
): Props {
  const next = { ...props };
  for (const h of HANDLERS[entry.name] ?? []) {
    next[h.prop] = (...args: unknown[]) =>
      emit({ name: h.prop, payload: h.describe(...args) }, h.apply ? (p) => h.apply!(p, ...args) : undefined);
  }
  return next;
}

/** The handler the event box shows before anything fired. */
export function primaryEvent(entry: AnyCatalogEntry): string | null {
  return HANDLERS[entry.name]?.[0]?.prop ?? null;
}

export type Tok = { t: string; c: 'punct' | 'tag' | 'attr' | 'ident' | 'lit' };

/** `<Name prop={value} … />` for the current props, one prop per line. */
export function usageLines(entry: AnyCatalogEntry, props: Props): Tok[][] {
  const lines: Tok[][] = [[{ t: '<', c: 'punct' }, { t: entry.name === 'IgniteApp' ? 'IgniteApp' : entry.name, c: 'tag' }]];
  const defaults = entry.defaultProps as Props;
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || typeof value === 'function') continue;
    lines.push([{ t: `  ${key}`, c: 'attr' }, ...valueTokens(key, value, defaults[key])]);
  }
  for (const h of HANDLERS[entry.name] ?? []) {
    lines.push([{ t: `  ${h.prop}`, c: 'attr' }, { t: '={', c: 'punct' }, { t: h.usage, c: 'ident' }, { t: '}', c: 'punct' }]);
  }
  lines.push([{ t: '/>', c: 'punct' }]);
  return lines;
}

function valueTokens(key: string, value: unknown, base: unknown): Tok[] {
  if (typeof value === 'string') return [{ t: '=', c: 'punct' }, { t: JSON.stringify(value), c: 'lit' }];
  if (value && typeof value === 'object' && !Array.isArray(value) && key === 'episode') {
    // The design's form: the store's episode, plus whatever the panel changed.
    const changed = Object.entries(value).filter(([k, v]) => (base as Props | undefined)?.[k] !== v);
    const src: Tok[] = [{ t: 'episodeStore', c: 'ident' }, { t: '.episodes[', c: 'punct' }, { t: '0', c: 'lit' }, { t: ']', c: 'punct' }];
    if (!changed.length) return [{ t: '={', c: 'punct' }, ...src, { t: '}', c: 'punct' }];
    return [
      { t: '={{ ...', c: 'punct' },
      ...src,
      ...changed.flatMap(([k, v]): Tok[] => [{ t: `, ${k}: `, c: 'punct' }, { t: shortLiteral(k, v), c: 'lit' }]),
      { t: ' }}', c: 'punct' },
    ];
  }
  return [{ t: '={', c: 'punct' }, { t: shortLiteral(key, value), c: 'lit' }, { t: '}', c: 'punct' }];
}

function shortLiteral(key: string, v: unknown): string {
  // Bundled asset URLs are long and build-specific; show the file.
  if (typeof v === 'string' && /cover|uri/i.test(key)) return JSON.stringify(v.split('/').pop()!.replace(/-[\w-]{8}(\.\w+)$/, '$1'));
  return JSON.stringify(v);
}
