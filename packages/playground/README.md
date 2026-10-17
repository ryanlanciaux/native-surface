# @native-surface/playground

A component playground whose preview pane is a `<canvas>`. The chrome (sidebar,
props, event log, drawer) is ordinary DOM; the preview is exclusively
`NativeSurface` from `native-surface`, which lays out with Yoga (WASM)
and paints with Skia (CanvasKit). No React Native Web anywhere: inspect the preview and
you find one canvas element, not a `div` tree.

It runs in two modes:

- **Inside a host app** (the product): `npx native-surface playground` serves the
  playground UI against *that app's* story files, on that app's dependencies.
- **Standalone** (this repo's demo): `pnpm --filter @native-surface/playground dev`
  serves the built-in `src/stories/` demo set.

The UI: a filterable sidebar (Components + Screens, ⌘K or `/` to filter, ↑/↓ to
step through stories), a live canvas with one state chip per story and measured
render stats (`rendered in X ms · N nodes · Skia`), a props panel with live
controls and the event log, a Usage / Source / Console drawer (plus Audit under
the CLI), Environment (device at its true logical size, light/dark, pixel ratio,
custom W × H), and a top bar with Preview | Code. Code, Source and Usage are
read-only highlighted text.

Devices are real point sizes: iPhone 16 Pro (402×874, default), 16 Pro Max
(440×956), 16 / 15 (393×852), SE (375×667), plus Pixel 8 and Square. Screens
lay out at the device's exact size with its safe-area insets (`useSurfaceInsets()`)
and are scaled to fit with a CSS transform only. Pixel 8 renders with
`Platform.OS === 'android'`.

## Embedding

The same UI is one component, `@native-surface/playground/embed`:

```tsx
import { Playground, loadIndex, globSources, IPHONES } from '@native-surface/playground/embed';

const index = await loadIndex(import.meta.glob('./src/**/*.stories.tsx'));
const sources = globSources(import.meta.glob('./src/**/*.tsx', { query: '?raw', import: 'default' }));

<Playground index={index} sources={sources} devices={IPHONES} />;
```

Skin it with `className` / `style` on the root `.nsp` and the `--nsp-*` custom
properties (colors, fonts, `--nsp-height`, `--nsp-radius`), `canvasBackground`
(anything painted behind the stage), and `renderSurface` (render the canvas
yourself, e.g. to lazy-mount it or budget WebGL contexts). `writeBack` maps a
callback onto args (`{ onPressFavorite: flip('isFavorite') }`) and `usage`
teaches the Usage tab your idioms. `hash`, `keyboard`, `devTools` and `audit`
are off by default; the standalone tool turns them all on. One surface is reused
for every story, so switching stories never creates a new WebGL context.

Stories can read the light/dark toggle with `usePlaygroundGlobals()` or
`context.globals.colorScheme` in a decorator. The toggle also drives a story's
own `theme` / `colorScheme` arg, or selects its dark chip (a story named "Dark",
or with `parameters.colorScheme: 'dark'`).

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

### `shoot` — headless screenshots / CI visual regression

```sh
npx native-surface playground shoot                      # PNGs into .native-surface/shots
npx native-surface playground shoot --diff shots-baseline            # compare
npx native-surface playground shoot --diff shots-baseline --update   # (re)create baseline
```

Renders every story in a headless Chromium against the same server the serve
command runs, waits for fonts + the engine's flush, and captures the CANVAS
ONLY — one `<out>/<storyId>.png` per story plus `<out>/report.json`. A story
that hits the "not bridged yet" boundary is reported as `skipped` with the
reason; a story that throws is an `error`. `--diff <dir>` compares each shot
with `<dir>/<storyId>.png` via a built-in PNG decoder (no extra deps) and
fails (`exit 1`) on any mismatch or missing baseline unless `--update` copies
the current shots over. Deterministic by construction — fixed viewport
(`--viewport WxH`, default 390x720), dpr pinned to 1, SwiftShader rendering —
so `--tolerance` (differing-pixel fraction, default 0.001) rarely matters.

Requirements: a Chromium/Chrome binary (`--browser` flag, else `$CHROME_PATH`,
else `/usr/bin/chromium`) and `puppeteer-core` resolvable from
`$NS_SHOOT_PUPPETEER_DIR`, the host app, or the playground package (usually:
`npm i -D puppeteer-core` in the app). Programmatic use:
`import { shoot } from '@native-surface/playground/src/shoot.mjs'`.

### Config file

`.native-surface/playground.config.mjs` (or `.js`) in the host root:

```js
export default {
  stories: ['src/**/*.stories.tsx'], // optional; CLI --stories wins
  port: 5170,                        // optional; CLI --port wins
  storyPadding: 16,                  // inset between device chrome and canvas (0 = flush)
  decorators: 'none',                // sets storyPadding to 0 unless storyPadding is also set
  optimizeDeps: {                    // optional Vite escape hatch:
    exclude: ['react-native-paper'], //   host UI kits importing 'react-native'
    include: ['@callstack/react-theme-provider'], // their bare-CJS leaves
  },
  aliases: {                         // optional; exact-specifier overrides that
    'react-native': './rn-plus.tsx', //   OUTRANK the engine preset's aliases —
  },                                 //   patch a missing engine export locally
};
```

`optimizeDeps.exclude` keeps a UI kit that imports the aliased `react-native`
out of Vite's prebundle (a dep chunk would freeze a private engine copy);
`include` entries that only resolve from the host get an automatic exact alias
so the optimizer finds them from the playground's Vite root. `aliases` values
resolve against the host root when they start with `.` or `/`.

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

Fields are inferred from each arg's runtime value: `string` → text (ISO dates get a
date field), `number` → number, `boolean` → switch, a record of mostly primitives →
one field per key (`episode.title`), other objects/arrays → JSON (applied as you
type, invalid JSON just marks the field). Functions are not fields: they feed the
event log. `argTypes[name]` overrides that:

| Field | Effect |
| --- | --- |
| `options` | Renders a `<select>`; values keep their original type |
| `labels` | Display names for `options`, keyed by `String(option)` |
| `control` | Forces a kind (`'none'` / `false` hides it); Storybook's `{ type }` form works |
| `mapping` | Option label → the value the story receives |
| `min` / `max` / `step` | Number field bounds |
| `name` | Label shown instead of the arg name |
| `description` | Tooltip on the label |

Picking a chip applies that story's args and keeps your edits to args no chip
owns; once edits leave every chip, **reset** restores the story's declared args.

## Actions

Every function-valued arg is wrapped so calls land in the props panel's event log
(newest highlighted) and the Console tab, with a depth-capped payload. The
surface's own `onAction` hook is wired too (tagged `surface`). Consecutive
identical calls collapse into one row with a count.

## Sharing

The selected story lives in the URL hash (`#/story/<group>--<story>`), so reloads
and shared links reopen the same story; clicking the address in the top bar
copies it.

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
