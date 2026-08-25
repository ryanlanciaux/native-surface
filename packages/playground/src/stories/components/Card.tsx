import { Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import type { TextStyle, ViewStyle } from 'react-native';

export interface CardProps {
  name: string;
  role: string;
  body: string;
  avatarUri: string;
  followers: number;
  elevated?: boolean;
  verified?: boolean;
  onPressFollow?: () => void;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 16,
    marginTop: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
  },
  shadow: {
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 14,
    elevation: 6,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#e2e8f0' },
  identity: { flexShrink: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { fontSize: 16, fontWeight: '600', color: '#0f172a' },
  check: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#2563eb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkMark: { color: '#ffffff', fontSize: 10, fontWeight: '700', lineHeight: 16 },
  role: { fontSize: 13, color: '#64748b', marginTop: 2 },
  body: { fontSize: 14, lineHeight: 21, color: '#334155', marginTop: 12 },
  strong: { fontWeight: '700', color: '#0f172a' },
  muted: { color: '#94a3b8' },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
  },
  followers: { fontSize: 13, color: '#64748b' },
  follow: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: '#0f172a',
  },
  followPressed: { backgroundColor: '#334155' },
  followLabel: { color: '#ffffff', fontSize: 13, fontWeight: '600' },
} satisfies Record<string, ViewStyle | TextStyle>);

export function Card(props: CardProps): React.JSX.Element {
  const { name, role, body, avatarUri, followers, elevated = true, verified = true, onPressFollow } = props;
  const radius = Platform.select({ ios: 16, android: 8 }) ?? 16;

  return (
    <View style={[styles.card, { borderRadius: radius }, elevated && styles.shadow]}>
      <View style={styles.header}>
        <Image source={{ uri: avatarUri }} style={styles.avatar} resizeMode="cover" />
        <View style={styles.identity}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>
              {name}
            </Text>
            {verified ? (
              <View style={styles.check}>
                <Text style={styles.checkMark}>✓</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.role} numberOfLines={1}>
            {role}
          </Text>
        </View>
      </View>

      <Text style={styles.body}>
        {body} <Text style={styles.strong}>Yoga</Text> handles layout,{' '}
        <Text style={styles.strong}>Skia</Text> paints. <Text style={styles.muted}>No DOM inside.</Text>
      </Text>

      <View style={styles.footer}>
        <Text style={styles.followers}>
          <Text style={styles.strong}>{followers.toLocaleString('en-US')}</Text> followers
        </Text>
        <Pressable
          onPress={onPressFollow}
          style={({ pressed }) => [styles.follow, pressed && styles.followPressed]}
        >
          <Text style={styles.followLabel}>Follow</Text>
        </Pressable>
      </View>
    </View>
  );
}
