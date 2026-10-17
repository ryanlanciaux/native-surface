# ignite-demo on native-surface

A brand-new app generated with the Ignite CLI, running live on
[native-surface](../../packages/native-surface) (React Native on a canvas: Yoga
+ Skia in WASM, no react-native-web). The site's hero phone and playground show
this app. The private workspace package is `ignite-demo`.

## Generated with

```bash
npx -y ignite-cli@11.5.0 new IgniteDemo --yes --workflow=cng \
  --installDeps=false --git=false --packager=pnpm --removeDemo=false \
  --experimental=false --noTimeout
# effective: --bundle=com.ignitedemo --overwrite=false
```

- Generated on 2026-10-16 with ignite-cli 11.5.0: Expo SDK 55, React Native 0.83.2, React 19.2.
- The output is committed byte-for-byte as its own commit (`ignite-app: pristine output of ignite-cli 11.5.0`).
- `git diff <that commit> -- examples/ignite-app` shows everything changed since.
- The CNG workflow emits no `ios/` or `android/`. The only dropped output is the CLI's empty `node_modules/.cache`.

## What runs

Everything in `app/` is the generated boilerplate, running on native-surface:

- the providers in `app.tsx`
- `AppNavigator`: a native-stack, through the native-surface stack adapter
- `DemoNavigator`: real `@react-navigation/bottom-tabs`
- the Welcome, Login, Showroom (with drawer), Community, Podcast list and Debug screens
- every component in `app/components`
- `EpisodeContext`, i18n (i18next with 7 locales), date-fns, MMKV, reanimated 4, keyboard-controller and the theme system (light and dark)

`expo-*`, `react-native-mmkv`, `react-native-safe-area-context`, keyboard-controller, edge-to-edge, gesture-handler, screens and reactotron all resolve to `@native-surface/compat` shims through the `native-surface/vite` preset.

## Adapter layer (everything that is not generated)

