/**
 * React Navigation demo: bottom tabs hosting a stack navigator — the REAL
 * @react-navigation/native + bottom-tabs + stack packages, byte-untouched,
 * running on the canvas engine (Animated is the engine's implementation;
 * safe-area and react-native-screens resolve to compat shims via the preset.
 * At runtime these navigators probe screens through a CJS `require()` that
 * throws in the browser's ESM graph, so they still take their maintained
 * plain-View fallback path here, exactly as upstream does on web; the screens
 * shim serves graphs that import the package statically).
 */
import * as React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import type { StackScreenProps } from '@react-navigation/stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { colors, radii } from './tokens';

interface Place {
  id: string;
  name: string;
  region: string;
  tint: string;
  blurb: string;
}

const PLACES: Place[] = [
  { id: 'kyoto', name: 'Lorem ipsum', region: 'Lorem ipsum', tint: '#B45309', blurb: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore.' },
  { id: 'tromso', name: 'Lorem ipsum', region: 'Lorem ipsum', tint: '#0E7490', blurb: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore.' },
  { id: 'oaxaca', name: 'Lorem ipsum', region: 'Lorem ipsum', tint: '#86198F', blurb: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore.' },
  { id: 'hobart', name: 'Lorem ipsum', region: 'Lorem ipsum', tint: '#14532D', blurb: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore.' },
];

type ExploreStackParams = {
  Places: undefined;
  Place: { id: string };
};

const Tab = createBottomTabNavigator();
const ExploreStack = createStackNavigator<ExploreStackParams>();

function PlaceRow({ place, onPress }: { place: Place; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.subtlePressed }]}
    >
      <View style={[styles.rowDot, { backgroundColor: place.tint }]} />
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{place.name}</Text>
        <Text style={styles.rowSub}>{place.region}</Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

function PlacesScreen({ navigation }: StackScreenProps<ExploreStackParams, 'Places'>) {
  return (
    <View style={styles.screen}>
      {PLACES.map((p) => (
        <PlaceRow key={p.id} place={p} onPress={() => navigation.navigate('Place', { id: p.id })} />
      ))}
      <Text style={styles.hint}>Places worth the trip.</Text>
    </View>
  );
}

function PlaceScreen({ route }: StackScreenProps<ExploreStackParams, 'Place'>) {
  const place = PLACES.find((p) => p.id === route.params.id)!;
  return (
    <View style={styles.screen}>
      <View style={[styles.hero, { backgroundColor: place.tint }]}>
        <Text style={styles.heroTitle}>{place.name}</Text>
        <Text style={styles.heroSub}>{place.region}</Text>
      </View>
      <Text style={styles.body}>{place.blurb}</Text>
    </View>
  );
}

function ExploreTab() {
  return (
    <ExploreStack.Navigator
      screenOptions={{
        headerTintColor: colors.brand,
        headerTitleStyle: { color: colors.ink, fontWeight: '600' },
        headerStyle: { backgroundColor: colors.card },
        cardStyle: { backgroundColor: colors.subtle },
      }}
    >
      <ExploreStack.Screen name="Places" component={PlacesScreen} options={{ title: 'Explore' }} />
      <ExploreStack.Screen
        name="Place"
        component={PlaceScreen}
        options={({ route }) => ({ title: PLACES.find((p) => p.id === route.params.id)?.name ?? 'Place' })}
      />
    </ExploreStack.Navigator>
  );
}

function SavedScreen() {
  const [saved, setSaved] = React.useState<string[]>([]);
  const toggle = (id: string) =>
    setSaved((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  return (
    <View style={[styles.screen, { paddingTop: 24 }]}>
      <Text style={styles.sectionTitle}>Saved places</Text>
      <Text style={styles.body}>
        {saved.length === 0 ? 'Nothing saved yet — tap below.' : `${saved.length} saved. Switch tabs and back: this state survives.`}
      </Text>
      {PLACES.slice(0, 3).map((p) => (
        <Pressable
          key={p.id}
          onPress={() => toggle(p.id)}
          style={({ pressed }) => [styles.saveChip, saved.includes(p.id) && styles.saveChipOn, pressed && { opacity: 0.7 }]}
        >
          <Text style={[styles.saveChipText, saved.includes(p.id) && { color: colors.onBrand }]}>
            {saved.includes(p.id) ? '♥ ' : '♡ '}
            {p.name}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function ProfileScreen() {
  return (
    <View style={[styles.screen, { alignItems: 'center', paddingTop: 40 }]}>
      <View style={styles.avatar}>
        <Text style={styles.avatarInitials}>RY</Text>
      </View>
      <Text style={[styles.sectionTitle, { marginTop: 16 }]}>Ryan</Text>
      <Text style={styles.body}>Rendering native trees on a canvas since this morning.</Text>
    </View>
  );
}

/** Pure-View tab icons — no icon font, guaranteed glyphs. */
function TabIcon({ kind, color }: { kind: 'explore' | 'saved' | 'profile'; color: string }) {
  const base: StyleProp<ViewStyle> = { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' };
  if (kind === 'explore') {
    return (
      <View style={base}>
        <View style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: color }} />
      </View>
    );
  }
  if (kind === 'saved') {
    return (
      <View style={base}>
        <View style={{ width: 14, height: 14, backgroundColor: color, transform: [{ rotate: '45deg' }] }} />
      </View>
    );
  }
  return (
    <View style={base}>
      <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: color, marginBottom: 1 }} />
      <View style={{ width: 16, height: 8, borderTopLeftRadius: 8, borderTopRightRadius: 8, backgroundColor: color }} />
    </View>
  );
}

export function NavApp() {
  return (
    <SafeAreaProvider
      initialMetrics={{
        insets: { top: 59, bottom: 34, left: 0, right: 0 },
        frame: { x: 0, y: 0, width: 390, height: 720 },
      }}
    >
      <NavigationContainer>
        <Tab.Navigator
          screenOptions={{
            headerShown: false,
            tabBarActiveTintColor: colors.brand,
            tabBarInactiveTintColor: colors.muted,
            tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.line },
          }}
        >
          <Tab.Screen
            name="ExploreTab"
            component={ExploreTab}
            options={{ title: 'Explore', tabBarIcon: ({ color }) => <TabIcon kind="explore" color={color} /> }}
          />
          <Tab.Screen
            name="Saved"
            component={SavedScreen}
            options={{ tabBarIcon: ({ color }) => <TabIcon kind="saved" color={color} /> }}
          />
          <Tab.Screen
            name="Profile"
            component={ProfileScreen}
            options={{ tabBarIcon: ({ color }) => <TabIcon kind="profile" color={color} /> }}
          />
        </Tab.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.subtle, padding: 16, gap: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.card,
    borderRadius: radii.md,
    padding: 14,
  },
  rowDot: { width: 34, height: 34, borderRadius: 17 },
  rowTitle: { fontSize: 16, fontWeight: '600', color: colors.ink },
  rowSub: { fontSize: 13, color: colors.muted },
  chevron: { fontSize: 22, color: colors.muted },
  hint: { fontSize: 12.5, color: colors.muted, marginTop: 8, lineHeight: 18 },
  hero: { borderRadius: radii.md, padding: 20, paddingTop: 28 },
  heroTitle: { fontSize: 28, fontWeight: '700', color: colors.onBrand },
  heroSub: { fontSize: 14, color: colors.onBrand, opacity: 0.85 },
  body: { fontSize: 14.5, lineHeight: 21, color: colors.body },
  sectionTitle: { fontSize: 20, fontWeight: '700', color: colors.ink },
  saveChip: {
    backgroundColor: colors.card,
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignSelf: 'flex-start',
  },
  saveChipOn: { backgroundColor: colors.brand },
  saveChipText: { fontSize: 14.5, fontWeight: '600', color: colors.ink },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: { color: colors.onBrand, fontSize: 24, fontWeight: '700' },
});
