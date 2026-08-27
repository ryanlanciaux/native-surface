import { createContext, useContext } from 'react';

export interface WindowDimensions {
  width: number;
  height: number;
  scale: number;
  fontScale: number;
}

export const DimensionsContext = createContext<WindowDimensions | null>(null);

/**
 * The OS chrome a surface sits behind — a status bar, a notch, a home
 * indicator — in the surface's own coordinates.
 *
 * A canvas in a page has none of that, so the default is zero and stays zero.
 * But a surface is very often standing in for a device viewport (the harnesses
 * here render 390x844), and a mobile app lays itself out around these numbers:
 * headers, tab bars, and — the case that made this necessary — the height a
 * presented sheet gets, which apps compute as `screenHeight - insets.top`.
 * With a zero top inset a "full height" sheet covers the entire surface and
 * leaves no backdrop to dismiss it by.
 *
 * The EMBEDDER declares them, because only the embedder knows whether it is
 * simulating a device. `@native-surface/compat/safe-area` reports whatever is
 * declared here, which is what makes `react-native-safe-area-context` answer
 * honestly for an app that asks the standard way.
 */
export interface SurfaceInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const ZERO_INSETS: SurfaceInsets = { top: 0, right: 0, bottom: 0, left: 0 };

export const SurfaceInsetsContext = createContext<SurfaceInsets | null>(null);

/** The insets declared for the surface this component renders into. */
export function useSurfaceInsets(): SurfaceInsets {
  return useContext(SurfaceInsetsContext) ?? ZERO_INSETS;
}

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
