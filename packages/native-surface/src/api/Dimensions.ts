import { createContext, useContext } from 'react';

export interface WindowDimensions {
  width: number;
  height: number;
  scale: number;
  fontScale: number;
}

export const DimensionsContext = createContext<WindowDimensions | null>(null);

let primary: WindowDimensions | null = null;

/**
 * The root currently rendering/committing. While React works inside a given
 * root, module-level `Dimensions.get('window')` answers with THAT root's
 * dims — each surface is its components' "window" (RN's one-window-per-app
 * semantics, mapped to a multi-surface page). Libraries read Dimensions at
 * mount time (e.g. @gorhom/bottom-sheet's initial off-screen position), and
 * the first-created surface on the page is not their window.
 */
let activeRender: WindowDimensions | null = null;

export function pushActiveRenderDimensions(d: WindowDimensions): WindowDimensions | null {
  const prev = activeRender;
  activeRender = d;
  return prev;
}

export function popActiveRenderDimensions(prev: WindowDimensions | null): void {
  activeRender = prev;
}

type DimensionsListener = (payload: { window: WindowDimensions; screen: WindowDimensions }) => void;
const dimensionListeners = new Set<DimensionsListener>();

/** Called by the first created root (and on its resize). */
export function setPrimaryDimensions(d: WindowDimensions, force = false): void {
  if (force || primary == null) {
    primary = d;
    for (const l of [...dimensionListeners]) l({ window: d, screen: d });
  }
}

export const Dimensions = {
  get(_dim: 'window' | 'screen'): WindowDimensions {
    if (activeRender) return activeRender;
    if (primary) return primary;
    if (typeof window !== 'undefined') {
      return {
        width: window.innerWidth,
        height: window.innerHeight,
        scale: window.devicePixelRatio ?? 1,
        fontScale: 1,
      };
    }
    return { width: 0, height: 0, scale: 1, fontScale: 1 };
  },
  addEventListener(_type: 'change', listener: DimensionsListener): { remove(): void } {
    dimensionListeners.add(listener);
    return { remove: () => dimensionListeners.delete(listener) };
  },
  removeEventListener(_type: 'change', listener: DimensionsListener): void {
    dimensionListeners.delete(listener);
  },
};

export function useWindowDimensions(): WindowDimensions {
  const ctx = useContext(DimensionsContext);
  return ctx ?? Dimensions.get('window');
}

export const PixelRatio = {
  get(): number {
    return Dimensions.get('window').scale;
  },
  roundToNearestPixel(n: number): number {
    const ratio = PixelRatio.get() || 1;
    return Math.round(n * ratio) / ratio;
  },
};
