import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { TextStyle, ViewStyle } from 'react-native';
import { Button } from './Button';
import { colors, radii } from './tokens';

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
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>LI</Text>
        </View>
        <View style={styles.identity}>
          <Text style={styles.name} numberOfLines={1}>
            Lorem Ipsum
          </Text>
          <Text style={styles.handle} numberOfLines={1}>
            @lorem · Dolor Sit Amet
          </Text>
        </View>
      </View>

      <Text style={styles.bio} numberOfLines={2}>
        Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor
        incididunt ut labore et dolore magna aliqua.
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
  avatar: ViewStyle;
  avatarText: TextStyle;
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
    backgroundColor: '#4F46E5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 18, fontWeight: '700', color: colors.onBrand },
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
