import * as React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, EpisodeCard, Heading, Screen, Text, Toggle } from '../../components';
import type { Episode } from '../../data/episodes';
import { colors, radii } from '../../theme';

export interface PodcastsScreenProps {
  episodes: Episode[];
  favorites: ReadonlySet<string>;
  onToggleFavorite: (episode: Episode) => void;
  favoritesOnly: boolean;
  onFavoritesOnlyChange: (value: boolean) => void;
}

/** Design 03: heading, "Only Show Favorites" filter, episode cards. */
export function PodcastsScreen({ episodes, favorites, onToggleFavorite, favoritesOnly, onFavoritesOnlyChange }: PodcastsScreenProps) {
  const visible = favoritesOnly ? episodes.filter((e) => favorites.has(e.guid)) : episodes;
  return (
    <Screen preset="scroll" contentContainerStyle={styles.content}>
      <Heading text="React Native Radio episodes" />
      <Toggle variant="switch" label="Only Show Favorites" value={favoritesOnly} onValueChange={onFavoritesOnlyChange} />
      <View style={styles.list}>
        {visible.map((episode) => (
          <EpisodeCard
            key={episode.guid}
            episode={episode}
            isFavorite={favorites.has(episode.guid)}
            onPressFavorite={() => onToggleFavorite(episode)}
          />
        ))}
        {visible.length === 0 ? (
          <View style={styles.empty}>
            <Text preset="subheading" text="No favorites yet" />
            <Text preset="formHelper" text="Tap Like on an episode to keep it here." style={styles.emptyHelp} />
            <Button text="Show all episodes" onPress={() => onFavoritesOnlyChange(false)} />
          </View>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: 10, paddingHorizontal: 24, paddingBottom: 24, gap: 18 },
  list: { gap: 14 },
  empty: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 32,
    paddingHorizontal: 16,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  emptyHelp: { textAlign: 'center', marginBottom: 8 },
});
