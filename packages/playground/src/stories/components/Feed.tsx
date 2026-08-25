import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ScrollEvent, TextStyle, ViewStyle } from 'react-native';
import { FeedItem } from './FeedItem';

export interface FeedProps {
  count: number;
  avatars?: string[];
  showAvatars?: boolean;
  unreadEvery?: number;
  scrollEnabled?: boolean;
  showsVerticalScrollIndicator?: boolean;
  onScroll?: (event: ScrollEvent) => void;
  onPressItem?: (author: string) => void;
}

const AUTHORS = [
  'Ada Lovelace',
  'Grace Hopper',
  'Alan Turing',
  'Katherine Johnson',
  'Barbara Liskov',
  'Donald Knuth',
];

const MESSAGES = [
  'Pushed the Yoga measure-function cache — text layout is one pass per paragraph now.',
  'Skia paints the whole display list in a single traversal; no per-node canvas state churn.',
  'Hit-testing walks the retained tree in reverse paint order, so overlays win taps.',
  'flexWrap + gap match the on-device numbers to the pixel on every fixture I tried.',
  'Shadows are outset-only for v1 — inset needs a second blur pass we do not need yet.',
  'Fling it — real momentum with iOS deceleration, rubber-band edges, and bounce-back.',
];

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f8fafc' },
  header: {
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 12,
    backgroundColor: '#ffffff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#e2e8f0',
  },
  title: { fontSize: 22, fontWeight: '700', color: '#0f172a' },
  subtitle: { fontSize: 13, color: '#64748b', marginTop: 2 },
  list: { flex: 1 },
  listContent: { paddingBottom: 24 },
  footer: { padding: 16, alignItems: 'center' },
  footerText: { fontSize: 12, color: '#94a3b8' },
} satisfies Record<string, ViewStyle | TextStyle>);

export function Feed(props: FeedProps): React.JSX.Element {
  const {
    count,
    avatars = [],
    showAvatars = true,
    unreadEvery = 4,
    scrollEnabled = true,
    showsVerticalScrollIndicator = true,
    onScroll,
    onPressItem,
  } = props;

  const items = Array.from({ length: Math.max(0, Math.round(count)) }, (_, index) => {
    const author = AUTHORS[index % AUTHORS.length] ?? 'Unknown';
    const message = MESSAGES[index % MESSAGES.length] ?? '';
    const avatar = showAvatars && avatars.length > 0 ? avatars[index % avatars.length] : undefined;
    return {
      key: `item-${index}`,
      author,
      message,
      time: `${Math.max(1, (index * 7) % 59)}m`,
      avatarUri: avatar,
      unread: unreadEvery > 0 && index % unreadEvery === 0,
    };
  });

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>Inbox</Text>
        <Text style={styles.subtitle}>
          {items.length} {items.length === 1 ? 'thread' : 'threads'} · drag or wheel to scroll
        </Text>
      </View>
      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
        scrollEnabled={scrollEnabled}
        showsVerticalScrollIndicator={showsVerticalScrollIndicator}
        onScroll={onScroll}
      >
        {items.map((item) => (
          <FeedItem
            key={item.key}
            author={item.author}
            message={item.message}
            time={item.time}
            avatarUri={item.avatarUri}
            unread={item.unread}
            onPress={onPressItem}
          />
        ))}
        <View style={styles.footer}>
          <Text style={styles.footerText}>End of list</Text>
        </View>
      </ScrollView>
    </View>
  );
}
