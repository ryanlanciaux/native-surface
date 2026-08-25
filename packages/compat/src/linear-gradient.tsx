/**
 * expo-linear-gradient + react-native-linear-gradient compat (canvas host).
 *
 * Both packages paint a native linear gradient behind their children. The
 * union of the two prop surfaces compiles to the engine's `__gradient`
 * channel (painted by paintBox into the node's rounded rect, so borderRadius
 * clips it exactly like a backgroundColor). start/end are fractions of the
 * box in both packages; useAngle/angle/angleCenter follow
 * react-native-linear-gradient's semantics (degrees clockwise, 0 points up).
 * `dither` is an Android bitmap concern with no canvas equivalent; ignored.
 */
import * as React from 'react';
import { View } from 'native-surface';
import type { StyleProp, ViewStyle } from 'native-surface';

// The host view takes engine-channel props (__gradient) that ViewProps doesn't type.
const HostView = View as unknown as React.FC<Record<string, unknown>>;

interface Point {
  x: number;
  y: number;
}

/** expo-linear-gradient accepts {x, y} or an [x, y] tuple. */
export type LinearGradientPoint = Point | [number, number];

export interface LinearGradientProps {
  /** Colors in order; processColor numbers (0xAARRGGBB) pass through. */
  colors: ReadonlyArray<string | number>;
  /** 0–1 stop positions, same length as colors; defaults to even spacing. */
  locations?: ReadonlyArray<number> | null;
  /** Fraction of the box; default {x: 0.5, y: 0} (top center). */
  start?: LinearGradientPoint | null;
  /** Fraction of the box; default {x: 0.5, y: 1} (bottom center). */
  end?: LinearGradientPoint | null;
  /** react-native-linear-gradient only: derive start/end from an angle. */
  useAngle?: boolean;
  angle?: number;
  angleCenter?: Point;
  dither?: boolean;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
  [prop: string]: unknown;
}

function pt(p: LinearGradientPoint | null | undefined): Point | undefined {
  if (!p) return undefined;
  return Array.isArray(p) ? { x: p[0] ?? 0, y: p[1] ?? 0 } : p;
}

export function LinearGradient(props: LinearGradientProps): React.JSX.Element {
  const { colors, locations, start, end, useAngle, angle, angleCenter, dither: _dither, children, ...rest } = props;
  const gradient = {
    colors: [...colors],
    locations: locations ? [...locations] : null,
    start: pt(start),
    end: pt(end),
    useAngle,
    angle,
    angleCenter,
  };
  return (
    <HostView {...rest} __gradient={gradient}>
      {children}
    </HostView>
  );
}

export default LinearGradient;
