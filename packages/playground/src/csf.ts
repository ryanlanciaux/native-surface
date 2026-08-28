import { createElement } from 'react';
import type { ReactElement } from 'react';
import type { ArgType, Args, Meta, Story, StoryContext } from './story-types';

export interface StoryEntry {
  /** Stable URL id: `<group>--<story>`, e.g. `button--primary`. */
  id: string;
  groupId: string;
  title: string;
  exportName: string;
  name: string;
  meta: Meta;
  story: Story;
  /** meta.args merged with story.args. */
  args: Args;
  /** meta.argTypes merged with story.argTypes. */
  argTypes: Record<string, ArgType>;
  /** meta.parameters merged with story.parameters; opaque to the playground. */
  parameters: Record<string, unknown>;
}

export interface StoryGroup {
  id: string;
  title: string;
  stories: StoryEntry[];
}

export interface StoryIndex {
  groups: StoryGroup[];
  allStories: StoryEntry[];
  /** Where the modules came from: a host app's files or the local demo glob. */
  source: 'host' | 'local';
}

const NON_STORY_EXPORTS = new Set(['meta', 'default', '__esModule']);

function slug(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function humanize(exportName: string): string {
  return exportName
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `Button.stories.tsx` / `Card.play.tsx` → `Button` / `Card`. */
export function titleFromPath(path: string): string {
  const base = path.split('/').pop() ?? path;
  return base.replace(/\.(stories|story|play)\.[jt]sx?$/, '').replace(/\.[jt]sx?$/, '');
}

function readMeta(mod: Record<string, unknown>, path: string): Meta {
  const candidate = mod.meta ?? mod.default;
  const meta: Meta = isRecord(candidate) ? (candidate as unknown as Meta) : {};
  if (typeof meta.title === 'string' && meta.title.length > 0) return meta;
  // CSF3 allows title-less meta (Storybook autotitles from the path); `*.play`
  // files need no meta at all — both fall back to the file name.
  return { ...meta, title: titleFromPath(path) };
}

/** Normalizes one module export into a Story, or null when it isn't one.
 *  CSF3: a plain function export IS the story (function = render); its
 *  Storybook-style `storyName` property overrides the display name. */
function readStory(value: unknown): Story | null {
  if (typeof value === 'function') {
    const fn = value as ((args: Args) => ReactElement) & { storyName?: string };
    const story: Story = { render: fn };
    if (typeof fn.storyName === 'string') story.name = fn.storyName;
    return story;
  }
  if (isRecord(value)) return value as unknown as Story;
  return null;
}

export function buildGroup(path: string, mod: Record<string, unknown>): StoryGroup | null {
  const meta = readMeta(mod, path);
  const title = meta.title ?? titleFromPath(path);
  const groupId = slug(title);
  const stories: StoryEntry[] = [];

  for (const [exportName, value] of Object.entries(mod)) {
    if (NON_STORY_EXPORTS.has(exportName)) continue;
    const story = readStory(value);
    if (!story) continue;
    if (!meta.component && typeof story.render !== 'function' && typeof meta.render !== 'function') {
      console.warn(
        `[playground] ${path}: story "${exportName}" has no render source (story.render, meta.render, or meta.component); skipping.`
      );
      continue;
    }
    stories.push({
      id: `${groupId}--${slug(exportName)}`,
      groupId,
      title,
      exportName,
      name: story.name ?? humanize(exportName),
      meta,
      story,
      args: { ...meta.args, ...story.args },
      argTypes: { ...meta.argTypes, ...story.argTypes },
      parameters: { ...meta.parameters, ...story.parameters },
    });
  }

  if (stories.length === 0) return null;

  const order = meta.order ?? [];
  stories.sort((a, b) => {
    const ai = order.indexOf(a.exportName);
    const bi = order.indexOf(b.exportName);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.exportName.localeCompare(b.exportName);
  });

  return { id: groupId, title, stories };
}

/** A module that failed to LOAD (top-level throw — usually an unbridged native
 *  import) becomes a one-story group whose render rethrows, so the failure
 *  lands in the per-story error boundary instead of killing the whole UI. */
export function errorGroup(path: string, error: Error): StoryGroup {
  const title = titleFromPath(path);
  const groupId = `error-${slug(path)}`;
  const meta: Meta = { title };
  const story: Story = {
    render: () => {
      throw error;
    },
  };
  return {
    id: groupId,
    title,
    stories: [
      {
        id: `${groupId}--load-error`,
        groupId,
        title,
        exportName: 'load-error',
        name: 'Load error',
        meta,
        story,
        args: {},
        argTypes: {},
        parameters: {},
      },
    ],
  };
}

export function buildIndex(
  modules: Map<string, Record<string, unknown>>,
  failures: Map<string, Error>,
  source: StoryIndex['source']
): StoryIndex {
  const groups: StoryGroup[] = [...modules.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([path, mod]) => {
      const group = buildGroup(path, mod);
      return group ? [group] : [];
    });
  for (const [path, error] of [...failures.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    groups.push(errorGroup(path, error));
  }
  groups.sort((a, b) => a.title.localeCompare(b.title));
  return { groups, allStories: groups.flatMap((group) => group.stories), source };
}

/**
 * Renders an entry: story.render → meta.render → `<meta.component {...args}/>`,
 * wrapped in story decorators (innermost) then meta decorators — Storybook's
 * composition order. Runs user code, so callers must invoke it inside the
 * preview error boundary, not during their own render.
 */
export function composeStory(entry: StoryEntry, args: Args, context: StoryContext): ReactElement {
  const base = (): ReactElement => {
    const render = entry.story.render ?? entry.meta.render;
    if (render) return render(args);
    const component = entry.meta.component;
    if (!component) throw new Error(`Story "${entry.id}" has no component and no render()`);
    return createElement(component, args);
  };
  const decorators = [...(entry.story.decorators ?? []), ...(entry.meta.decorators ?? [])];
  return decorators.reduce<() => ReactElement>((inner, decorator) => () => decorator(inner, context), base)();
}

export function findStory(all: StoryEntry[], id: string | null): StoryEntry | null {
  if (!id) return null;
  return all.find((entry) => entry.id === id) ?? null;
}

/** Filters groups by a case-insensitive substring of the component title or story name. */
export function filterGroups(groups: StoryGroup[], query: string): StoryGroup[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return groups;
  return groups.flatMap((group) => {
    if (group.title.toLowerCase().includes(needle)) return [group];
    const stories = group.stories.filter((entry) => entry.name.toLowerCase().includes(needle));
    return stories.length > 0 ? [{ ...group, stories }] : [];
  });
}
