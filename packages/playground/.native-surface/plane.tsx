import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button } from '../src/stories/components/Button';
import { Card } from '../src/stories/components/Card';
import { Feed } from '../src/stories/components/Feed';
import { ada, grace } from '../src/stories/avatars';

const nav = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#0f172a',
  },
  chip: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, backgroundColor: '#1e293b' },
  chipText: { color: '#e2e8f0', fontSize: 13, fontWeight: '600' },
  screen: { flex: 1, backgroundColor: '#f8fafc' },
  pad: { paddingTop: 24, gap: 16 },
});

function Nav({ current }: { current: string }) {
  return (
    <View style={nav.bar}>
      <Pressable testID="home" style={nav.chip}>
        <Text style={nav.chipText}>{current === 'home' ? 'Home ·' : 'Home'}</Text>
      </Pressable>
      <Pressable testID="profile" style={nav.chip}>
        <Text style={nav.chipText}>{current === 'profile' ? 'Profile ·' : 'Profile'}</Text>
      </Pressable>
      <Pressable testID="compose" style={nav.chip}>
        <Text style={nav.chipText}>{current === 'compose' ? 'Compose ·' : 'Compose'}</Text>
      </Pressable>
    </View>
  );
}

function Home() {
  return (
    <View testID="home" style={nav.screen}>
      <Nav current="home" />
      <Feed count={8} avatars={[ada, grace]} unreadEvery={3} />
    </View>
  );
}

function Profile() {
  return (
    <View testID="profile" style={nav.screen}>
      <Nav current="profile" />
      <View style={nav.pad}>
        <Card
          name="Ada Lovelace"
          role="First programmer"
          body="Notes on the analytical engine."
          avatarUri={ada}
          followers={1843}
        />
      </View>
    </View>
  );
}

function Compose() {
  return (
    <View testID="compose" style={[nav.screen, nav.pad, { paddingHorizontal: 16 }]}>
      <Nav current="compose" />
      <Text style={{ fontSize: 22, fontWeight: '700', color: '#0f172a' }}>New message</Text>
      <Button label="Send" />
      <Pressable testID="home">
        <Text style={{ color: '#2563eb' }}>Back to inbox</Text>
      </Pressable>
    </View>
  );
}

export const routes = [
  { id: 'home', title: 'Home', component: Home },
  { id: 'profile', title: 'Profile', component: Profile },
  { id: 'compose', title: 'Compose', component: Compose },
];
