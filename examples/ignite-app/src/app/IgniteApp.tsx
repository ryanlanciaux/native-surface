import * as React from 'react';
import { StyleSheet, View, useSurfaceInsets } from 'react-native';
import { StatusBar, TabBar } from '../components';
import type { TabName } from '../components';
import { episodes as defaultEpisodes, initialFavorites as defaultFavorites } from '../data/episodes';
import type { Episode } from '../data/episodes';
import { IgniteFontGate } from '../fonts';
import { colors } from '../theme';
import { ComponentsScreen } from './screens/ComponentsScreen';
import { CommunityScreen } from './screens/CommunityScreen';
import { DebugScreen } from './screens/DebugScreen';
import { PodcastsScreen } from './screens/PodcastsScreen';

export interface IgniteAppProps {
  /**
   * Draw the 50pt "9:41" status bar inside the app. Off by default: a host
   * that draws its own bezel/status bar declares `safeAreaInsets.top` on the
   * NativeSurface instead and the app pads by it.
   */
  showStatusBar?: boolean;
  /** Draw the dynamic island in the in-app status bar. */
  showIsland?: boolean;
  initialTab?: TabName;
  onTabChange?: (tab: TabName) => void;
  episodes?: Episode[];
  initialFavorites?: readonly string[];
  /** Fires after a Like/Unlike with the episode and its new state. */
  onPressFavorite?: (episode: Episode, isFavorite: boolean) => void;
}

/** The Ignite demo app: Components / Community / Podcasts / Debug tabs. */
export function IgniteApp(props: IgniteAppProps) {
  return (
    <IgniteFontGate>
      <IgniteAppInner {...props} />
    </IgniteFontGate>
  );
}

function IgniteAppInner({
  showStatusBar: showStatusBarProp = false,
  showIsland = true,
  initialTab = 'Podcasts',
  onTabChange,
  episodes = defaultEpisodes,
  initialFavorites = defaultFavorites,
  onPressFavorite,
}: IgniteAppProps) {
  const insets = useSurfaceInsets();
  const [tab, setTab] = React.useState<TabName>(initialTab);
  const [favorites, setFavorites] = React.useState<ReadonlySet<string>>(() => new Set(initialFavorites));
  const [favoritesOnly, setFavoritesOnly] = React.useState(false);
  const [showStatusBar, setShowStatusBar] = React.useState(showStatusBarProp);
  React.useEffect(() => setShowStatusBar(showStatusBarProp), [showStatusBarProp]);

  const selectTab = (next: TabName) => {
    setTab(next);
    onTabChange?.(next);
  };

  // Taps can land several per frame (scripted demos, automation), so each
  // update builds on the latest set rather than the one from the last render.
  const latestFavorites = React.useRef(favorites);
  const updateFavorites = (update: (prev: ReadonlySet<string>) => ReadonlySet<string>) => {
    latestFavorites.current = update(latestFavorites.current);
    setFavorites(latestFavorites.current);
  };

  const toggleFavorite = (episode: Episode) => {
    const nowFavorite = !latestFavorites.current.has(episode.guid);
    updateFavorites((prev) => {
      const next = new Set(prev);
      if (nowFavorite) next.add(episode.guid);
      else next.delete(episode.guid);
      return next;
    });
    onPressFavorite?.(episode, nowFavorite);
  };

  let screen: React.ReactNode;
  if (tab === 'Podcasts') {
    screen = (
      <PodcastsScreen
        episodes={episodes}
        favorites={favorites}
        onToggleFavorite={toggleFavorite}
        favoritesOnly={favoritesOnly}
        onFavoritesOnlyChange={setFavoritesOnly}
      />
    );
  } else if (tab === 'Components') {
    screen = <ComponentsScreen />;
  } else if (tab === 'Community') {
    screen = <CommunityScreen />;
  } else {
    screen = (
      <DebugScreen
        favoritesCount={favorites.size}
        episodesCount={episodes.length}
        onResetFavorites={() => updateFavorites(() => new Set(initialFavorites))}
        onFavoriteAll={() => updateFavorites(() => new Set(episodes.map((e) => e.guid)))}
        showStatusBar={showStatusBar}
        onShowStatusBarChange={setShowStatusBar}
      />
    );
  }

  return (
    <View style={styles.app}>
      {showStatusBar ? <StatusBar showIsland={showIsland} /> : <View style={{ height: insets.top }} />}
      <View style={styles.body}>{screen}</View>
      <TabBar active={tab} onTabPress={selectTab} bottomInset={Math.max(24, insets.bottom)} />
    </View>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: colors.background },
  body: { flex: 1 },
});
