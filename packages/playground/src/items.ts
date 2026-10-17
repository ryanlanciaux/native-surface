// Sidebar rows: one per CSF group (a component or a screen), its stories
// becoming the canvas's state chips. Kind and layout come from the group's
// `parameters` when declared, else from the title (`Screens/…`, `…Screen`).
import { filterGroups } from './csf';
import type { StoryGroup, StoryIndex } from './csf';

/** `parameters` the playground UI reads (all optional; CSF files may set none). */
export interface PlaygroundParameters {
  kind?: 'component' | 'screen';
  /**
   * fullscreen: device-sized at the device's true points, scaled to fit;
   * fullwidth: device width; padded: device width minus the gutter;
   * centered: intrinsic size.
   */
  layout?: 'fullscreen' | 'fullwidth' | 'padded' | 'centered';
  /** `transparent` floats the component (it brings its own surface + shadow) on the canvas. */
  surface?: 'transparent' | 'sheet';
  /** Points the component paints outside its box (shadows). */
  bleed?: number;
  /** Candidate source file basenames (no extension) for the Source tab. */
  sourceNames?: string[];
}

export interface PlaygroundItem {
  id: string;
  /** Last segment of the CSF title. */
  name: string;
  kind: 'component' | 'screen';
  group: StoryGroup;
  parameters: PlaygroundParameters;
  /** Story module path ('' when unknown). */
  path: string;
}

export interface PlaygroundItems {
  components: PlaygroundItem[];
  screens: PlaygroundItem[];
  all: PlaygroundItem[];
}

const leaf = (title: string): string => title.split('/').pop()!.trim();

function kindOf(group: StoryGroup, parameters: PlaygroundParameters): 'component' | 'screen' {
  if (parameters.kind) return parameters.kind;
  if (/^screens?\//i.test(group.title)) return 'screen';
  if (parameters.layout === 'fullscreen') return 'screen';
  return /Screen$|App$/.test(leaf(group.title)) ? 'screen' : 'component';
}

export function toItem(group: StoryGroup): PlaygroundItem {
  const parameters = (group.stories[0]?.parameters ?? {}) as PlaygroundParameters;
  const kind = kindOf(group, parameters);
  return {
    id: group.id,
    name: leaf(group.title),
    kind,
    group,
    path: group.path ?? '',
    parameters: { layout: kind === 'screen' ? 'fullscreen' : 'padded', ...parameters, kind },
  };
}

export function toItems(index: StoryIndex): PlaygroundItems {
  const all = index.groups.map(toItem).sort((a, b) => a.name.localeCompare(b.name));
  return {
    components: all.filter((i) => i.kind === 'component'),
    screens: all.filter((i) => i.kind === 'screen'),
    all,
  };
}

/** csf.ts filterGroups over the rows: name or any story name, case-insensitive. */
export function filterItems(items: PlaygroundItem[], query: string): PlaygroundItem[] {
  const keep = new Set(filterGroups(items.map((i) => ({ ...i.group, title: i.name })), query).map((g) => g.id));
  return items.filter((i) => keep.has(i.id));
}

export function itemOfStory(items: PlaygroundItem[], storyId: string | null): PlaygroundItem | null {
  if (!storyId) return null;
  return items.find((i) => i.group.stories.some((s) => s.id === storyId)) ?? null;
}
