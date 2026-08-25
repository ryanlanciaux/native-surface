import { TextSpecimen } from './components/TextSpecimen';
import { safeArea } from './decorators';
import type { Meta, Story } from '../story-types';

export const meta: Meta = {
  title: 'Text',
  component: TextSpecimen,
  decorators: [safeArea],
  order: ['Specimen', 'Clamped', 'Centered', 'LargeType', 'Tracking'],
  args: {
    sample: 'The quick brown fox jumps over the lazy dog',
    fontSize: 15,
    lineHeight: 22,
    letterSpacing: 0,
    align: 'left',
    numberOfLines: 2,
    showScale: true,
    showSpans: true,
  },
  argTypes: {
    align: { options: ['left', 'center', 'right'] },
    numberOfLines: { description: '0 removes the clamp; tail ellipsis otherwise.' },
    letterSpacing: { description: 'Applied through the Skia paragraph style.' },
  },
};

export const Specimen: Story = {};

export const Clamped: Story = {
  name: 'Clamped to one line',
  args: { numberOfLines: 1, showScale: false },
};

export const Centered: Story = {
  args: { align: 'center', showScale: false, sample: 'Centered across the paragraph box' },
};

export const LargeType: Story = {
  name: 'Large type',
  args: { fontSize: 20, lineHeight: 28, letterSpacing: -0.3, numberOfLines: 3, showScale: false },
};

export const Tracking: Story = {
  args: { letterSpacing: 1.6, fontSize: 13, showScale: false, showSpans: false, numberOfLines: 3 },
};
