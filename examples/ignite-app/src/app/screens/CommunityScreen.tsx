import * as React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Heading, ListItem, Screen, Text, TextField } from '../../components';
import type { IconName } from '../../components';

const channels: { name: string; icon: IconName }[] = [
  { name: 'Ignite on GitHub', icon: 'github' },
  { name: 'Community Slack', icon: 'message' },
  { name: 'React Native Radio', icon: 'podcast' },
  { name: 'Meetups & events', icon: 'calendar' },
];

/** Join channels (toggles) and a newsletter form with validation. */
export function CommunityScreen() {
  const [joined, setJoined] = React.useState<ReadonlySet<string>>(new Set());
  const [email, setEmail] = React.useState('');
  const [submitted, setSubmitted] = React.useState<'idle' | 'error' | 'ok'>('idle');

  const toggle = (name: string) =>
    setJoined((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const subscribe = () => setSubmitted(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? 'ok' : 'error');

  return (
    <Screen preset="scroll" contentContainerStyle={styles.content}>
      <Heading text="Community" />
      <Text
        preset="formHelper"
        text="Ignite is built in the open by thousands of React Native developers. Come say hi."
      />
      <View>
        {channels.map((c, i) => (
          <ListItem
            key={c.name}
            text={c.name}
            leftIcon={c.icon}
            topSeparator={i === 0}
            value={joined.has(c.name) ? 'Joined' : undefined}
            rightIcon={joined.has(c.name) ? 'check' : 'caretRight'}
            onPress={() => toggle(c.name)}
          />
        ))}
      </View>
      <Text preset="subheading" text="Newsletter" />
      <TextField
        label="Email"
        placeholder="you@example.com"
        value={email}
        onChangeText={(t) => {
          setEmail(t);
          setSubmitted('idle');
        }}
        status={submitted === 'error' ? 'error' : undefined}
        helper={
          submitted === 'error'
            ? 'That does not look like an email address.'
            : submitted === 'ok'
              ? `Subscribed ${email.trim()}. See you Thursday!`
              : 'One email a week. No spam.'
        }
      />
      <Button preset="reversed" text={submitted === 'ok' ? 'Subscribed' : 'Subscribe'} onPress={subscribe} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: 10, paddingHorizontal: 24, paddingBottom: 32, gap: 18 },
});
