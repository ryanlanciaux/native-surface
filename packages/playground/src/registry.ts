import { hostMode, modules as hostModules } from 'virtual:host-stories';
import { loadIndex } from './loader';
import type { StoryIndex } from './csf';

export type { StoryEntry, StoryGroup, StoryIndex } from './csf';

// Standalone fallback: the in-repo demo stories, used only when the server did
// not inject host stories. Lazy on purpose (see loader.ts).
const localModules = import.meta.glob('./stories/*.stories.tsx') as Record<
  string,
  () => Promise<Record<string, unknown>>
>;

/** The standalone tool's index: host stories (CLI / dev stub), else the local demo glob. */
export function loadStoryIndex(): Promise<StoryIndex> {
  return hostMode ? loadIndex(hostModules, 'host') : loadIndex(localModules, 'local');
}
