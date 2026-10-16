import * as React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { colors } from '../theme';
import { Icon } from './Icon';
import type { IconName } from './Icon';
import { Text } from './Text';

export interface HeaderProps {
  title?: string;
  leftIcon?: IconName;
  onLeftPress?: () => void;
  rightIcon?: IconName;
  onRightPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

/** Ignite's Header: 56pt bar, centered title, optional left/right actions. */
export function Header({ title, leftIcon, onLeftPress, rightIcon, onRightPress, style }: HeaderProps) {
  return (
    <View style={[styles.bar, style]}>
      <Action icon={leftIcon} onPress={onLeftPress} />
      <Text weight="semiBold" style={styles.title} text={title} numberOfLines={1} accessibilityRole="header" />
      <Action icon={rightIcon} onPress={onRightPress} />
    </View>
  );
}

function Action({ icon, onPress }: { icon?: IconName; onPress?: () => void }) {
  if (!icon) return <View style={styles.action} />;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
      <Icon icon={icon} size={22} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: { height: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, backgroundColor: colors.background },
  title: { flex: 1, textAlign: 'center', fontSize: 17, lineHeight: 22 },
  action: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20 },
  pressed: { backgroundColor: colors.border },
});
