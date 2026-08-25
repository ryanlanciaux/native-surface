import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { TextStyle, ViewStyle } from 'react-native';

export interface FeedItemProps {
  author: string;
  message: string;
  time: string;
  avatarUri?: string;
  unread?: boolean;
  onPress?: (author: string) => void;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#ffffff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#e2e8f0',
  },
  rowPressed: { backgroundColor: '#f1f5f9' },
  rowUnread: { backgroundColor: '#f8fbff' },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#e2e8f0' },
  avatarFallback: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#dbeafe',
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: { color: '#1d4ed8', fontWeight: '700', fontSize: 16 },
  content: { flex: 1, gap: 3 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  author: { fontSize: 14, fontWeight: '600', color: '#0f172a', flexShrink: 1 },
  time: { fontSize: 12, color: '#94a3b8', marginLeft: 'auto' },
  message: { fontSize: 13, lineHeight: 19, color: '#475569' },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#2563eb' },
} satisfies Record<string, ViewStyle | TextStyle>);

export function FeedItem(props: FeedItemProps): React.JSX.Element {
  const { author, message, time, avatarUri, unread = false, onPress } = props;
  return (
    <Pressable
      onPress={() => onPress?.(author)}
      style={({ pressed }) => [styles.row, unread && styles.rowUnread, pressed && styles.rowPressed]}
    >
      {avatarUri ? (
        <Image source={{ uri: avatarUri }} style={styles.avatar} resizeMode="cover" />
      ) : (
        <View style={styles.avatarFallback}>
          <Text style={styles.initial}>{author.slice(0, 1)}</Text>
        </View>
      )}
      <View style={styles.content}>
        <View style={styles.head}>
          {unread ? <View style={styles.dot} /> : null}
          <Text style={styles.author} numberOfLines={1}>
            {author}
          </Text>
          <Text style={styles.time}>{time}</Text>
        </View>
        <Text style={styles.message} numberOfLines={2}>
          {message}
        </Text>
      </View>
    </Pressable>
  );
}
