import { createContext, useContext } from 'react';
import type { ColorScheme } from './story-types';

/**
 * Storybook-style globals for the story on stage. The provider sits inside
 * the element handed to the surface (the canvas has its own reconciler, so a
 * DOM-side provider would not reach it): stories read it with
 * `usePlaygroundGlobals()`, or from `context.globals` in a decorator.
 */
export interface PlaygroundGlobals {
  colorScheme: ColorScheme;
}

export const PlaygroundGlobalsContext = createContext<PlaygroundGlobals>({ colorScheme: 'light' });

export const usePlaygroundGlobals = (): PlaygroundGlobals => useContext(PlaygroundGlobalsContext);
