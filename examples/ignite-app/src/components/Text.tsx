import * as React from 'react';
import { Text as RNText } from 'react-native';
import type { StyleProp, TextProps as RNTextProps, TextStyle } from 'react-native';
import { colors, typography } from '../theme';

export const sizes = {
  xxl: { fontSize: 36, lineHeight: 44 },
  xl: { fontSize: 30, lineHeight: 33.6 },
  lg: { fontSize: 20, lineHeight: 26 },
  md: { fontSize: 15, lineHeight: 20 },
  sm: { fontSize: 13, lineHeight: 18 },
  xs: { fontSize: 11, lineHeight: 14 },
} satisfies Record<string, TextStyle>;

export type TextSize = keyof typeof sizes;
export type TextWeight = keyof typeof typography.weights;

const base: TextStyle = {
  fontFamily: typography.family,
  fontWeight: typography.weights.normal,
  color: colors.text,
  ...sizes.md,
};

export const textPresets = {
  default: base,
  bold: { ...base, fontWeight: typography.weights.bold },
  /** Ignite/Heading: Space Grotesk Bold 30 / 112%, letter-spacing -0.4. */
  heading: { ...base, ...sizes.xl, fontWeight: typography.weights.bold, letterSpacing: -0.4 },
  subheading: { ...base, ...sizes.lg, fontWeight: typography.weights.semiBold },
  /** Episode card title: 15 / 600, line-height 125%. */
  title: { ...base, fontSize: 15, lineHeight: 18.75, fontWeight: typography.weights.semiBold },
  /** Episode meta (date · duration): 11 regular, dim. */
  meta: { ...base, fontSize: 11, lineHeight: 14, color: colors.textDim },
  formLabel: { ...base, fontWeight: typography.weights.medium },
  formHelper: { ...base, ...sizes.sm, color: colors.textDim },
} satisfies Record<string, TextStyle>;

export type TextPreset = keyof typeof textPresets;

export interface TextProps extends RNTextProps {
  /** Text content; children win when both are given. */
  text?: string;
  preset?: TextPreset;
  weight?: TextWeight;
  size?: TextSize;
  style?: StyleProp<TextStyle>;
  children?: React.ReactNode;
}

/** Ignite's Text: presets + weight/size overrides over the theme font. */
export function Text({ text, preset = 'default', weight, size, style, children, ...rest }: TextProps) {
  return (
    <RNText
      {...rest}
      style={[
        textPresets[preset],
        size ? sizes[size] : null,
        weight ? { fontWeight: typography.weights[weight] } : null,
        style,
      ]}
    >
      {children ?? text}
    </RNText>
  );
}
