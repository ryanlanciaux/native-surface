import { flattenStyle } from '../engine/styles';
import type { NamedStyles, StyleProp, ViewStyle } from '../types';

const absoluteFillObject: ViewStyle = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
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
   */
  hairlineWidth: 0.5,
};

/** Internal: called by the renderer when the primary root is (re)established. */
export function setHairlineWidth(w: number): void {
  StyleSheet.hairlineWidth = w;
}
