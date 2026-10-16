import * as React from 'react';
import { View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { colors } from '../theme';

/**
 * Vector icons drawn with react-native-svg (Skia-native on native-surface).
 * Geometry is Lucide's (ISC license, lucide.dev), the icon set the design uses:
 * 24x24 viewBox, 2px round stroke, no fill.
 */
type Shape =
  | { kind: 'path'; d: string; fill?: boolean }
  | { kind: 'circle'; cx: number; cy: number; r: number; fill?: boolean }
  | { kind: 'rect'; x: number; y: number; width: number; height: number; rx: number };

const p = (d: string, fill?: boolean): Shape => ({ kind: 'path', d, fill });

export const iconRegistry = {
  heart: [
    p('M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5'),
  ],
  component: [
    p('M15.536 11.293a1 1 0 0 0 0 1.414l2.376 2.377a1 1 0 0 0 1.414 0l2.377-2.377a1 1 0 0 0 0-1.414l-2.377-2.377a1 1 0 0 0-1.414 0z'),
    p('M2.297 11.293a1 1 0 0 0 0 1.414l2.377 2.377a1 1 0 0 0 1.414 0l2.377-2.377a1 1 0 0 0 0-1.414L6.088 8.916a1 1 0 0 0-1.414 0z'),
    p('M8.916 17.912a1 1 0 0 0 0 1.415l2.377 2.376a1 1 0 0 0 1.414 0l2.377-2.376a1 1 0 0 0 0-1.415l-2.377-2.376a1 1 0 0 0-1.414 0z'),
    p('M8.916 4.674a1 1 0 0 0 0 1.414l2.377 2.376a1 1 0 0 0 1.414 0l2.377-2.376a1 1 0 0 0 0-1.414l-2.377-2.377a1 1 0 0 0-1.414 0z'),
  ],
  users: [
    p('M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2'),
    p('M16 3.128a4 4 0 0 1 0 7.744'),
    p('M22 21v-2a4 4 0 0 0-3-3.87'),
    { kind: 'circle', cx: 9, cy: 7, r: 4 },
  ],
  podcast: [
    p('M13 17a1 1 0 1 0-2 0l.5 4.5a0.5 0.5 0 0 0 1 0z', true),
    p('M16.85 18.58a9 9 0 1 0-9.7 0'),
    p('M8 14a5 5 0 1 1 8 0'),
    { kind: 'circle', cx: 12, cy: 11, r: 1, fill: true },
  ],
  bug: [
    p('M12 20v-9'),
    p('M14 7a4 4 0 0 1 4 4v3a6 6 0 0 1-12 0v-3a4 4 0 0 1 4-4z'),
    p('M14.12 3.88 16 2'),
    p('M21 21a4 4 0 0 0-3.81-4'),
    p('M21 5a4 4 0 0 1-3.55 3.97'),
    p('M22 13h-4'),
    p('M3 21a4 4 0 0 1 3.81-4'),
    p('M3 5a4 4 0 0 0 3.55 3.97'),
    p('M6 13H2'),
    p('m8 2 1.88 1.88'),
    p('M9 7.13V6a3 3 0 1 1 6 0v1.13'),
  ],
  signal: [p('M2 20h.01'), p('M7 20v-4'), p('M12 20v-8'), p('M17 20V8'), p('M22 4v16')],
  wifi: [
    p('M12 20h.01'),
    p('M2 8.82a15 15 0 0 1 20 0'),
    p('M5 12.859a10 10 0 0 1 14 0'),
    p('M8.5 16.429a5 5 0 0 1 7 0'),
  ],
  battery: [
    p('M10 10v4'),
    p('M14 10v4'),
    p('M22 14v-4'),
    p('M6 10v4'),
    { kind: 'rect', x: 2, y: 6, width: 16, height: 12, rx: 2 },
  ],
  caretRight: [p('m9 18 6-6-6-6')],
  github: [
    p('M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4'),
    p('M9 18c-4.51 2-5-2-7-2'),
  ],
  message: [
    p('M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719'),
  ],
  calendar: [
    p('M8 2v4'),
    p('M16 2v4'),
    { kind: 'rect', x: 3, y: 4, width: 18, height: 18, rx: 2 },
    p('M3 10h18'),
  ],
  refresh: [
    p('M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8'),
    p('M21 3v5h-5'),
    p('M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16'),
    p('M8 16H3v5'),
  ],
  info: [{ kind: 'circle', cx: 12, cy: 12, r: 10 }, p('M12 16v-4'), p('M12 8h.01')],
  star: [
    p('M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z'),
  ],
  search: [p('m21 21-4.34-4.34'), { kind: 'circle', cx: 11, cy: 11, r: 8 }],
  x: [p('M18 6 6 18'), p('m6 6 12 12')],
  check: [p('M20 6 9 17l-5-5')],
} satisfies Record<string, Shape[]>;

export type IconName = keyof typeof iconRegistry;
export const iconNames = Object.keys(iconRegistry) as IconName[];

export interface IconProps {
  icon: IconName;
  /** Box size in points (the design uses 22 in the tab bar, 14 in FavButton). */
  size?: number;
  color?: string;
  /** Fill closed shapes with `color` too (e.g. a solid heart). */
  filled?: boolean;
  strokeWidth?: number;
  style?: StyleProp<ViewStyle>;
}

export function Icon({ icon, size = 24, color = colors.text, filled = false, strokeWidth = 2, style }: IconProps) {
  const shapes: Shape[] = iconRegistry[icon];
  return (
    <View style={[{ width: size, height: size }, style]} pointerEvents="none">
      <Svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {shapes.map((s, i) => {
          const fill = s.kind !== 'rect' && (s.fill || filled) ? color : 'none';
          if (s.kind === 'path') return <Path key={i} d={s.d} fill={fill} />;
          if (s.kind === 'circle') return <Circle key={i} cx={s.cx} cy={s.cy} r={s.r} fill={fill} />;
          return <Rect key={i} x={s.x} y={s.y} width={s.width} height={s.height} rx={s.rx} />;
        })}
      </Svg>
    </View>
  );
}
