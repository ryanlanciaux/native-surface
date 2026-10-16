import * as React from 'react';
import { Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Button, Heading, ListItem, Screen, Text, Toggle } from '../../components';

export interface DebugScreenProps {
  favoritesCount: number;
  episodesCount: number;
  onResetFavorites: () => void;
  onFavoriteAll: () => void;
  showStatusBar: boolean;
  onShowStatusBarChange: (value: boolean) => void;
}

/** Runtime facts about the surface plus a few state controls. */
export function DebugScreen(props: DebugScreenProps) {
  const { width, height } = useWindowDimensions();
  return (
    <Screen preset="scroll" contentContainerStyle={styles.content}>
      <Heading text="Debug" />
      <View>
        <ListItem text="Platform" leftIcon="info" value={Platform.OS} topSeparator />
        <ListItem text="Window" leftIcon="search" value={`${Math.round(width)} × ${Math.round(height)}`} />
        <ListItem text="Renderer" leftIcon="component" value="Yoga + Skia" />
        <ListItem text="Favorites" leftIcon="heart" value={`${props.favoritesCount} / ${props.episodesCount}`} />
      </View>
      <Toggle variant="switch" label="Show status bar" value={props.showStatusBar} onValueChange={props.onShowStatusBarChange} />
      <View style={styles.buttons}>
        <Button text="Reset favorites" leftIcon="refresh" onPress={props.onResetFavorites} />
        <Button preset="filled" text="Favorite all" leftIcon="heart" onPress={props.onFavoriteAll} />
      </View>
      <Text preset="formHelper" text="Running real React Native components on a canvas via native-surface." style={styles.note} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: 10, paddingHorizontal: 24, paddingBottom: 32, gap: 18 },
  buttons: { gap: 10 },
  note: { textAlign: 'center' },
});
