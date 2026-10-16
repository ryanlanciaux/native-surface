import * as React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { colors, radii } from '../theme';
import { Icon } from './Icon';
import { Text } from './Text';

export interface FavButtonProps {
  /** Favorited: tinted pill reading "Unlike". */
  isFavorite?: boolean;
  onPress?: () => void;
  /** Override the label (defaults to Like / Unlike). */
  label?: string;
  style?: StyleProp<ViewStyle>;
}

/** Ignite/FavButton: 32-high pill, 14px heart + label, tinted when favorited. */
export function FavButton({ isFavorite = false, onPress, label, style }: FavButtonProps) {
  const tint = isFavorite ? colors.tint : colors.text;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: isFavorite }}
      accessibilityLabel={isFavorite ? 'Unfavorite' : 'Favorite'}
      hitSlop={6}
      style={({ pressed }) => [
        styles.pill,
        isFavorite && styles.favorited,
        pressed && (isFavorite ? styles.favoritedPressed : styles.pressed),
        style,
      ]}
    >
      <Icon icon="heart" size={14} color={tint} />
      <Text
        weight="medium"
        style={[styles.label, { color: isFavorite ? colors.tintText : colors.text }]}
        text={label ?? (isFavorite ? 'Unlike' : 'Like')}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 32,
    paddingHorizontal: 13, // 14 in the design, which includes the 1px stroke
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  favorited: { backgroundColor: colors.tintSubtle, borderColor: colors.tintBorder },
  pressed: { backgroundColor: colors.background },
  favoritedPressed: { backgroundColor: colors.palette.primary200 },
  label: { fontSize: 13, lineHeight: 16 },
});