| File | Why |
|---|---|
| `package.json` | Workspace package `ignite-demo`. Exports `src/index.ts` and `./vite`. Dependencies are trimmed to what actually executes; everything the preset aliases is gone. Real `react-native` 0.83.2, mmkv, keyboard-controller, safe-area, gesture-handler, edge-to-edge and reactotron are devDependencies **for types only**. `@react-navigation/native-stack` is pinned to 7.18.8 and `@react-navigation/stack` is added, which keeps one react-navigation copy in the workspace. `.npmrc` (`node-linker=hoisted`) is removed because it does not belong in a workspace member. |
| `tsconfig.json` | Ignite's options without `extends: "expo/tsconfig.base"`. Expo modules point at the compat shims via `paths`, so `tsc` checks what actually runs. |
| `types/expo-font.d.ts` | The slice of the expo-font API the app uses, typed like upstream (fonts are Metro asset numbers under RN typings). |
| `src/vite.ts` | `igniteDemo()`, scoped to this package. It does three things: (1) resolves the `@/` and `@assets/` path aliases (Ignite's babel/tsconfig); (2) sends `apisauce` in `app/services/api` to the offline feed; (3) swaps the Showroom's two remote GitHub images, which have no CORS headers, for bundled copies in `assets/remote/`. |
| `src/adapter/feed.ts`, `apisauce-fixture.ts` | The React Native Radio feed (rss2json shape), bundled. The design's titles, dates, durations and covers are in `assets/covers/`. Ignite's `Api` class runs unchanged on top of it. |
| `src/adapter/legacy.ts` | Accepts the previous hand-built app's `episodes` shape. |
| `src/IgniteApp.tsx` | `app.tsx` for embedding: the same providers and `AppNavigator`, without URL linking or persisted navigation, with per-instance auth. Props are `theme`, `initialRoute`, `initialTab`, `showStatusBar`, `episodes`, `initialFavorites`, `onPressFavorite` and `onTabChange`. |
| `src/boot.ts` | `app.tsx`'s startup (fonts via expo-font, i18n, the date-fns locale), shared once per page. |
| `src/StatusBar.tsx` | Optional in-app 9:41 bar, for hosts without a bezel. |
| `src/catalog.tsx` | `componentCatalog` / `screenCatalog` for the site and playground. Entries render the real components in the app's providers. |
| `src/stories/*.stories.tsx` | CSF3 stories, one file per catalog entry. |
| `src/episodeStore.ts`, `src/device.ts`, `src/index.ts` | Public surface. |
| `dev/` | The dev harness. |
| `.native-surface/playground.config.mjs` | Settings for `npx native-surface playground`. |

### Edits inside `app/` (each marked `native-surface adapter` in the source)

- `context/EpisodeContext.tsx`:
  - Adds an optional `EpisodeSeedContext` (episodes, initial favorites, `favoritesOnly`, an `onToggleFavorite` callback) that embedded hosts provide.
  - Without a seed, behavior is exactly as generated.
  - Zero-pads the duration label: upstream renders 47:02 as "47:2".
- `screens/DemoPodcastListScreen.tsx`:
  - `EpisodeCard` is now exported.
  - The card uses the episode's own cover (a bundled `thumbnail`, @3x, 64pt) instead of a random placeholder.
- `screens/DemoShowroomScreen/SectionListWithKeyboardAwareScrollView.tsx`: moves `contentContainerStyle` after the props spread. This works around an engine gap (see below) and gives the same result on a device.

## Engine gaps found (native-surface, reported, not patched here)

1. **`SectionList` → `renderScrollComponent` passes `contentContainerStyle: undefined` explicitly.**
   - Where: `packages/native-surface/src/components/lists.tsx`, `scrollElementProps`. RN omits the key.
   - Effect: a custom scroll component that sets its own `contentContainerStyle` before spreading props loses it. Ignite's Showroom lost its 24pt gutters this way.
   - Fix: only include `contentContainerStyle` and `horizontal` when they are defined.
2. **`createAnimatedComponent` passes a variable-length deps array to `useEffect` (`[...found]`).**
   - Where: `packages/native-surface/src/api/Animated.tsx`.
   - Effect: React logs "The final argument passed to useEffect changed size between renders" when a view's animated-node count changes. That happens when the Showroom's drawer or tab views mount. The warning is dev-only and harmless.
   - Fix: depend on a stable key, e.g. node ids joined.
3. **`Image` ignores `source.width/height`.**
   - RN uses them as the intrinsic size of a `{uri}` source; the engine sizes from pixels / `scale` only.
   - Worked around with `scale: 3` on the bundled covers.

## Using it

```tsx
// vite.config.ts
import { igniteDemo } from 'ignite-demo/vite'
plugins: [igniteDemo(), ...nativeSurface({ platform: 'ios' }), react({ babel: { plugins: ['react-native-reanimated/plugin'] } })]

// any React DOM component
import { NativeSurface } from 'native-surface'
import { IgniteApp, componentCatalog, catalogSurfaceSize } from 'ignite-demo'

<NativeSurface width={320} height={684} safeAreaInsets={{ top: 50 }}>
  <IgniteApp theme="light" initialRoute="DemoPodcastList" onPressFavorite={(ep, fav) => …} />
</NativeSurface>

const card = componentCatalog.find((e) => e.name === 'EpisodeCard')!
<NativeSurface {...catalogSurfaceSize(card)}>{card.render({ isFavorite: true }, { bleed: true, theme: 'dark' })}</NativeSurface>
```

- **`initialRoute`:** `Login` | `Welcome` | `DemoShowroom` | `DemoCommunity` | `DemoPodcastList` (default) | `DemoDebug`. The tab routes start with Welcome underneath, as after "Let's go!". `initialTab` also takes the old names (`Components` / `Community` / `Podcasts` / `Debug`).
- **`theme`:** pins the scheme (default `light`). The Debug tab's "Toggle Theme" and "Reset" still work, without the choice leaking into the next page load.
- **Locale:** i18n follows the browser locale, like a device does. Ignite ships en, ar, es, fr, hi, ja and ko.
- **Episode store:** `episodeStore.use()` / `useEpisodes()` returns `{ episodesForList, toggleFavorite(episode), favoritesOnly, toggleFavoritesOnly, … }`.

### Dev harness

Run `pnpm --filter ignite-demo dev`. Routes:

- `#/`: the phone plus every catalog entry, light and dark
- `#/phone`: the design's phone frame
- `#/screen`: the app with its in-app status bar
- `#/app`: the generated `app.tsx` exactly as is (Login first)
- `#/c/<Name>/<variant>`: one catalog entry
- `#/measure`: catalog content heights

Query parameters: `?theme=dark`, `?route=Welcome` and `?bleed=1`.

## Licenses

- Ignite boilerplate © Infinite Red, MIT.
- Space Grotesk via `@expo-google-fonts/space-grotesk`, SIL OFL 1.1.
- Cover art in `assets/covers` is derived from the site design's generated images.
- The two Ignite logo images in `assets/remote` are from Ignite's own docs, as referenced by the boilerplate.
