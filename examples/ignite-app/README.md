# ignite-demo

An Ignite-style React Native app (React Native Radio podcast browser plus a
component showroom) that runs on [native-surface](../../packages/native-surface).
Private workspace package; the site imports it from source.

```tsx
import { NativeSurface } from 'native-surface';
import { IgniteApp, loadIgniteFonts, device, componentCatalog } from 'ignite-demo';

await loadIgniteFonts(); // Space Grotesk, so the first paint has the right metrics
<NativeSurface width={device.screenWidth} height={device.screenHeight} safeAreaInsets={{ top: 50 }}>
  <IgniteApp /> {/* or <IgniteApp showStatusBar /> to draw 9:41 in-app */}
</NativeSurface>

// Component library / playground:
const card = componentCatalog.find((e) => e.name === 'EpisodeCard')!;
<NativeSurface {...catalogSurfaceSize(card)}>{card.render({ isFavorite: true }, { bleed: true })}</NativeSurface>
```

- `src/components/`: Text, Heading, Icon, Toggle, FavButton, EpisodeCard, TabBar,
  StatusBar, Screen, Button, Card, ListItem, AutoImage, Header, TextField.
- `src/app/IgniteApp.tsx`: Components / Community / Podcasts (default) / Debug tabs.
- `src/catalog.tsx`: `componentCatalog` / `screenCatalog` (name, description,
  size, bleed, usage, defaultProps, variants, controls, `render(props, options)`).
  - `controls`: playground knobs, `{ [prop]: { type: 'boolean' | 'enum' | 'text' | 'number' | 'date', label, options? } }`.
    Keys may be dotted paths into object props (`'episode.title'`); use
    `getControlValue(props, key)` / `setControlValue(props, key, value)`.
  - `bleed`: points the component paints outside `size` (card shadows: 24).
    To show the shadow, size the surface with `catalogSurfaceSize(entry)` and
    call `entry.render(props, { bleed: true })`; plain `render(props)` fills
    `entry.size` exactly and clips the shadow.
- The host must use the `native-surface/vite` preset (it aliases `react-native`
  and `react-native-svg`).

Dev harness: `pnpm --filter ignite-demo dev` (`#/`, `#/phone`, `#/screen`,
`#/c/<Name>/<variant>`, `?statusbar=0`).

Space Grotesk © The Space Grotesk Project Authors, SIL OFL 1.1
(`assets/fonts/LICENSE-SpaceGrotesk-OFL.txt`). Icon geometry from Lucide (ISC).
Cover art derived from the site design's generated images.
