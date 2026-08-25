import { hostMode, modules as hostModules } from 'virtual:host-stories';
import { buildIndex } from './csf';
import type { StoryIndex } from './csf';

export type { StoryEntry, StoryGroup, StoryIndex } from './csf';

// Standalone fallback: the in-repo demo stories, used only when the server did
// not inject host stories (i.e. `pnpm --filter @native-surface/playground dev`).
// Lazy on purpose — story modules run user code, and a top-level throw in one
// must break that one story, not the whole playground.
const localModules = import.meta.glob('./stories/*.stories.tsx') as Record<
  string,
  () => Promise<Record<string, unknown>>
>;

/**
 * Loads every story module (host-provided via the CLI's virtual module, else
 * the local demo glob) and builds the index. A module whose import fails —
 * top-level throw, usually an unbridged native dependency — becomes an error
 * entry that rethrows inside the preview boundary.
 */
export async function loadStoryIndex(): Promise<StoryIndex> {
  const source = hostMode ? hostModules : localModules;
  const loaded = new Map<string, Record<string, unknown>>();
  const failures = new Map<string, Error>();
  await Promise.all(
    Object.entries(source).map(async ([path, load]) => {
      try {
        loaded.set(path, (await load()) as Record<string, unknown>);
      } catch (error) {
        failures.set(path, error instanceof Error ? error : new Error(String(error)));
      }
    })
  );
  return buildIndex(loaded, failures, hostMode ? 'host' : 'local');
}
