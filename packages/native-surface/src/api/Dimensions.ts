import { createContext, useContext, type Context } from 'react';

export interface WindowDimensions {
  width: number;
  height: number;
  scale: number;
  fontScale: number;
}

type DimensionsListener = (payload: { window: WindowDimensions; screen: WindowDimensions }) => void;

/**
 * EVERY piece of module state in this file lives on `globalThis`, and that is
 * load-bearing rather than defensive.
 *
 * The bundler INLINES this module into each prebundled dependency that imports
 * it, so "module scope" is not one scope. Here specifically: an app's
 * `react-native` is aliased to the engine and is prebundled (it has to be —
 * prebundled CJS packages require deep `react-native/Libraries/*` ids at
 * runtime), while the compat shims import the engine as source. Those are two
 * copies, with two different `DimensionsContext` OBJECTS.
 *
 * The renderer provides the surface's dimensions on its copy's context; an app
 * component calling `useWindowDimensions()` reads the OTHER copy's context,
 * gets `null`, falls through to `Dimensions.get('window')` — whose `primary`
 * is also null in that copy — and lands on the last resort, `window.innerWidth`
 * / `window.innerHeight`. So the app is told it is the size of the BROWSER
 * WINDOW rather than the size of its surface.
 *
 * That is not a subtle discrepancy. It is how a bottom sheet sized
 * `screenHeight - insets.top` came out 953pt tall on an 844pt surface and
 * hung its own header 109pt above the top of the screen.
 *
 * Sharing the context object through `globalThis` makes every copy read and
 * write the same state — the same reason the expo-modules-core name registry
 * and the bottom-sheet registry are keyed this way.
 */
interface DimensionsState {
  context: Context<WindowDimensions | null>;
  insetsContext: Context<SurfaceInsets | null>;
  primary: WindowDimensions | null;
  activeRender: WindowDimensions | null;
  listeners: Set<DimensionsListener>;
}

const scope = globalThis as unknown as { __nativeSurfaceDimensions?: DimensionsState };
const state: DimensionsState = (scope.__nativeSurfaceDimensions ??= {
  context: createContext<WindowDimensions | null>(null),
  insetsContext: createContext<SurfaceInsets | null>(null),
  primary: null,
  activeRender: null,
  listeners: new Set(),
});

export const DimensionsContext = state.context;

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

export const SurfaceInsetsContext = state.insetsContext;

/** The insets declared for the surface this component renders into. */
export function useSurfaceInsets(): SurfaceInsets {
  return useContext(SurfaceInsetsContext) ?? ZERO_INSETS;
}

/**
 * The root currently rendering/committing. While React works inside a given
 * root, module-level `Dimensions.get('window')` answers with THAT root's
 * dims — each surface is its components' "window" (RN's one-window-per-app
 * semantics, mapped to a multi-surface page). Libraries read Dimensions at
 * mount time (e.g. @gorhom/bottom-sheet's initial off-screen position), and
 * the first-created surface on the page is not their window.
 */
export function pushActiveRenderDimensions(d: WindowDimensions): WindowDimensions | null {
  const prev = state.activeRender;
  state.activeRender = d;
  return prev;
}

export function popActiveRenderDimensions(prev: WindowDimensions | null): void {
  state.activeRender = prev;
}

/** Called by the first created root (and on its resize). */
export function setPrimaryDimensions(d: WindowDimensions, force = false): void {
  if (force || state.primary == null) {
    state.primary = d;
    for (const l of [...state.listeners]) l({ window: d, screen: d });
  }
}

export const Dimensions = {
  get(_dim: 'window' | 'screen'): WindowDimensions {
    if (state.activeRender) return state.activeRender;
    if (state.primary) return state.primary;
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
    state.listeners.add(listener);
    return { remove: () => state.listeners.delete(listener) };
  },
  removeEventListener(_type: 'change', listener: DimensionsListener): void {
    state.listeners.delete(listener);
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
