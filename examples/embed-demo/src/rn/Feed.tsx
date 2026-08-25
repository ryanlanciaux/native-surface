import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { TextStyle, ViewStyle } from 'react-native';
import { colors, radii } from './tokens';

interface Post {
  id: number;
  author: string;
  handle: string;
  initials: string;
  tint: string;
  age: string;
  body: string;
  replies: string;
  likes: string;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const authors = [
  { author: 'Ada Lovelace', handle: 'ada', tint: '#4F46E5' },
  { author: 'Grace Hopper', handle: 'ghopper', tint: '#0E9488' },
  { author: 'Alan Turing', handle: 'aturing', tint: '#B45309' },
  { author: 'Radia Perlman', handle: 'radia', tint: '#BE185D' },
  { author: 'Barbara Liskov', handle: 'bliskov', tint: '#2563EB' },
  { author: 'Ken Thompson', handle: 'ken', tint: '#65758B' },
];

const bodies = [
  'Shipped the layout pass today. Same Yoga build as the phone, so the frames come out identical down to the half pixel — nothing is being re-interpreted by a browser layout engine.',
  'Reminder that this entire list is one <canvas>. Scrolling it is a hit-test against a retained tree, then a repaint. There is no scroll container in the DOM to inspect.',
  'Text measurement goes through SkParagraph with a bundled Inter, so line breaking is deterministic across machines. numberOfLines truncation happens at measure time.',
  'Spent the morning on press semantics: pointer leaving the bounds plus hitSlop has to cancel the gesture, exactly the way it does on device.',
  'Flexbox in, pixels out. The interesting part is that none of the styling here is CSS — it is the React Native style object, applied to Yoga and Skia.',
  'Nested flex rows inside a scrolling list is the honest stress test. Every row is measured, laid out, and painted in the same frame as the scroll offset changes.',
];

const posts: Post[] = Array.from({ length: 12 }, (_, i): Post => {
  const person = authors[i % authors.length] ?? authors[0]!;
  const body = bodies[i % bodies.length] ?? bodies[0]!;
  return {
    id: i,
    author: person.author,
    handle: person.handle,
    initials: person.author
      .split(' ')
      .map((part) => part[0] ?? '')
      .join(''),
    tint: person.tint,
    age: `${i * 7 + 3}m`,
    body,
    replies: plural((i * 5 + 2) % 41, 'reply', 'replies'),
    likes: plural((i * 37 + 11) % 400, 'like', 'likes'),
  };
});

export function Feed() {
  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>Timeline</Text>
        <Text style={styles.count}>{posts.length} posts · scroll me</Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {posts.map((post) => (
          <View key={post.id} style={styles.row}>
            <View style={[styles.avatar, { backgroundColor: post.tint }]}>
              <Text style={styles.avatarText}>{post.initials}</Text>
            </View>

            <View style={styles.rowBody}>
              <View style={styles.byline}>
                <Text style={styles.author} numberOfLines={1}>
                  {post.author}
                </Text>
                <Text style={styles.meta} numberOfLines={1}>
                  @{post.handle} · {post.age}
                </Text>
              </View>

              <Text style={styles.postText} numberOfLines={2}>
                {post.body}
              </Text>

              <View style={styles.footer}>
                <Text style={styles.stat}>{post.replies}</Text>
                <Text style={styles.stat}>{post.likes}</Text>
              </View>
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create<{
  root: ViewStyle;
  header: ViewStyle;
  title: TextStyle;
  count: TextStyle;
  scroll: ViewStyle;
  content: ViewStyle;
  row: ViewStyle;
  avatar: ViewStyle;
  avatarText: TextStyle;
  rowBody: ViewStyle;
  byline: ViewStyle;
  author: TextStyle;
  meta: TextStyle;
  postText: TextStyle;
  footer: ViewStyle;
  stat: TextStyle;
}>({
  root: { flex: 1, backgroundColor: colors.card },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderColor: colors.line,
  },
  title: { fontSize: 15, fontWeight: '700', color: colors.ink },
  count: { fontSize: 11, color: colors.muted },
  scroll: { flex: 1 },
  content: { paddingVertical: 4 },
  row: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderColor: colors.line,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 12, fontWeight: '700', color: colors.onBrand },
  rowBody: { flex: 1 },
  byline: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  author: { fontSize: 14, fontWeight: '600', color: colors.ink },
  meta: { flex: 1, fontSize: 12, color: colors.muted },
  postText: { marginTop: 3, fontSize: 13, lineHeight: 18, color: colors.body },
  footer: { flexDirection: 'row', marginTop: 6, gap: 16 },
  stat: { fontSize: 11, color: colors.muted },
});
