import * as React from 'react';
import { ScrollView, StyleSheet, View, useSurfaceInsets } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { colors } from '../theme';

export type ScreenPreset = 'scroll' | 'fixed';
export type SafeAreaEdge = 'top' | 'bottom' | 'left' | 'right';

export interface ScreenProps {
  preset?: ScreenPreset;
  /** Edges that pad by the surface's safe-area insets. */
  safeAreaEdges?: SafeAreaEdge[];
  backgroundColor?: string;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

/**
 * Ignite's Screen: a full-bleed container, scrolling (`preset="scroll"`) or
 * fixed, padded by the safe-area insets the host surface declares.
 */
export function Screen({
  preset = 'scroll',
  safeAreaEdges = [],
  backgroundColor = colors.background,
  style,
  contentContainerStyle,
  children,
}: ScreenProps) {
  const insets = useSurfaceInsets();
  const inset: ViewStyle = {};
  for (const edge of safeAreaEdges) {
    if (edge === 'top') inset.paddingTop = insets.top;
    if (edge === 'bottom') inset.paddingBottom = insets.bottom;
    if (edge === 'left') inset.paddingLeft = insets.left;
    if (edge === 'right') inset.paddingRight = insets.right;
  }
  return (
    <View style={[styles.outer, { backgroundColor }, inset, style]}>
      {preset === 'scroll' ? (
        <ScrollView style={styles.fill} contentContainerStyle={contentContainerStyle} showsVerticalScrollIndicator={false}>
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.fill, contentContainerStyle]}>{children}</View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { flex: 1 },
  fill: { flex: 1 },
});
