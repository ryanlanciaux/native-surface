import { createContext, useContext } from 'react';

export type ColorScheme = 'light' | 'dark';

/**
 * Storybook-style globals for the story being previewed. The provider sits
 * inside the element handed to the NativeSurface (the canvas has its own
 * reconciler, so a DOM-side provider would not reach it).
 */
export interface PlaygroundGlobals {
  theme: ColorScheme;
}

export const GlobalsContext = createContext<PlaygroundGlobals>({ theme: 'light' });

export const usePlaygroundGlobals = () => useContext(GlobalsContext);
