// React Native trees painted on the exploded layer planes. They use the real
// ignite-demo components; where the design splits one component across two
// planes (the EpisodeCard body vs. its FavButton) the card body is assembled
// from the same Text / Image / theme the EpisodeCard uses.
import {
  FavButton,
  Heading,
  IgniteFontGate,
  Screen,
  StatusBar,
  TabBar,
  Text,
  Toggle,
  colors,
  episodeMeta,
  episodes,
  radii,
} from 'ignite-demo';
import type { TabName } from 'ignite-demo';
import { useState, type ReactNode } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';

/** Transparent, font-gated root (the plane under it shows through). */
export function Layer({ children, pad = 0, align = 'flex-start' }: { children: ReactNode; pad?: number; align?: 'flex-start' | 'center' }) {
  return (
    <IgniteFontGate>
      <View style={[styles.root, { padding: pad, alignItems: align }]}>{children}</View>
    </IgniteFontGate>
  );
}

export function LayerHeading({ color }: { color?: string }) {
  return <Heading style={color ? { color } : undefined} />;
}

export function LayerToggle({ labelColor }: { labelColor?: string }) {
  const [on, setOn] = useState(false);
  return (
    <View style={styles.toggleRow}>
      <Text weight="medium" style={[styles.toggleLabel, labelColor ? { color: labelColor } : null]} text="Only Show Favorites" />
      <Toggle variant="switch" value={on} onValueChange={setOn} />
    </View>
  );
}

export function LayerFavButton({ favorited }: { favorited?: boolean }) {
  const [fav, setFav] = useState(!!favorited);
  return <FavButton isFavorite={fav} onPress={() => setFav((f) => !f)} />;
}

/** EpisodeCard without its FavButton (that floats on the buttons plane). */
export function LayerCardBody({ index }: { index: number }) {
  const ep = episodes[index] ?? episodes[0]!;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={ep.title} style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}>
      <View style={styles.cardContent}>
        <Text preset="meta" text={episodeMeta(ep)} />
        <Text preset="title" text={ep.title} />
      </View>
      <Image source={{ uri: ep.cover }} style={styles.cover} />
    </Pressable>
  );
}

export function LayerTabBar() {
  const [active, setActive] = useState<TabName>('Podcasts');
  return <TabBar active={active} onTabPress={setActive} />;
}

/** The bare screen sheet: Screen + the in-app status bar, nothing on it. */
export function LayerScreen() {
  return (
    <Screen preset="fixed">
      <StatusBar />
    </Screen>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.transparent, justifyContent: 'flex-start' },
  toggleRow: { width: 272, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  toggleLabel: { fontSize: 15, lineHeight: 19, marginBottom: 2 },
  card: {
    width: 272,
    height: 96,
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
  cardPressed: { backgroundColor: colors.palette.neutral200, borderColor: colors.palette.neutral400, transform: [{ scale: 0.98 }] },
  cardContent: { flex: 1, gap: 6 },
  cover: { width: 64, height: 64, borderRadius: 32 },
});
