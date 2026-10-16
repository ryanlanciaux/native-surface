import * as React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { colors } from '../theme';
import { Icon } from './Icon';
import type { IconName } from './Icon';
import { Text } from './Text';

export type TabName = 'Components' | 'Community' | 'Podcasts' | 'Debug';

export interface TabItem {
  name: TabName;
  icon: IconName;
}

export const tabs: TabItem[] = [
  { name: 'Components', icon: 'component' },
  { name: 'Community', icon: 'users' },
  { name: 'Podcasts', icon: 'podcast' },
  { name: 'Debug', icon: 'bug' },
];

export interface TabBarProps {
  active?: TabName;
  onTabPress?: (name: TabName) => void;
  /** Bottom padding (home indicator); the design uses 24. */
  bottomInset?: number;
  style?: StyleProp<ViewStyle>;
}

/** Ignite/TabBar (320 wide in the design): icons above labels, active tab in the tint. */
export function TabBar({ active = 'Podcasts', onTabPress, bottomInset = 24, style }: TabBarProps) {
  return (
    <View accessibilityRole="tablist" style={[styles.bar, { paddingBottom: bottomInset }, style]}>
      {tabs.map((tab) => {
        const focused = tab.name === active;
        const color = focused ? colors.tint : colors.text;
        return (
          <Pressable
            key={tab.name}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={tab.name}
            onPress={() => onTabPress?.(tab.name)}
            style={({ pressed }) => [styles.tab, pressed && styles.tabPressed]}
          >
            <Icon icon={tab.icon} size={22} color={color} />
            <Text weight="medium" style={[styles.label, { color }]} text={tab.name} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    paddingTop: 10,
    paddingHorizontal: 8,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  tab: { flex: 1, alignItems: 'center', gap: 4 },
  tabPressed: { opacity: 0.6 },
  label: { fontSize: 11, lineHeight: 14 },
});
