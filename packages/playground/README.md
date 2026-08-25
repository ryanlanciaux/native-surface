# @native-surface/playground

A component playground whose preview pane is a `<canvas>`. The chrome — sidebar,
controls, actions — is ordinary DOM; the preview is exclusively
`NativeSurface` from `native-surface`, which lays out with Yoga (WASM)
and paints with Skia (CanvasKit). No React Native Web anywhere: inspect the preview and
you find one canvas element, not a `div` tree.

It runs in two modes:

- **Inside a host app** (the product): `npx native-surface playground` serves the
  playground UI against *that app's* story files, on that app's dependencies.
- **Standalone** (this repo's demo): `pnpm --filter @native-surface/playground dev`
  serves the built-in `src/stories/` demo set.

## CLI

```sh
cd your-react-native-app
npm i -D @native-surface/playground   # native-surface provides the `native-surface` bin
npx native-surface playground         # http://localhost:5170
```

```
Options:
  --root <dir>       Host app directory (default: cwd)
  --port <n>         Dev server port (default: 5170)
  --stories <glob>   Story file glob relative to --root; repeatable
  --platform <os>    ios | android — file-extension resolution (default: ios)
  --open             Open the browser
```

Story discovery priority: `--stories` → `.native-surface/playground.config.mjs`
`stories` → the host's `.storybook/main.{js,mjs,cjs}` `stories` globs (resolved
relative to the `.storybook` dir; `@(a|b)` alternation supported; a TS-only
`main.ts` is not executed — you get a warning and the defaults) → the defaults
`src/**/*.stories.{tsx,ts,jsx,js}` and `**/*.play.{tsx,jsx}`.

Adding or deleting a matching file live-reloads the story list; edits ride
normal HMR.

### Config file

`.native-surface/playground.config.mjs` (or `.js`) in the host root:

```js
export default {
  stories: ['src/**/*.stories.tsx'], // optional; CLI --stories wins
  port: 5170,                        // optional; CLI --port wins
  decorators: 'none',                // reserved: opts out of future auto decorators
};
```

### What the server adopts from the host

- **Dependency resolution**: the whole `nativeSurface()` preset is re-rooted at the
  host (`resolveFrom`), so reanimated real-vs-shim detection, optimizeDeps and the
  compat aliases all follow the host's node_modules.
- **tsconfig paths** → Vite aliases. Limits: one relative `extends` hop; single
  wildcard per key; first target of a multi-target array; bare `baseUrl`
  resolution is not emulated.
- **Reanimated's Babel plugin** is applied to host story source when
  `react-native-reanimated/plugin` resolves from the host root (Metro parity for
  worklets in story files).

### Import audit ("not bridged yet")

Any bare import that fails to resolve — typically a native module without a web
bridge — is stubbed with a Proxy that lets the *import* succeed and throws
`<pkg> has no web bridge yet (native-surface)` on first *use*. The story shows an
amber "Not bridged yet" boundary instead of taking down the server; every stub is
listed in the Audit panel and served as JSON at `/__ns_audit`. Caveats: a
dependency probed with try/catch-import will see a successful import and fail
later on use; unresolvable imports *inside prebundled CJS deps* are beyond the
stub's reach.

## Story format

CSF-shaped, close to CSF3. One file per component; `export default` or
`export const meta` is the meta, every other export is a story.

```tsx
import { Button } from './components/Button';
import type { Meta, Story } from '../story-types';

export const meta: Meta = {
  title: 'Button',                 // optional; defaults to the file name
  component: Button,               // rendered as <Button {...args} />
  args: { label: 'Save', onPress: () => {} },
  argTypes: { variant: { options: ['primary', 'secondary'] } },
  decorators: [centered],
  order: ['Primary', 'Disabled'],  // optional; see below
};

export const Primary: Story = { args: { variant: 'primary' } };
export const Disabled: Story = { args: { disabled: true } };
```

Supported CSF3 forms:

- story objects with `args` (rendered as `<meta.component {...args} />`)
- story-level `render(args)`, which wins over `meta.render`, which wins over
  `meta.component`
- a **plain function export is a story** (function = render); its `storyName`
  property overrides the display name, as `name` does for object stories
- `decorators` on meta and story, composed story-first (innermost), each
  receiving `(Story, { id, title, name, args, theme })`
- `parameters` on meta and story: merged (story wins) and stored on the entry;
  unknown keys are ignored
- title-less meta and `*.play.tsx` files: the group title falls back to the
  file name

Not supported (deliberate v1 line, see docs/plays/playground-in-existing-app.md):
`play` functions, `loaders`, `globals`, `includeStories`/`excludeStories`.

Args merge `meta.args` then `story.args`; the same for `argTypes`.

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

## Sharing

The selected story lives in the URL hash (`#/story/<group>--<story>`), so reloads
and shared links reopen the same story; the toolbar's **Copy link** button copies
the current address.

## Layout

`src/stories/components/` holds real React Native source — those files import from
`'react-native'` only, and `vite.config.ts` aliases that to the canvas renderer via
`reactNativeAlias()`. `tsconfig.json` mirrors the alias with a `paths` entry so
typechecking resolves the same module.

The CLI/server half lives in `bin/cli.mjs` + `src/server/*.mjs` (plain Node, no
build step); `createPlaygroundServer()` in `src/server/create-server.mjs` returns
an unlistened Vite dev server — the seam a future headless `shoot` (screenshot)
mode plugs into.

Engine bugs and contract gaps found while building this live in
[ENGINE-ISSUES.md](ENGINE-ISSUES.md).
