import { PressableStates } from './components/PressableStates';
import { safeArea } from './decorators';
import type { Meta, Story } from '../story-types';

export const meta: Meta = {
  title: 'Pressable',
  component: PressableStates,
  decorators: [safeArea],
  order: ['States', 'Disabled', 'LargeHitSlop', 'NoHitSlop'],
  args: {
    hitSlop: 16,
    disabled: false,
    activeOpacity: 0.2,
    onPress: () => {},
    onPressIn: () => {},
    onPressOut: () => {},
    onLongPress: () => {},
  },
  argTypes: {
    hitSlop: { description: 'Extra tappable margin around the small target, in points.' },
    activeOpacity: { description: 'TouchableOpacity opacity while held.' },
  },
};

export const States: Story = {};

export const Disabled: Story = { args: { disabled: true } };

export const LargeHitSlop: Story = {
  name: 'Large hit slop',
  args: { hitSlop: 40 },
};

export const NoHitSlop: Story = {
  name: 'No hit slop',
  args: { hitSlop: 0 },
};
