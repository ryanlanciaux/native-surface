// Section 04's wiring of the native-surface playground (packages/playground,
// `@native-surface/playground/embed`) to ignite-demo: its real CSF stories,
// their source files (read-only, ?raw), the page's LiveSurface as the canvas
// slot, and the app's idioms for the event write-back and the Usage tab.
// The UI itself is the package's; nothing here re-implements it.
import { colors, colorsDark, episodes } from 'ignite-demo';
import { createElement } from 'react';
import { IPHONES, flip, globSources, loadIndex } from '@native-surface/playground/embed';
import type { PlaygroundItem, RenderSurface, StoryIndex, Tok, UsageHooks, WriteBack } from '@native-surface/playground/embed';
import { LiveSurface } from './LiveSurface';

// Lazy: a story module runs app code, and a top-level throw in one must break
// that one entry, not the playground.
const storyFiles = import.meta.glob('../../../ignite-app/src/stories/*.stories.tsx') as Record<
  string,
  () => Promise<Record<string, unknown>>
>;
const rawFiles = import.meta.glob(['../../../ignite-app/{src,app}/**/*.{ts,tsx}', '!**/*.test.*', '!**/*.d.ts'], {
  query: '?raw',
  import: 'default',
}) as Record<string, () => Promise<string>>;

export const loadIgniteStories = (): Promise<StoryIndex> => loadIndex(storyFiles);

/** Source files shown as `ignite-demo/<path>`. EpisodeCard lives inside the podcast list screen's file. */
export const igniteSources = globSources(rawFiles, (key) => `ignite-demo/${key.replace('../../../ignite-app/', '')}`, {
  EpisodeCard: 'DemoPodcastListScreen',
});

export const devices = IPHONES;

export const sheet = { light: colors.background, dark: colorsDark.background };

/** Keeps the panel in step with what the component just did (Like → isFavorite). */
export const writeBack: Record<string, WriteBack> = {
  onPressFavorite: flip('isFavorite'),
  'FavButton.onPress': flip('isFavorite'),
  onTabPress: (a, tab) => ('active' in a ? { ...a, active: tab } : null),
};

const HANDLERS: Record<string, string> = {
  onPressFavorite: '() => episodeStore.toggleFavorite(episode)',
  onValueChange: 'setShowFavorites',
  onChangeText: 'setEmail',
  onTabPress: 'navigation.navigate',
  onTabChange: 'analytics.screen',
  onLeftPress: 'navigation.goBack',
};

/** Usage tab: episodes read from the store, as the app does, plus whatever the panel changed. */
export const usage: UsageHooks = {
  handler: (component, prop) =>
    HANDLERS[prop] ?? (component === 'FavButton' && prop === 'onPress' ? '() => episodeStore.toggleFavorite(episode)' : null),
  value: (_component, _prop, value): Tok[] | null => {
    if (!value || typeof value !== 'object' || !('guid' in value)) return null;
    const index = episodes.findIndex((e) => e.guid === (value as { guid: unknown }).guid);
    if (index < 0) return null;
    const base = episodes[index] as unknown as Record<string, unknown>;
    const changed = Object.entries(value as Record<string, unknown>).filter(([k, v]) => base[k] !== v);
    const src: Tok[] = [
      { t: 'episodeStore', c: 'ident' },
      { t: '.episodes[', c: 'punct' },
      { t: String(index), c: 'lit' },
      { t: ']', c: 'punct' },
    ];
    if (!changed.length) return [{ t: '={', c: 'punct' }, ...src, { t: '}', c: 'punct' }];
    return [
      { t: '={{ ...', c: 'punct' },
      ...src,
      ...changed.flatMap(([k, v]): Tok[] => [
        { t: `, ${k}: `, c: 'punct' },
        { t: JSON.stringify(v), c: 'lit' },
      ]),
      { t: ' }}', c: 'punct' },
    ];
  },
};

/**
 * The canvas slot: the page's LiveSurface (lazy mount near the viewport, the
 * page-wide WebGL context budget, pointer remapping). The playground keeps ONE
 * surface for every entry (no per-entry key, so no new WebGL context), and
 * only scrollable screens capture the wheel: components let the page scroll.
 */
export const renderSurface: RenderSurface = (slot) =>
  createElement(LiveSurface, {
    width: slot.width,
    height: slot.height,
    rootRef: slot.rootRef,
    wheel: slot.wheel,
    safeAreaInsets: slot.safeAreaInsets,
    onReady: slot.onReady,
    children: slot.children,
  });

/**
 * The marketing site's display address: a clean path per the design, with no
 * host (the standalone tool shows its real URL; there is no hosted playground).
 */
export const urlLabel = (app: string) => (item: PlaygroundItem) => `play/${app}/${item.name}`;
