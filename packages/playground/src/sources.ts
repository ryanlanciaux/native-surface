// Real source text for the Code view and the Source tab: the story module
// itself, and the component's own file. Two providers: a Vite `?raw` glob map
// (standalone dev, embedding apps) and the CLI server's /__ns_source endpoint
// (host apps, whose files live outside the playground's Vite root).
import type { PlaygroundItem } from './items';

export interface SourceFile {
  /** Path shown in the UI, e.g. `src/components/EpisodeCard.tsx`. */
  file: string;
  text: string;
}

export interface SourceProvider {
  story(item: PlaygroundItem): Promise<SourceFile | null>;
  component(item: PlaygroundItem): Promise<SourceFile | null>;
}

const base = (path: string): string => path.split('/').pop()!.replace(/\.(tsx?|jsx?)$/, '');
const rank = (p: string): number => (/\/components\//.test(p) ? 0 : /\/screens\//.test(p) ? 1 : 2);

/** File basenames that may hold the item's component, most specific first. */
export function componentNames(item: PlaygroundItem): string[] {
  const component = item.group.stories[0]?.meta.component as { displayName?: string; name?: string } | undefined;
  const names = [
    ...(item.parameters.sourceNames ?? []),
    item.name,
    item.name.replace(/^Demo/, ''),
    component?.displayName,
    component?.name,
  ];
  return [...new Set(names.filter((n): n is string => !!n && !/^(observer|anonymous|Component)$/i.test(n)))];
}

/** Picks the component's file among `paths` by basename, preferring components/ then screens/. */
export function pickComponentPath(paths: string[], names: string[]): string | null {
  const candidates = paths.filter((p) => !/\.(stories|story|play)\./.test(p) && !/\.(test|spec|d)\./.test(p));
  for (const name of names) {
    const hits = candidates.filter((p) => base(p) === name);
    if (hits.length) return hits.sort((a, b) => rank(a) - rank(b) || a.length - b.length)[0]!;
  }
  return null;
}

/**
 * Provider over a Vite `import.meta.glob(…, { query: '?raw', import: 'default' })`
 * map whose keys use the same spelling as the story modules' keys. `display`
 * turns a key into the path shown (default: strips leading `./`, `../`, `/`).
 * `hints` names the file (basename) for components that have none of their
 * own, e.g. `{ EpisodeCard: 'DemoPodcastListScreen' }`.
 */
export function globSources(
  files: Record<string, () => Promise<string>>,
  display: (key: string) => string = (key) => key.replace(/^(\.\.?\/)+|^\//, ''),
  hints: Record<string, string> = {}
): SourceProvider {
  const load = async (key: string | null): Promise<SourceFile | null> =>
    key && files[key] ? { file: display(key), text: await files[key]!() } : null;
  return {
    story: (item) => load(item.path || null),
    component: (item) => {
      const names = componentNames(item);
      const hint = hints[item.name];
      return load(pickComponentPath(Object.keys(files), hint ? [...names, hint] : names));
    },
  };
}

/** Provider over the CLI server's source endpoint (src/server/plugins.mjs sourcePlugin). */
export function endpointSources(endpoint: string): SourceProvider {
  const cache = new Map<string, Promise<{ story: SourceFile | null; component: SourceFile | null }>>();
  const fetchBoth = (item: PlaygroundItem): Promise<{ story: SourceFile | null; component: SourceFile | null }> => {
    let hit = cache.get(item.id);
    if (!hit) {
      const query = new URLSearchParams({ story: item.path, names: componentNames(item).join(',') });
      hit = fetch(`${endpoint}?${query}`, { headers: { accept: 'application/json' } }).then(
        async (response) =>
          response.ok && (response.headers.get('content-type') ?? '').includes('json')
            ? ((await response.json()) as { story: SourceFile | null; component: SourceFile | null })
            : { story: null, component: null },
        () => ({ story: null, component: null })
      );
      cache.set(item.id, hit);
    }
    return hit;
  };
  return {
    story: async (item) => (await fetchBoth(item)).story,
    component: async (item) => (await fetchBoth(item)).component,
  };
}
