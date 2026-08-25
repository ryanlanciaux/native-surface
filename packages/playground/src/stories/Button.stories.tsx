import { Button } from './components/Button';
import { centered } from './decorators';
import type { Meta, Story } from '../story-types';

export const meta: Meta = {
  title: 'Button',
  component: Button,
  decorators: [centered],
  order: ['Primary', 'Secondary', 'Ghost', 'Danger', 'Disabled', 'Large', 'FullWidth'],
  args: {
    label: 'Save changes',
    variant: 'primary',
    size: 'medium',
    disabled: false,
    fullWidth: false,
    onPress: () => {},
    onLongPress: () => {},
  },
  argTypes: {
    variant: { options: ['primary', 'secondary', 'ghost', 'danger'] },
    size: { options: ['small', 'medium', 'large'] },
    label: { description: 'Uppercased automatically under the android theme.' },
  },
};

export const Primary: Story = { args: { label: 'Save', variant: 'primary' } };

export const Secondary: Story = { args: { label: 'Cancel', variant: 'secondary' } };

export const Ghost: Story = { args: { label: 'Learn more', variant: 'ghost' } };

export const Danger: Story = { args: { label: 'Delete account', variant: 'danger' } };

export const Disabled: Story = { args: { label: 'Save', disabled: true } };

export const Large: Story = { args: { label: 'Continue', size: 'large' } };

export const FullWidth: Story = {
  name: 'Full width',
  args: { label: 'Get started', size: 'large', fullWidth: true },
};
