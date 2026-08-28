import { flattenStyle } from '../engine/styles';
import type { NamedStyles, StyleProp, ViewStyle } from '../types';

const absoluteFillObject: ViewStyle = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
};

/**
 * Shared across duplicate module copies, for the reason spelled out in
 * api/Dimensions.ts: a bundler inlines this module into every prebundled
 * dependency that imports it, so the renderer would set ITS copy's hairline
 * from the surface's dpr while the app kept reading its own copy's 0.5 default
 * and drew every hairline border at the wrong width.
 */
const hairline = (globalThis as unknown as { __nativeSurfaceHairline?: { width: number } }).__nativeSurfaceHairline ??= {
  width: 0.5,
};

export const StyleSheet = {
  // RN's constrained signature: the NamedStyles bound gives TS a contextual
  // type, so string literals in style objects stay narrow ('row', not string).
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  create<T extends NamedStyles<T> | NamedStyles<any>>(styles: T & NamedStyles<any>): T {
    for (const key of Object.keys(styles)) Object.freeze((styles as Record<string, object>)[key]);
    return styles;
  },
  flatten(style: StyleProp<unknown>): Record<string, unknown> {
    return flattenStyle(style);
  },
  compose<T>(a: StyleProp<T>, b: StyleProp<T>): StyleProp<T> {
    if (a && b) return [a, b] as StyleProp<T>;
    return (a || b) as StyleProp<T>;
  },
  absoluteFill: absoluteFillObject as StyleProp<ViewStyle>,
  absoluteFillObject,
  /**
   * 1/dpr of the primary root. 0.5 until the first root exists (module-load
   * time), then updated — like RN, capture it at render time, not import time.
   *
   * A getter, not a value, so every copy of this module reads the one the
   * renderer actually set (see `hairline` above).
   */
  get hairlineWidth(): number {
    return hairline.width;
  },
};

/** Internal: called by the renderer when the primary root is (re)established. */
export function setHairlineWidth(w: number): void {
  hairline.width = w;
}
