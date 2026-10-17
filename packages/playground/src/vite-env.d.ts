/// <reference types="vite/client" />

/**
 * Served by the CLI's host-story-discovery plugin (src/server/plugins.mjs);
 * the standalone vite.config.ts serves an empty stub with hostMode=false.
 */
declare module 'virtual:host-stories' {
  export const hostMode: boolean;
  export const modules: Record<string, () => Promise<Record<string, unknown>>>;
  /** Vite `?raw` glob over the story sources (standalone dev), else null. */
  export const rawSources: Record<string, () => Promise<string>> | null;
  /** The CLI server's read-only source endpoint, else null. */
  export const sourceEndpoint: string | null;
}

declare module 'virtual:playground-config' {
  export const storyPadding: number;
}
