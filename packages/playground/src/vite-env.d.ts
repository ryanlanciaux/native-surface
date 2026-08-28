/// <reference types="vite/client" />

/**
 * Served by the CLI's host-story-discovery plugin (src/server/plugins.mjs);
 * the standalone vite.config.ts serves an empty stub with hostMode=false.
 */
declare module 'virtual:host-stories' {
  export const hostMode: boolean;
  export const modules: Record<string, () => Promise<Record<string, unknown>>>;
}
