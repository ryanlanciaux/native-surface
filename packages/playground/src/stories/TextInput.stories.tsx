import { InputForm } from './components/InputForm';
import { centered } from './decorators';
import type { Meta, Story } from '../story-types';

export const meta: Meta = {
  title: 'TextInput',
  component: InputForm,
  decorators: [centered],
  order: ['Form', 'Secure', 'Multiline', 'Controlled'],
  args: {
    variant: 'form',
    placeholder: 'Type here…',
  },
  argTypes: {
    variant: { options: ['form', 'secure', 'multiline', 'controlled'] },
  },
};

export const Form: Story = { args: { variant: 'form' } };
export const Secure: Story = { args: { variant: 'secure' } };
export const Multiline: Story = { args: { variant: 'multiline' } };
export const Controlled: Story = { args: { variant: 'controlled' } };
