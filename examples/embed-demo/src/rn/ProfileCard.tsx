import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import type { ImageStyle, TextStyle, ViewStyle } from 'react-native';
import { Button } from './Button';
import { colors, radii } from './tokens';

/** Remote, CORS-enabled avatar: fetched and decoded by CanvasKit, not by an <img>. */
const AVATAR_URI =
  'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=160&h=160&fit=crop&crop=faces&auto=format';

const stats = [
  { label: 'Followers', value: '12.4k' },
  { label: 'Following', value: '312' },
  { label: 'Repos', value: '27' },
];

export function ProfileCard() {
  const [following, setFollowing] = useState(false);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        {/* backgroundColor shows through as a placeholder until the bytes decode */}
        <Image source={{ uri: AVATAR_URI }} style={styles.avatar} resizeMode="cover" />
        <View style={styles.identity}>
          <Text style={styles.name} numberOfLines={1}>
            Ada Lovelace
          </Text>
          <Text style={styles.handle} numberOfLines={1}>
            @ada · Analytical Engine, London
          </Text>
        </View>
      </View>

      <Text style={styles.bio} numberOfLines={2}>
        Writing the first algorithm intended for a machine. Currently thinking about how
        Bernoulli numbers fall out of punched cards.
      </Text>

      <View style={styles.stats}>
        {stats.map((stat) => (
          <View key={stat.label}>
            <Text style={styles.statValue}>{stat.value}</Text>
            <Text style={styles.statLabel}>{stat.label}</Text>
          </View>
        ))}
      </View>

      <View style={styles.actions}>
        <Button
          label={following ? 'Following' : 'Follow'}
          variant={following ? 'secondary' : 'primary'}
          size="sm"
          onPress={() => setFollowing((v) => !v)}
          style={styles.action}
        />
        <Button label="Message" variant="secondary" size="sm" style={styles.action} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create<{
  root: ViewStyle;
  header: ViewStyle;
  avatar: ImageStyle;
  identity: ViewStyle;
  name: TextStyle;
  handle: TextStyle;
  bio: TextStyle;
  stats: ViewStyle;
  statValue: TextStyle;
  statLabel: TextStyle;
  actions: ViewStyle;
  action: ViewStyle;
}>({
  root: { flex: 1, backgroundColor: colors.card, padding: 15 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: radii.pill,
    backgroundColor: colors.avatarPlaceholder,
  },
  identity: { flex: 1 },
  name: { fontSize: 17, fontWeight: '700', color: colors.ink, letterSpacing: -0.2 },
  handle: { marginTop: 2, fontSize: 12, color: colors.muted },
  bio: { marginTop: 10, fontSize: 13, lineHeight: 18, color: colors.body },
  stats: { flexDirection: 'row', marginTop: 10, gap: 24 },
  statValue: { fontSize: 15, fontWeight: '700', color: colors.ink },
  statLabel: { marginTop: 1, fontSize: 11, color: colors.muted },
  actions: { flexDirection: 'row', marginTop: 12, gap: 10 },
  action: { flex: 1 },
});
