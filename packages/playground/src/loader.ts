import { buildIndex } from './csf';
import type { StoryIndex } from './csf';

export type StoryModules = Record<string, () => Promise<Record<string, unknown>>>;

/**
 * Loads every story module and builds the index. A module whose import fails
 * (top-level throw, usually an unbridged native dependency) becomes an error
 * entry that rethrows inside the preview boundary. Lazy importers on purpose:
 * story modules run user code, and one throwing must break that one story,
 * not the whole playground.
 */
export async function loadIndex(modules: StoryModules, source: StoryIndex['source'] = 'host'): Promise<StoryIndex> {
  const loaded = new Map<string, Record<string, unknown>>();
  const failures = new Map<string, Error>();
  await Promise.all(
    Object.entries(modules).map(async ([path, load]) => {
      try {
        loaded.set(path, await load());
      } catch (error) {
        failures.set(path, error instanceof Error ? error : new Error(String(error)));
      }
    })
  );
  return buildIndex(loaded, failures, source);
}
