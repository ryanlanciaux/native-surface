import * as React from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { episodeMeta } from '../data/episodes';
import type { Episode } from '../data/episodes';
import { colors, radii } from '../theme';
import { FavButton } from './FavButton';
import { Text } from './Text';

export interface EpisodeCardProps {
  episode: Pick<Episode, 'guid' | 'title' | 'pubDate' | 'duration' | 'cover'>;
  isFavorite?: boolean;
  onPressFavorite?: (episode: EpisodeCardProps['episode']) => void;
  /** Tapping the card body (not the FavButton). */
  onPress?: (episode: EpisodeCardProps['episode']) => void;
  /** Force the pressed look (catalog "pressed" state). */
  pressed?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * Ignite/EpisodeCard (272 wide in the design): date · duration, title and the
 * FavButton on the left, 64px circular cover on the right.
 */
export function EpisodeCard({ episode, isFavorite = false, onPressFavorite, onPress, pressed: forcePressed, style }: EpisodeCardProps) {
  return (
    <Pressable
      onPress={onPress ? () => onPress(episode) : undefined}
      accessibilityRole="button"
      accessibilityLabel={episode.title}
      style={({ pressed }) => [styles.card, (pressed || forcePressed) && styles.cardPressed, style]}
    >
      <View style={styles.content}>
        <Text preset="meta" text={episodeMeta(episode)} />
        <Text preset="title" text={episode.title} />
        <View style={styles.gap} />
        <FavButton isFavorite={isFavorite} onPress={() => onPressFavorite?.(episode)} />
      </View>
      <Image source={{ uri: episode.cover }} style={styles.cover} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    gap: 12,
    // The design's 14 includes its 1px stroke (pen strokes take no layout
    // space; RN borders do).
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
  cardPressed: {
    backgroundColor: colors.palette.neutral200,
    borderColor: colors.palette.neutral400,
    transform: [{ scale: 0.98 }],
  },
  content: { flex: 1, gap: 6 },
  gap: { width: 4, height: 4 },
  cover: { width: 64, height: 64, borderRadius: 32 },
});
