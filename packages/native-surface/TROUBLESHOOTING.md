# Troubleshooting native-surface in a host app

Field-tested answers for integrating native-surface into an existing web app.
Everything here is organized by symptom. "Host app" means your web application
— any Vite-based setup, from a bare SPA to an SSR metaframework.

## Symptom index

| Symptom | See |
| --- | --- |
| `tsc` reports errors inside native-surface itself | [TypeScript: errors from the package](#typescript-errors-reported-inside-native-surface) |
| `tsc`: "Cannot find module 'react-native'" | [TypeScript: mapping react-native](#typescript-cannot-find-module-react-native) |
| Blank canvas, no errors on screen | [Blank canvas checklist](#blank-canvas-checklist) |
| Crash on the server / during SSR | [SSR and isomorphic hosts](#ssr-and-isomorphic-hosts) |
| Navigation transitions snap instead of animating | [Snap instead of animate](#transitions-snap-instead-of-animating) |
| Sheet/animation snaps after changing `reanimated` mode | [Stale optimizer cache](#stale-optimizer-cache) |
| Production build fails on an RN library import | [optimizeDeps and aliasing other RN libraries](#optimizedeps-hygiene-for-other-rn-libraries) |
| Paper components show placeholder boxes, or render dark | [React Native Paper](#react-native-paper) |
| Images never appear | [Images](#images-never-appear) |
| Headers/tab bars flush against the edge | [Safe area simulation](#safe-area-insets-are-all-zero) |
| Real `react-native` showed up in node_modules | [Peer react-native](#npm-installed-the-real-react-native) |
| Tests can't type into inputs / click the wrong element | [Driving the canvas from tests](#driving-the-canvas-from-tests-and-tools) |

---

## TypeScript: errors reported inside native-surface

**Symptom:** `tsc` reports dozens of errors in `native-surface/src/**` before
any of your own code — missing `react-reconciler` or `babel` types, or
complaints from your template's `erasableSyntaxOnly` / `noUnusedLocals` flags.

That was a packaging bug in `0.1.0-alpha.0`, which exported `./src/index.ts`
as its types entry, so your `tsc` compiled the engine source under your app's
compiler options. Since `0.1.0-alpha.1` the package ships compiled `.d.ts`
files (`dist/index.d.ts`, `dist/vite.d.ts`) as the types entries; the default
Vite React template typechecks a native-surface app with zero errors and zero
extra `@types/*` installs. Upgrade and delete any of the old workarounds
(`@types/react-reconciler`, `@types/babel__core`, disabled strictness flags) —
none of them are needed anymore.

The runtime entry is still TypeScript source on purpose (the Vite preset
aliases `react-native` to it, and a compiled copy alongside it would put two
engines in your bundle); only the *types* moved to `dist`.

## TypeScript: Cannot find module 'react-native'

**Symptom:** the app bundles and runs (the Vite preset aliases `react-native`
at bundle time), but `tsc` reports `TS2307: Cannot find module 'react-native'`
for imports in your RN components.

`tsc` knows nothing about Vite aliases, so give it the same mapping. Two
supported recipes — both point TypeScript at native-surface's compiled
declarations, never at engine source. Apply them to the tsconfig **that
includes your app sources** (`tsconfig.app.json` in the Vite React template).

**Recipe A — one line, ships with the package.** Add the ambient mapping to
the `types` array:

```jsonc
// tsconfig.app.json
{
  "compilerOptions": {
    "types": ["vite/client", "native-surface/react-native-types"]
  }
}
```

Equivalently, if you'd rather not maintain a `types` array, one line in any
global `.d.ts` your project includes (e.g. `src/vite-env.d.ts`):

```ts
/// <reference types="native-surface/react-native-types" />
```

Either form loads a declaration equivalent to
`declare module 'react-native' { export * from 'native-surface' }`.

**Recipe B — explicit paths mapping:**

```jsonc
// tsconfig.app.json
{
  "compilerOptions": {
    "paths": {
      "react-native": ["./node_modules/native-surface/dist/index.d.ts"]
    }
  }
}
```

Both recipes are verified against the Vite React template's strict flags
(`verbatimModuleSyntax`, `erasableSyntaxOnly`, `noUnusedLocals`,
`moduleResolution: "bundler"`) on TypeScript 5.9 and 6.0.

Do **not** map to `native-surface/src/index.ts` — that resurrects the
"compiles the engine under my tsconfig" problem above.

**If the real `react-native` package is also installed** (see
[Peer react-native](#npm-installed-the-real-react-native)): both recipes still
win. An ambient module declaration takes precedence over `node_modules`
resolution, and `paths` is consulted before `node_modules` — verified with
real `react-native` installed alongside. No tsconfig ordering tricks needed.

## Blank canvas checklist

A `<canvas>` element always mounts, even when engine startup fails — so a
blank surface usually means an asset or module failed to load. Check the
browser console and work down this list:

1. **"does not provide an export named 'default'" / "'DefaultEventPriority'"**
   — a CJS dependency (`canvaskit-wasm`, `react-reconciler`) was served raw
   instead of prebundled. The preset configures `optimizeDeps` for the
   standard set automatically; if you overrode `optimizeDeps`, make sure you
   didn't exclude these. Restart the dev server after any change — see
   [Stale optimizer cache](#stale-optimizer-cache).
2. **"Failed to load module script ... MIME type of application/wasm"** — a
   middleware or route rule is forcing `application/wasm` onto a URL where the
   dev server serves a JavaScript wrapper. See [WASM MIME types](#wasm-mime-types).
3. **Running under SSR?** See [SSR and isomorphic hosts](#ssr-and-isomorphic-hosts).
4. **A streaming-compile warning about WASM MIME is not an error.** CanvasKit
   falls back to ArrayBuffer instantiation; the canvas still paints.

Also note: `<NativeSurface>` takes **a single React element** as children —
the prop type is `React.ReactElement`, not `ReactNode`. Wrap your tree in one
component (`<NativeSurface><MyApp /></NativeSurface>`); a fragment with
multiple children will not typecheck and may not mount.

### A note on `onReady` and StrictMode

On `0.1.0-alpha.0`, `onReady` never fires under `<React.StrictMode>` (the
surface still paints and handles input). That is fixed in later versions —
`onReady` fires exactly once under StrictMode. If you are stuck on alpha.0:
don't gate UI on `onReady`; await `root.flush()` on the root from
`globalThis.__nativeSurfaceRoots` instead.

## SSR and isomorphic hosts

**Symptom:** the server render crashes (no `document`, WASM instantiation
errors, font fetch failures) as soon as a route imports native-surface.

The engine loads CanvasKit WASM, Yoga, and fonts via `fetch` and `?url`
assets at module evaluation — that must only ever happen in a browser. In an
isomorphic host (any SSR metaframework), never statically import
`native-surface` — or `react-native` — from a module the server evaluates.

Pattern that works: start the dynamic import at module evaluation *on the
client only*, so the WASM fetch begins before React even mounts, then consume
the same promise in an effect (the second call hits the module cache):

```tsx
// surface.client.tsx — only ever imported from client components
const enginePromise =
  typeof window !== 'undefined' ? import('native-surface') : null

export function Surface(props: { children: React.ReactElement }) {
  const [mod, setMod] = useState<typeof import('native-surface') | null>(null)
  useEffect(() => {
    enginePromise?.then(setMod)
  }, [])
  if (!mod) return <div style={{ width: 390, height: 720 }} />  // placeholder
  const { NativeSurface } = mod
  return <NativeSurface width={390} height={720}>{props.children}</NativeSurface>
}
```

## Vite plugin order and coexistence

Spread the preset **before** the React plugin:

```ts
plugins: [
  ...nativeSurface({ platform: 'ios' }),
  react(),
]
```

The preset composes with other frameworks' plugins — SSR metaframeworks, PWA
plugins, and so on can stay in the list. Keep your existing config; add the
spread rather than replacing anything.

## Safe area insets are all zero

**Symptom:** stack headers and tab bars sit flush against the canvas edge.

The canvas has no OS chrome, so real insets are zero. Simulate a device with
`initialMetrics`. The safe-area compat module ships a helper with phone-like
defaults (top 59, bottom 34, 390×844 frame):

```tsx
import { SafeAreaProvider, simulatedDeviceMetrics } from 'react-native-safe-area-context'

<SafeAreaProvider initialMetrics={simulatedDeviceMetrics()}>
```

(That import resolves to the compat shim via the preset's alias.) Or spell the
object out to match your surface size:

```tsx
<SafeAreaProvider
  initialMetrics={{
    insets: { top: 59, bottom: 34, left: 0, right: 0 },
    frame: { x: 0, y: 0, width: 390, height: 844 },
  }}
>
```

## Images never appear

Skia decodes raw bytes: `Image` sources are loaded with `fetch(uri)` and
decoded with CanvasKit. There is no hidden `<img>` element fallback, which has
three consequences:

- **CORS applies.** A host that doesn't send `Access-Control-Allow-Origin`
  fails silently — no image, no exception. Prefer proxying third-party images
  through your own origin so the canvas fetch is same-origin.
- **SVG is not a supported encoding.** PNG, JPEG, WEBP, and GIF decode;
  SVG does not. Rasterize SVGs or paint the shape with Views.
- **Relative URLs are unreliable.** Prefix with `window.location.origin`.

Related: public third-party APIs can behave differently when called from
datacenter IPs (CI boxes, cloud dev environments) than from a laptop — empty
result sets, throttling, different rankings. Proxy third-party fetches through
your own origin and don't assume an API that works locally works everywhere.

## optimizeDeps hygiene for other RN libraries

The preset configures Vite's optimizer for its own dependency set
automatically. When you add **other** React Native libraries (navigation,
gesture libraries, bottom sheets, ...), one rule decides everything:

- **ESM libraries that import `react-native`** must be *excluded* from
  prebundling (`optimizeDeps.exclude`) and listed in `resolve.dedupe`.
  Prebundling them freezes a private copy of the engine inside the dep chunk
  — stale code and duplicated singletons.
- **Their CJS leaf dependencies** (small utility packages) should be
  *included* (`optimizeDeps.include`) so Vite converts them to ESM.

After any change to `optimizeDeps` or aliases, **restart the dev server** —
dependency metadata is cached and survives ordinary restarts (see next
section). Under pnpm's strict layout, nested dependencies need qualified
include entries, e.g. `'some-app-dep > nested-cjs-dep'`.

If a library's `react-native` export condition resolves to native-only entry
points that can't run on the web, alias that library to a shim file of your
own; make sure the replacement path is a defined string (an undefined variable
in `resolve.alias` crashes Vite at config load —
`fileURLToPath(new URL('./src/my-shim.tsx', import.meta.url))` is the
reliable form in an ESM config).

## React Native Paper

`react-native-paper` (5.15.x, MD3) renders **stock** on the engine as of this
release: install it, wrap your tree in `PaperProvider`, and its Buttons, Cards,
Chips, FABs, Appbars (BackAction included) and SegmentedButtons paint. The
preset already excludes paper from prebundling and includes its
`@callstack/react-theme-provider` leaf — you do not need `optimizeDeps` entries
or aliases of your own.

**Icons.** Paper's default icon component is whatever its module-scope probe
finds first among `@react-native-vector-icons/material-design-icons`,
`@expo/vector-icons/MaterialCommunityIcons`, and
`react-native-vector-icons/MaterialCommunityIcons`. Only the first two are real
icon sets here — `react-native-vector-icons` subpaths reach the compat shim,
which warns once and paints a placeholder box (`□`), because the alias cannot
know which icon set a subpath meant. Nothing crashes either way, but to *choose*
the set, pass paper's `settings.icon`:

```tsx
import { PaperProvider } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

<PaperProvider settings={{ icon: (props) => <MaterialCommunityIcons {...props} /> }}>
  <App />
</PaperProvider>;
```

**What paper needs from the engine.** Paper imports `Appearance`,
`SafeAreaView`, and `Switch` from `react-native`; all three now ship in the
engine, and a *missing name breaks the whole ESM index at link time*, not just
the feature — so a paper upgrade that fails with "does not provide an export
named X" is telling you exactly which export to add. `Switch` (used directly
and by `SegmentedButtons`) is engine-painted and controlled: it moves only when
you pass a new `value`. Dark mode follows `Appearance` / `useColorScheme`, which
report the **embedding page's** `prefers-color-scheme` — a paper app with no
explicit `theme` renders dark on a dark host page. Pin it with
`Appearance.setColorScheme('light')` or by passing `theme={MD3LightTheme}`.

## Stale optimizer cache

**Symptom:** behavior that should have changed didn't — the classic case is a
sheet or transition that *snaps* instead of animating after switching the
preset's `reanimated` mode, because a prebundled copy of the other mode is
still being served.

The preset scopes Vite's `cacheDir` per reanimated mode, which prevents the
mode-switch case. For everything else (edited aliases, changed excludes,
"impossible" stale behavior), the hammer always works:

```sh
rm -rf node_modules/.vite*
```

then restart the dev server.

## WASM MIME types

Browsers want `application/wasm` for streaming compilation — but do **not**
blanket-force that header onto every URL ending in `.wasm`:

- In dev, Vite may serve a **JavaScript wrapper** at a `.wasm` URL (this is
  how `?url` imports work). Forcing `application/wasm` there breaks module
  loading: "Failed to load module script: Expected a JavaScript-or-Wasm module
  script but the server responded with a MIME type of application/wasm" — and
  the canvas stays blank.
- Never use a glob route rule like `"/**/*.wasm"` in a server/deploy config.
  Some servers compile that glob to a regex that also matches the document
  root, and then your HTML is served as `application/wasm`.
- If your production host serves hashed `.wasm` assets with a wrong type, only
  rewrite the header **when the current value is not JavaScript**: if the type
  already says javascript/ecmascript/json, leave it alone; otherwise set
  `application/wasm`.
- A console **warning** that streaming compile fell back due to MIME type is
  harmless — CanvasKit instantiates from an ArrayBuffer and still paints.

## npm installed the real react-native

**Symptom:** `react-native` appears in `node_modules` even though you never
installed it. Navigation and other RN libraries declare it as a peer
dependency, and npm auto-installs peers.

This is harmless **as long as the bundler alias wins** — and the TypeScript
mapping recipes above also keep winning (verified). Confirm the alias is in
effect by checking, in the running app's console:

```js
const rn = await import('react-native')
console.log('NativeSurface' in rn)   // true → the alias won
```

If that logs `false`, `nativeSurface()` is missing from (or after a
conflicting plugin in) your Vite plugin list — you'd be bundling the real RN
runtime into a browser, which will not go well.

Also: **don't install `@native-surface/compat` yourself.** It comes with
`native-surface` automatically; adding it as a direct dependency just
duplicates the graph.

## Transitions snap instead of animating

**Symptom:** stack navigator pushes/pops jump to the final frame.

First rule out a [stale optimizer cache](#stale-optimizer-cache). If it's not
that, it's almost always the card interpolator seeing a zero-size screen:
stack interpolators use `layouts.screen.width` as the translate distance, and
a 0-width screen makes the animation a no-op.

- **Keep previous screens attached.** Detached/unmounted previous screens
  can't be animated over: pass `detachPreviousScreen: false` (and
  `detachInactiveScreens: false`) so there is something behind the card.
  The screens compat shim forwards `onLayout`, which is how the stack
  measures its container.
- **If measuring is impossible in your embedding, pin the interpolator** to
  your surface size:

  ```ts
  cardStyleInterpolator: (props) =>
    CardStyleInterpolators.forHorizontalIOS({
      ...props,
      layouts: { screen: { width: SURFACE_W, height: SURFACE_H } },
    })
  ```

- Keep the top card opaque and full-size, or the screen below shows through
  during the gesture.

## Driving the canvas from tests and tools

Every mounted surface registers in `globalThis.__nativeSurfaceRoots`.
`root.getLayoutTree()` returns frames plus `testID`, `role`, `label`,
`placeholder`, and text; `await root.flush()` waits for a committed paint.

- **Typing into a TextInput:** a *focused* TextInput is a real DOM `<input>`
  overlaid on the canvas. Click the canvas at the field's layout-tree center
  first so the overlay mounts and focuses; after that, synthetic keyboard
  input (`page.keyboard.type(...)` and friends) works normally.
- **Inactive tab screens stay in the layout tree.** Bottom-tab navigators
  keep inactive screens mounted, and `getLayoutTree()` returns them at the
  same origin as the visible screen — a text query can match a hidden
  screen's header before the tab bar label, and clicking that point taps the
  visible screen instead. Give each tab a `tabBarButtonTestID` and target
  that; if you must match on text, prefer the node whose `frame.y` is near
  the bottom of the surface.
