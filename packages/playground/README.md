# playground

A component playground whose preview pane is a `<canvas>`. The chrome — sidebar,
controls, actions — is ordinary DOM; the preview is exclusively
`NativeSurface` from `native-surface`, which lays out with Yoga (WASM)
and paints with Skia (CanvasKit). No React Native Web anywhere: inspect the preview and
you find one canvas element, not a `div` tree.

```sh
pnpm --filter playground dev        # http://localhost:5173
pnpm --filter playground typecheck
pnpm --filter playground build
```

## Story format

CSF-shaped. One file per component in `src/stories/*.stories.tsx`, discovered with
`import.meta.glob('./stories/*.stories.tsx', { eager: true })`.

```tsx
import { Button } from './components/Button';
import type { Meta, Story } from '../story-types';

export const meta: Meta = {
  title: 'Button',                 // sidebar group; required
  component: Button,               // rendered as <Button {...args} />
  args: { label: 'Save', onPress: () => {} },
  argTypes: { variant: { options: ['primary', 'secondary'] } },
  decorators: [centered],
  order: ['Primary', 'Disabled'],  // optional; see below
};

export const Primary: Story = { args: { variant: 'primary' } };
export const Disabled: Story = { args: { disabled: true } };
```

Every non-`meta` object export is a story. A story renders
`<meta.component {...args} />` unless it defines `render(args)`, which wins:

```tsx
export const AllTones: Story = {
  render: (args) => <View>{TONES.map((t) => <Badge key={t} tone={t} {...args} />)}</View>,
};
```

Args merge `meta.args` then `story.args`; the same for `argTypes`. Decorators run
story-first, then meta, each receiving `(Story, { id, title, name, args, theme })`.

`meta.order` lists export names in sidebar order. It exists because ES module namespace
objects are always key-sorted, so a file's declaration order is not recoverable at
runtime; unlisted stories follow alphabetically.

## Controls

Knobs are inferred from each arg's runtime value: `string` → text, `number` → number,
`boolean` → checkbox, object/array → JSON textarea (applied as you type, invalid JSON
just marks the field), function → a read-only "logged to actions" row. `argTypes[name]`
overrides that:

| Field | Effect |
| --- | --- |
| `options` | Renders a `<select>`; values keep their original type |
| `labels` | Display names for `options`, keyed by `String(option)` |
| `control` | Forces a kind (`'none'` hides the knob) |
| `name` | Label shown instead of the arg name |
| `description` | Tooltip on the label |

Edits are per-story and live for the session; **Reset** restores the story's declared
args.

## Actions

Every function-valued arg is wrapped so calls log with name, a depth-capped JSON-ish
payload, and a timestamp (`arg` tag). The surface's own `onAction` hook is wired too, so
the engine reports presses it dispatches even for handlers the story did not pass
(`surface` tag). Consecutive identical calls collapse into one row with a count.

## Layout

`src/stories/components/` holds real React Native source — those files import from
`'react-native'` only, and `vite.config.ts` aliases that to the canvas renderer via
`reactNativeAlias()`. `tsconfig.json` mirrors the alias with a `paths` entry so
typechecking resolves the same module.

Engine bugs and contract gaps found while building this live in
[ENGINE-ISSUES.md](ENGINE-ISSUES.md).
