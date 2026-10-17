// The Usage tab: `<Name prop={value} … />` generated from the live args, one
// prop per line, with the app's store idioms (episodeStore) where the args
// came from it.
import { episodes } from 'ignite-demo';
import type { Args, PlaygroundItem } from './types';

export type Tok = { t: string; c: 'punct' | 'tag' | 'attr' | 'ident' | 'lit' };

/** Right-hand side shown for a callback prop. */
const HANDLER_USAGE: Record<string, string> = {
  onPressFavorite: '() => episodeStore.toggleFavorite(episode)',
  onValueChange: 'setShowFavorites',
  onChangeText: 'setEmail',
  onTabPress: 'navigation.navigate',
  onTabChange: 'analytics.screen',
  onLeftPress: 'navigation.goBack',
};
const handlerUsage = (item: PlaygroundItem, prop: string) =>
  HANDLER_USAGE[prop] ??
  (item.name === 'FavButton' ? '() => episodeStore.toggleFavorite(episode)' : `handle${prop.replace(/^on/, '')}`);

export function usageLines(item: PlaygroundItem, args: Args): Tok[][] {
  const lines: Tok[][] = [[{ t: '<', c: 'punct' }, { t: item.name, c: 'tag' }]];
  const handlers: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined) continue;
    if (typeof value === 'function') handlers.push(key);
    else lines.push([{ t: `  ${key}`, c: 'attr' }, ...valueTokens(key, value)]);
  }
  for (const prop of handlers) {
    lines.push([{ t: `  ${prop}`, c: 'attr' }, { t: '={', c: 'punct' }, { t: handlerUsage(item, prop), c: 'ident' }, { t: '}', c: 'punct' }]);
  }
  lines.push([{ t: '/>', c: 'punct' }]);
  return lines;
}

function valueTokens(key: string, value: unknown): Tok[] {
  if (typeof value === 'string') return [{ t: '=', c: 'punct' }, { t: JSON.stringify(shortLiteral(key, value)), c: 'lit' }];
  const fromStore = storeEpisode(value);
  if (fromStore) {
    // The store's episode, plus whatever the panel changed.
    const [index, base] = fromStore;
    const changed = Object.entries(value as Args).filter(([k, v]) => (base as unknown as Args)[k] !== v);
    const src: Tok[] = [{ t: 'episodeStore', c: 'ident' }, { t: '.episodes[', c: 'punct' }, { t: String(index), c: 'lit' }, { t: ']', c: 'punct' }];
    if (!changed.length) return [{ t: '={', c: 'punct' }, ...src, { t: '}', c: 'punct' }];
    return [
      { t: '={{ ...', c: 'punct' },
      ...src,
      ...changed.flatMap(([k, v]): Tok[] => [{ t: `, ${k}: `, c: 'punct' }, { t: literal(k, v), c: 'lit' }]),
      { t: ' }}', c: 'punct' },
    ];
  }
  return [{ t: '={', c: 'punct' }, { t: literal(key, value), c: 'lit' }, { t: '}', c: 'punct' }];
}

function storeEpisode(value: unknown): [number, (typeof episodes)[number]] | null {
  if (!value || typeof value !== 'object' || !('guid' in value)) return null;
  const index = episodes.findIndex((e) => e.guid === (value as { guid: unknown }).guid);
  return index < 0 ? null : [index, episodes[index]!];
}

/** Bundled asset URLs are long and build-specific; show the file. */
function shortLiteral(key: string, v: string): string {
  return /cover|uri|image|thumbnail/i.test(key) ? v.split('/').pop()!.replace(/-[\w-]{8}(\.\w+)$/, '$1') : v;
}

function literal(key: string, v: unknown): string {
  if (typeof v === 'string') return JSON.stringify(shortLiteral(key, v));
  return JSON.stringify(v, (k, x) => (typeof x === 'string' ? shortLiteral(k, x) : x)) ?? String(v);
}
