import * as React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { colors } from '../theme';
import { Icon } from './Icon';
import type { IconName } from './Icon';
import { Text } from './Text';

export interface ListItemProps {
  text: string;
  leftIcon?: IconName;
  /** Defaults to a caret when onPress is set. */
  rightIcon?: IconName;
  /** Secondary text right-aligned before the icon. */
  value?: string;
  topSeparator?: boolean;
  bottomSeparator?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

/** Ignite's ListItem: 56pt row, optional icons, value and separators. */
export function ListItem({ text, leftIcon, rightIcon, value, topSeparator, bottomSeparator = true, onPress, style }: ListItemProps) {
  const right = rightIcon ?? (onPress ? 'caretRight' : undefined);
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [
        styles.row,
        topSeparator && styles.top,
        bottomSeparator && styles.bottom,
        pressed && styles.pressed,
        style,
      ]}
    >
      {leftIcon ? <Icon icon={leftIcon} size={20} /> : null}
      <Text style={styles.text} text={text} numberOfLines={1} />
      {value ? <Text preset="formHelper" text={value} /> : null}
      {right ? <Icon icon={right} size={18} color={colors.textDim} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  top: { borderTopWidth: 1, borderColor: colors.separator },
  bottom: { borderBottomWidth: 1, borderColor: colors.separator },
  pressed: { opacity: 0.6 },
  text: { flex: 1 },
});
