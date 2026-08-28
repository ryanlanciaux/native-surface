# native-surface

Run **real React Native component trees inside any React DOM app** — rendered
onto a `<canvas>` through Yoga (WASM) layout and Skia (CanvasKit) paint, with a
custom React reconciler. This is **not react-native-web**: there is no
translation to DOM components. Unmodified RN libraries run their actual native
code paths — real `react-native-reanimated`, real `@gorhom/bottom-sheet`, real
`react-navigation` (nested stack in bottom tabs, native-style headers and
transitions), real `@expo/vector-icons` (icon fonts through the engine's
font registry), real `react-native-drawer-layout` — and whole apps have run
byte-untouched (the engine's acceptance run was a full generated app from a
popular community template, zero source deviations).

The bridged surface also covers `react-native-svg` (Skia-native),
`expo-image`/`fast-image` (Skia-backed, blurhash/thumbhash placeholders),
`expo-linear-gradient`/`expo-blur` (real backdrop blur)/`masked-view`,
`react-native-pager-view` (ScrollView `pagingEnabled` physics),
`react-native-webview` (a DOM portal over the canvas), async-storage/mmkv,
and a pack of device APIs (haptics, netinfo, clipboard, share, image-picker,
device-info, constants, permissions, notifications-advisory). A component
playground CLI (`npx native-surface playground`) serves stories from any
existing RN codebase on the canvas.

> [!WARNING]
> **EXPERIMENTAL — AND HEAVILY AI-DRIVEN**
>
> This codebase was built largely by AI.

## Quickstart (Vite)

### Peer requirements

| Package | Version | Notes |
| --- | --- | --- |
| `react` | `^19` | |
| `react-native-reanimated` | `^3` (tested on `3.19.5`) | **Pin to v3.** v4 renamed the `SharedValue` accessors to `.get()`/`.set()`; the engine bridges the v3 shape, and on v4 worklets fail silently rather than erroring. Only needed with `reanimated: 'real'`. |

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nativeSurface } from 'native-surface/vite';

export default defineConfig({
  plugins: [
    ...nativeSurface({ platform: 'ios', reanimated: 'real' }),
    // Metro applies reanimated's Babel plugin everywhere; app source needs it too:
    react({ babel: { plugins: ['react-native-reanimated/plugin'] } }),
  ],
});
```

```tsx
// Any React DOM component:
import { NativeSurface } from 'native-surface';
import { MyRNScreen } from './rn/MyRNScreen'; // ordinary React Native source

<NativeSurface width={390} height={720} onReady={() => console.log('painted')}>
  <MyRNScreen />
</NativeSurface>
```

The preset aliases `react-native` at bundle time, but `tsc` knows nothing about
Vite aliases — give TypeScript the same mapping in your app tsconfig (the one
that includes your sources; `tsconfig.app.json` in the Vite React template):

```json
{
  "compilerOptions": {
    "types": ["vite/client", "native-surface/react-native-types"]
  }
}
```

(or an explicit `paths` mapping to
`./node_modules/native-surface/dist/index.d.ts` — both recipes, and what
happens when the real `react-native` is also installed, are covered in
[TROUBLESHOOTING.md](./TROUBLESHOOTING.md).)

The preset aliases `react-native` (and friends) to the engine, applies Metro's
platform-extension and `react-native` exports-condition resolution, transforms
`require()` assets, and workletizes RN libraries in `node_modules` (Metro
parity — reanimated worklets in published libraries don't work without it).

App-specific config stays yours: RN libraries that ship ESM and import
`react-native` must be listed in `optimizeDeps.exclude` (see
`examples/embed-demo/vite.config.ts` for a worked example with
@gorhom/bottom-sheet and react-navigation).

Something not working? [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) covers the
common integration failures by symptom — blank canvas, SSR hosts, tsc errors,
snapping transitions, missing images, WASM MIME types, and more.

## Driving it from tests / tools

Every mounted surface registers in `globalThis.__nativeSurfaceRoots`.
`root.getLayoutTree()` returns frames plus `testID`, `role`, `label`,
`placeholder`, and text — enough to locate an element and click its center
with Playwright/Puppeteer. `root.flush()` awaits a committed paint;
`<NativeSurface onReady>` fires after the first one. Focused `TextInput`s are
real DOM overlays, so `page.keyboard.type(...)` just works.

## Limits

- **Native modules don't exist here.** Camera, maps, purchases, push — out of
  scope. Components touching them need mocks.
- **Remote images obey browser CORS.** Hosts without `Access-Control-Allow-Origin`
  won't load (a real device has no such restriction).
- **The `react-native-mmkv` shim stores to `localStorage`** — plaintext, like
  MMKV's default, but in the browser's storage. Don't put secrets in it.
- **`__nativeSurfaceRoots` is a same-origin debug/driver surface.** Any script
  on the page can inspect and drive surfaces — same trust model as the DOM.
- **A pass here is not a pass on a device.** High fidelity is the goal and the
  record so far is good, but the shipped runtime is Hermes/Fabric.

## Packages

| Package | What |
|---|---|
| `native-surface` | The engine, `<NativeSurface>`, and the `native-surface/vite` preset |
| `@native-surface/compat` | Boundary-general shims for RN community packages that need engine wiring (installed automatically) |

## License

MIT © Ryan Lanciaux. Bundled Inter font © The Inter Project Authors, under the
SIL Open Font License 1.1 (`assets/fonts/LICENSE-Inter-OFL.txt`).
