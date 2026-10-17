// `@native-surface/playground/embed`: the playground UI as one component, for
// pages that host it themselves (the standalone tool's App is a thin wrapper
// around the same component).
//
//   const stories = import.meta.glob('./src/**/*.stories.tsx');
//   const index = await loadIndex(stories);
//   <Playground index={index} sources={globSources(rawFiles)} devices={IPHONES} />
//
// Skinning: `className` / `style` on the root `.nsp`, the `--nsp-*` custom
// properties (playground.css), `canvasBackground`, and `renderSurface` to
// own the canvas (lazy mounting, WebGL context budgets, input remapping).
import './ui/fonts';
import './ui/playground.css';

export { Playground } from './ui/Playground';
export type { PlaygroundProps } from './ui/Playground';
export { DefaultSurface, StoryErrorPanel } from './ui/Preview';
export type { RenderSurface, SurfaceSlotProps } from './ui/Preview';
export { loadIndex } from './loader';
export type { StoryModules } from './loader';
export { buildIndex, buildGroup, composeStory } from './csf';
export type { StoryEntry, StoryGroup, StoryIndex } from './csf';
export { globSources, endpointSources } from './sources';
export type { SourceFile, SourceProvider } from './sources';
export { VIEWPORTS, IPHONES, DEFAULT_VIEWPORT, customViewport } from './viewports';
export type { Viewport } from './viewports';
export { flip, DEFAULT_WRITE_BACK } from './fields';
export type { WriteBack } from './fields';
export type { Tok, UsageHooks } from './usage';
export type { PlaygroundItem, PlaygroundParameters } from './items';
export { PlaygroundGlobalsContext, usePlaygroundGlobals } from './globals';
export type { PlaygroundGlobals } from './globals';
export type { ArgType, Args, ColorScheme, Decorator, Meta, Story, StoryContext, Theme } from './story-types';
