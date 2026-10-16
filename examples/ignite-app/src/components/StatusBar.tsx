import * as React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, device } from '../theme';
import { Icon } from './Icon';
import { Text } from './Text';

export interface StatusBarProps {
  time?: string;
  /** Draw the dynamic island pill (off when a host bezel already draws one). */
  showIsland?: boolean;
}

/** The design's 50pt iOS status bar: "9:41", dynamic island, signal/wifi/battery. */
export function StatusBar({ time = '9:41', showIsland = true }: StatusBarProps) {
  return (
    <View style={styles.bar}>
      <Text weight="semiBold" style={styles.time} text={time} />
      <View style={[styles.island, !showIsland && styles.islandHidden]} />
      <View style={styles.indicators}>
        <Icon icon="signal" size={15} />
        <Icon icon="wifi" size={15} />
        <Icon icon="battery" size={15} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: device.statusBarHeight,
    paddingHorizontal: 28,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  time: { fontSize: 14, lineHeight: 18 },
  island: { width: 96, height: 28, borderRadius: 14, backgroundColor: colors.palette.neutral900 },
  islandHidden: { backgroundColor: colors.transparent },
  indicators: { flexDirection: 'row', alignItems: 'center', gap: 5 },
});
