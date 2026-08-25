import { StyleSheet, View } from 'react-native';
import type { ViewStyle } from 'react-native';
import { Badge, BadgeRow } from './components/Badge';
import { centered } from './decorators';
import type { Meta, Story } from '../story-types';

const styles = StyleSheet.create({
  column: { gap: 10, alignItems: 'flex-start' },
} satisfies Record<string, ViewStyle>);

const TONES = ['neutral', 'info', 'success', 'warning', 'danger'] as const;

export const meta: Meta = {
  title: 'Badge',
  component: BadgeRow,
  decorators: [centered],
  order: ['Wrapping', 'Tight', 'NoWrap', 'AllTones'],
  args: {
    labels: ['New', 'Beta', 'Deprecated', 'Experimental', 'Canvas', 'Yoga', 'Skia', 'RN 0.76'],
    tone: 'info',
    gap: 8,
    wrap: true,
    containerWidth: 260,
  },
  argTypes: {
    tone: { options: [...TONES] },
    labels: { description: 'Edited as JSON — the row re-wraps live.' },
    containerWidth: { description: 'Constrains the flex container so wrapping is visible.' },
  },
};

export const Wrapping: Story = {};

export const Tight: Story = { args: { gap: 4, containerWidth: 200 } };

export const NoWrap: Story = {
  name: 'No wrap (overflow)',
  args: { wrap: false, labels: ['One', 'Two', 'Three', 'Four', 'Five'] },
};

/** A `render` story: builds its own tree instead of `<meta.component {...args} />`. */
export const AllTones: Story = {
  name: 'All tones',
  args: { label: 'Badge' },
  render: (args) => (
    <View style={[styles.column, { gap: Number(args.gap ?? 10) }]}>
      {TONES.map((tone) => (
        <Badge key={tone} label={`${String(args.label ?? 'Badge')} · ${tone}`} tone={tone} />
      ))}
    </View>
  ),
};
