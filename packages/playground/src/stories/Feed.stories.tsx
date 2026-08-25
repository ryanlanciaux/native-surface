import { Feed } from './components/Feed';
import { ada, alan, grace } from './avatars';
import type { Meta, Story } from '../story-types';

export const meta: Meta = {
  title: 'Feed',
  component: Feed,
  order: ['Default', 'Short', 'Long', 'NoAvatars', 'ScrollLocked'],
  args: {
    count: 12,
    avatars: [ada, grace, alan],
    showAvatars: true,
    unreadEvery: 4,
    scrollEnabled: true,
    showsVerticalScrollIndicator: true,
    onScroll: () => {},
    onPressItem: () => {},
  },
  argTypes: {
    // Data URIs, not worth a text box — the avatars cycle through the list.
    avatars: { control: 'none' },
    count: { description: 'Rows rendered inside the ScrollView.' },
    unreadEvery: { description: '0 disables the unread markers.' },
  },
};

export const Default: Story = {};

export const Short: Story = {
  name: 'Fits without scrolling',
  args: { count: 3, unreadEvery: 0 },
};

export const NoAvatars: Story = {
  name: 'Initials fallback',
  args: { showAvatars: false },
};

export const ScrollLocked: Story = {
  name: 'Scroll disabled',
  args: { scrollEnabled: false, showsVerticalScrollIndicator: false },
};

export const Long: Story = {
  args: { count: 40, unreadEvery: 6 },
};
