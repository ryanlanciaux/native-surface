import { Card } from './components/Card';
import { safeArea } from './decorators';
import { ada, alan, grace } from './avatars';
import type { Meta, Story } from '../story-types';

export const meta: Meta = {
  title: 'Card',
  component: Card,
  decorators: [safeArea],
  order: ['Default', 'Flat', 'Unverified', 'LongBody'],
  args: {
    name: 'Ada Lovelace',
    role: 'Rendering engineer · Analytical Engine',
    body: 'Same component source as the iOS build, painted through a canvas.',
    avatarUri: ada,
    followers: 12480,
    elevated: true,
    verified: true,
    onPressFollow: () => {},
  },
  argTypes: {
    avatarUri: {
      options: [ada, grace, alan],
      labels: { [ada]: 'Ada (blue)', [grace]: 'Grace (amber)', [alan]: 'Alan (green)' },
      name: 'avatar',
    },
    followers: { description: 'Formatted with Intl inside the component.' },
  },
};

export const Default: Story = {};

export const Flat: Story = {
  name: 'No shadow',
  args: { elevated: false },
};

export const Unverified: Story = {
  args: { name: 'Grace Hopper', role: 'Compiler author', avatarUri: grace, verified: false, followers: 984 },
};

export const LongBody: Story = {
  name: 'Long body',
  args: {
    name: 'Alan Turing',
    role: 'Mathematician · Bletchley Park',
    avatarUri: alan,
    followers: 231045,
    body:
      'A card is the honest stress test: an image that decodes asynchronously, a text block that has to wrap and ' +
      'measure through the same paragraph cache twice, and a shadow that gets blurred outset behind a rounded rect.',
  },
};
