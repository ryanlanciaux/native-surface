// Shoot mode: `native-surface playground shoot` drives the UI headless. A
// `?shoot=1` page query switches the app to deterministic settings (viewport
// from ?w/?h, dpr pinned to 1, theme from ?theme) and publishes the story
// index plus the current selection on globalThis so the driver can navigate
// per-story hash routes and know when the story it asked for is the one on
// stage.
import type { StoryIndex } from './registry';
import type { Theme } from './story-types';

export interface ShootParams {
  enabled: boolean;
  width?: number;
  height?: number;
  theme?: Theme;
}

export interface ShootStorySummary {
  id: string;
  title: string;
  name: string;
}

interface ShootGlobals {
  __playgroundShootIndex?: { source: string; stories: ShootStorySummary[] } | { error: string };
  __playgroundShootSelection?: { id: string | null };
}

export function shootParams(): ShootParams {
  if (typeof window === 'undefined') return { enabled: false };
  const params = new URLSearchParams(window.location.search);
  if (params.get('shoot') !== '1') return { enabled: false };
  const dimension = (key: string): number | undefined => {
    const raw = Number(params.get(key));
    return Number.isInteger(raw) && raw > 0 ? raw : undefined;
  };
  const theme = params.get('theme');
  return {
    enabled: true,
    width: dimension('w'),
    height: dimension('h'),
    theme: theme === 'ios' || theme === 'android' ? theme : undefined,
  };
}

export function publishShootIndex(index: StoryIndex): void {
  (globalThis as ShootGlobals).__playgroundShootIndex = {
    source: index.source,
    stories: index.allStories.map((entry) => ({ id: entry.id, title: entry.title, name: entry.name })),
  };
}

export function publishShootError(message: string): void {
  (globalThis as ShootGlobals).__playgroundShootIndex = { error: message };
}

export function publishShootSelection(id: string | null): void {
  (globalThis as ShootGlobals).__playgroundShootSelection = { id };
}
