// The playground's story index: ignite-demo's CSF files when the app ships
// them, else its component catalog through the CSF adapter. Either way the
// modules go through the native-surface playground's own loader (csf.ts:
// meta/story normalization, arg merging, ordering, load-error groups).
import * as Ignite from 'ignite-demo';
import { buildGroup, errorGroup, filterGroups } from '@native-surface/playground/src/csf';
import { catalogModules } from './catalogStories';
import type { PlaygroundItem, PlaygroundParameters, StoryGroup } from './types';

// Lazy: a story module runs app code, and a top-level throw in one must break
// that one entry, not the playground.
const storyFiles = import.meta.glob(['../../../ignite-app/{src,app}/**/*.stories.tsx'], {}) as Record<
  string,
  () => Promise<Record<string, unknown>>
>;

export interface PlaygroundIndex {
  components: PlaygroundItem[];
  screens: PlaygroundItem[];
  all: PlaygroundItem[];
  /** `stories`: the app's own CSF files; `catalog`: generated from componentCatalog. */
  source: 'stories' | 'catalog';
  /** The app renders a dark theme (round-2 ignite-demo); false disables the toggle. */
  supportsDark: boolean;
}

const leaf = (title: string) => title.split('/').pop()!.trim();

function kindOf(group: StoryGroup, parameters: PlaygroundParameters): 'component' | 'screen' {
  if (parameters.kind) return parameters.kind;
  if (/^screens?\//i.test(group.title)) return 'screen';
  return /Screen$|App$/.test(leaf(group.title)) ? 'screen' : 'component';
}

function toItem(path: string, group: StoryGroup): PlaygroundItem {
  const parameters = (group.stories[0]?.parameters ?? {}) as PlaygroundParameters;
  const kind = kindOf(group, parameters);
  return {
    id: group.id,
    name: leaf(group.title),
    kind,
    group,
    path,
    parameters: { layout: kind === 'screen' ? 'fullscreen' : 'padded', ...parameters, kind },
  };
}

/** Dark mode is real only once ignite-demo ships it (contract v2: `theme` render option / stories). */
function detectDark(source: PlaygroundIndex['source']): boolean {
  if (source === 'stories') return true;
  const mod = Ignite as Record<string, unknown>;
  return ['darkTheme', 'colorsDark', 'themes', 'ThemeProvider'].some((k) => k in mod);
}

function indexOf(items: PlaygroundItem[], source: PlaygroundIndex['source']): PlaygroundIndex {
  items.sort((a, b) => a.name.localeCompare(b.name));
  return {
    components: items.filter((i) => i.kind === 'component'),
    screens: items.filter((i) => i.kind === 'screen'),
    all: items,
    source,
    supportsDark: detectDark(source),
  };
}

/** True when the app ships no CSF files yet: the index is the catalog's, built synchronously. */
export const CATALOG_ONLY = Object.keys(storyFiles).length === 0;

export function catalogIndex(): PlaygroundIndex {
  const items: PlaygroundItem[] = [];
  for (const [path, mod] of catalogModules()) {
    const group = buildGroup(path, mod);
    if (group) items.push(toItem(path, group));
  }
  return indexOf(items, 'catalog');
}

export async function loadPlaygroundIndex(): Promise<PlaygroundIndex> {
  if (CATALOG_ONLY) return catalogIndex();
  const items: PlaygroundItem[] = [];
  await Promise.all(
    Object.entries(storyFiles).map(async ([path, load]) => {
      try {
        const group = buildGroup(path, await load());
        if (group) items.push(toItem(path, group));
      } catch (error) {
        items.push(toItem(path, errorGroup(path, error instanceof Error ? error : new Error(String(error)))));
      }
    }),
  );
  return indexOf(items, 'stories');
}

/** The playground's filter (csf.ts filterGroups): component title or any story name, case-insensitive. */
export function filterItems(items: PlaygroundItem[], query: string): PlaygroundItem[] {
  const keep = new Set(filterGroups(items.map((i) => ({ ...i.group, title: i.name })), query).map((g) => g.id));
  return items.filter((i) => keep.has(i.id));
}
