import type { ArgType, Args, Meta, Story } from './story-types';

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
}

export interface StoryGroup {
  id: string;
  title: string;
  stories: StoryEntry[];
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

function readMeta(mod: Record<string, unknown>): Meta | null {
  const candidate = mod.meta ?? mod.default;
  if (!isRecord(candidate)) return null;
  if (typeof candidate.title !== 'string' || candidate.title.length === 0) return null;
  return candidate as unknown as Meta;
}

function buildGroup(path: string, mod: Record<string, unknown>): StoryGroup | null {
  const meta = readMeta(mod);
  if (!meta) {
    console.warn(`[playground] ${path} has no \`export const meta = { title }\`; skipping.`);
    return null;
  }

  const groupId = slug(meta.title);
  const stories: StoryEntry[] = [];

  for (const [exportName, value] of Object.entries(mod)) {
    if (NON_STORY_EXPORTS.has(exportName)) continue;
    if (!isRecord(value)) continue;
    const story = value as unknown as Story;
    if (!meta.component && typeof story.render !== 'function') {
      console.warn(
        `[playground] ${path}: story "${exportName}" has neither meta.component nor render(args); skipping.`
      );
      continue;
    }
    stories.push({
      id: `${groupId}--${slug(exportName)}`,
      groupId,
      title: meta.title,
      exportName,
      name: story.name ?? humanize(exportName),
      meta,
      story,
      args: { ...meta.args, ...story.args },
      argTypes: { ...meta.argTypes, ...story.argTypes },
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

  return { id: groupId, title: meta.title, stories };
}

const modules = import.meta.glob('./stories/*.stories.tsx', { eager: true }) as Record<
  string,
  Record<string, unknown>
>;

export const groups: StoryGroup[] = Object.entries(modules)
  .sort(([a], [b]) => a.localeCompare(b))
  .flatMap(([path, mod]) => {
    const group = buildGroup(path, mod);
    return group ? [group] : [];
  })
  .sort((a, b) => a.title.localeCompare(b.title));

export const allStories: StoryEntry[] = groups.flatMap((group) => group.stories);

export function findStory(id: string | null): StoryEntry | null {
  if (!id) return null;
  return allStories.find((entry) => entry.id === id) ?? null;
}

/** Filters groups by a case-insensitive substring of the component title or story name. */
export function filterGroups(query: string): StoryGroup[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return groups;
  return groups.flatMap((group) => {
    if (group.title.toLowerCase().includes(needle)) return [group];
    const stories = group.stories.filter((entry) => entry.name.toLowerCase().includes(needle));
    return stories.length > 0 ? [{ ...group, stories }] : [];
  });
}
