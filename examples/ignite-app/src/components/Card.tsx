import * as React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { colors, radii } from '../theme';
import { Text } from './Text';

export interface CardProps {
  heading?: string;
  content?: string;
  footer?: string;
  /** Element drawn right of the text column. */
  right?: React.ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

/** Ignite's Card: heading / content / footer slots on the episode-card surface. */
export function Card({ heading, content, footer, right, onPress, style, children }: CardProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed, style]}
    >
      <View style={styles.column}>
        {heading ? <Text preset="title" text={heading} /> : null}
        {content ? <Text size="sm" text={content} style={styles.content} /> : null}
        {children}
        {footer ? <Text preset="meta" text={footer} /> : null}
      </View>
      {right}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    gap: 12,
    padding: 13,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    shadowColor: colors.shadow,
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 8 },
  },
  pressed: { backgroundColor: colors.background },
  column: { flex: 1, gap: 6 },
  content: { color: colors.textDim },
});
