import type { ComponentType, ReactElement } from 'react';

export type Theme = 'ios' | 'android';

export type Args = Record<string, unknown>;

export type ControlKind = 'text' | 'number' | 'boolean' | 'select' | 'json' | 'action' | 'none';

export interface ArgType {
  /** Presence of `options` renders a <select> regardless of the arg's runtime type. */
  options?: ReadonlyArray<string | number>;
  /** Display labels for `options`, keyed by String(option). */
  labels?: Record<string, string>;
  /** Overrides the control inferred from the arg's runtime type. */
  control?: ControlKind;
  /** Label shown in the controls panel; defaults to the arg name. */
  name?: string;
  description?: string;
}

export interface StoryContext {
  id: string;
  title: string;
  name: string;
  args: Args;
  theme: Theme;
}

/** Wraps a story's element tree — theme frames, safe-area padding, canvas chrome. */
export type Decorator = (Story: () => ReactElement, context: StoryContext) => ReactElement;

/**
 * `export const meta = { title, component }` — or CSF's `export default`.
 *
 * CSF3 coverage is deliberately scoped to args/argTypes/render/decorators/
 * parameters. `play` functions, `loaders`, and `globals` are NOT supported;
 * stories using them load, but those fields are ignored.
 */
export interface Meta {
  /** Optional in CSF3 — when absent the registry derives it from the file name. */
  title?: string;
  // Stories render `<meta.component {...args} />`, so the prop type is per-story.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component?: ComponentType<any>;
  /** Args shared by every story in the file; each story's own args win. */
  args?: Args;
  argTypes?: Record<string, ArgType>;
  /** Fallback renderer for stories that define neither `render` nor rely on
   *  `meta.component` (CSF3 component-level render). */
  render?: (args: Args) => ReactElement;
  decorators?: Decorator[];
  /** Opaque passthrough — stored on each entry, unknown keys ignored. */
  parameters?: Record<string, unknown>;
  /**
   * Sidebar order, by export name. ES module namespace objects are always
   * key-sorted, so a story file's declaration order cannot be recovered at
   * runtime; unlisted stories follow, alphabetically.
   */
  order?: string[];
}

/** `export const Primary = { args: { ... } }` */
export interface Story {
  /** Overrides the display name derived from the export name. */
  name?: string;
  args?: Args;
  argTypes?: Record<string, ArgType>;
  /** Used instead of `<meta.component {...args} />` when present. */
  render?: (args: Args) => ReactElement;
  decorators?: Decorator[];
  /** Opaque passthrough — merged over meta.parameters, unknown keys ignored. */
  parameters?: Record<string, unknown>;
}
