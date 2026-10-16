import * as React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import type { StyleProp, TextStyle, ViewStyle } from 'react-native';
import { colors } from '../theme';
import { Icon } from './Icon';
import type { IconName } from './Icon';
import { Text } from './Text';

export type ButtonPreset = 'default' | 'filled' | 'reversed';

export interface ButtonProps {
  text?: string;
  preset?: ButtonPreset;
  onPress?: () => void;
  disabled?: boolean;
  /** Icon drawn left of the label. */
  leftIcon?: IconName;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  children?: React.ReactNode;
}

const presetStyles: Record<ButtonPreset, { view: ViewStyle; pressed: ViewStyle; text: string }> = {
  default: {
    view: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
    pressed: { backgroundColor: colors.background },
    text: colors.text,
  },
  filled: {
    view: { backgroundColor: colors.tint },
    pressed: { backgroundColor: colors.palette.primary600 },
    text: colors.surface,
  },
  reversed: {
    view: { backgroundColor: colors.text },
    pressed: { backgroundColor: colors.palette.neutral700 },
    text: colors.surface,
  },
};

/** Ignite's Button: default (outlined), filled (tint) and reversed (dark). */
export function Button({ text = 'Button', preset = 'default', onPress, disabled, leftIcon, style, textStyle, children }: ButtonProps) {
  const p = presetStyles[preset];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.base, p.view, pressed && p.pressed, disabled && styles.disabled, style]}
    >
      {leftIcon ? <Icon icon={leftIcon} size={18} color={p.text} /> : null}
      {children ?? <Text weight="medium" style={[styles.text, { color: p.text }, textStyle]} text={text} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 48,
    borderRadius: 24,
    paddingHorizontal: 20,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  disabled: { opacity: 0.5 },
  text: { fontSize: 15, lineHeight: 20, textAlign: 'center' },
});
