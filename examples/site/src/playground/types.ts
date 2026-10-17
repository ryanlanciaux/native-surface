import type { ArgType } from '@native-surface/playground/src/story-types';
import type { StoryEntry, StoryGroup } from '@native-surface/playground/src/csf';

export type { Args } from '@native-surface/playground/src/story-types';

/**
 * The playground's ArgType: the native-surface playground's, plus the
 * Storybook fields CSF files commonly carry (object-form `control`, `mapping`,
 * number bounds, `table.disable`) and a `date` control.
 */
export interface PlaygroundArgType extends Omit<ArgType, 'control'> {
  control?: ArgType['control'] | 'date' | false | { type: string };
  mapping?: Record<string, unknown>;
  min?: number;
  max?: number;
  step?: number;
  table?: { disable?: boolean };
}

/** `parameters` the playground reads (all optional; real CSF files may set none). */
export interface PlaygroundParameters {
  kind?: 'component' | 'screen';
  /**
   * fullscreen: device-sized, scaled to fit; fullwidth: device width;
   * padded: device width minus the screen gutter; centered: intrinsic size.
   */
  layout?: 'fullscreen' | 'fullwidth' | 'padded' | 'centered';
  /** `transparent` floats the component (it brings its own surface + shadow) on the canvas grid. */
  surface?: 'transparent' | 'sheet';
  /** Points the component paints outside its box (shadows). */
  bleed?: number;
  description?: string;
  usage?: string;
  /** Candidate source files (basename without extension) for the Source tab. */
  sourceNames?: string[];
  /** Story came from the catalog adapter, not a `*.stories.tsx` file. */
  catalog?: boolean;
}

/** One sidebar row: a CSF group (component or screen) and its stories (= state chips). */
export interface PlaygroundItem {
  id: string;
  /** Last segment of the CSF title. */
  name: string;
  kind: 'component' | 'screen';
  group: StoryGroup;
  parameters: PlaygroundParameters;
  /** Path of the story module (real file, or `catalog/<Name>.stories.tsx`). */
  path: string;
}

export type { StoryEntry, StoryGroup };
