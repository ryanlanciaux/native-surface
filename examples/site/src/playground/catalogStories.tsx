// Adapter: ignite-demo's componentCatalog / screenCatalog as CSF3 story
// modules, so the playground runs on the same loader (packages/playground
// csf.ts) whether the app ships `*.stories.tsx` files or only the catalog.
// One module per entry; each catalog variant becomes a story (= state chip).
import { colors, componentCatalog, screenCatalog, useIgniteReady } from 'ignite-demo';
import type { AnyCatalogEntry, CatalogControl } from 'ignite-demo';
import { isValidElement, type ReactElement } from 'react';
import { View, useSurfaceInsets } from 'react-native';
import type { Args, Decorator, Meta, Story } from '@native-surface/playground/src/story-types';
import { usePlaygroundGlobals } from './globals';
import type { PlaygroundArgType, PlaygroundParameters } from './types';

/** Callback props each entry exposes; they become function args, so the action log wraps them. */
const HANDLER_ARGS: Record<string, string[]> = {
  EpisodeCard: ['onPressFavorite'],
  FavButton: ['onPress'],
  Toggle: ['onValueChange'],
  TabBar: ['onTabPress'],
  Button: ['onPress'],
  ListItem: ['onPress'],
  Header: ['onLeftPress', 'onRightPress'],
  TextField: ['onChangeText'],
  IgniteApp: ['onTabChange', 'onPressFavorite'],
};

/** OS chrome, not an app component: the playground's device frame draws it. */
const SKIP = new Set(['StatusBar']);

/** Deep copy of plain data; functions and other instances are kept by reference. */
export function cloneArgs<T>(v: T): T {
  if (Array.isArray(v)) return v.map(cloneArgs) as T;
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, cloneArgs(x)])) as T;
  }
  return v;
}

function argType(c: CatalogControl): PlaygroundArgType {
  switch (c.type) {
    case 'enum': {
      // Asset options (cover art) read as their file, e.g. `rnr-314.jpg`.
      const options = (c.options ?? []).map((o) =>
        typeof o.value === 'string' && /\.(png|jpe?g|webp|gif)(\?|$)/.test(o.value)
          ? { ...o, label: o.value.split('/').pop()!.split('?')[0]!.replace(/-[\w-]{8}(\.\w+)$/, '$1') }
          : o,
      );
      return {
        control: 'select',
        options: options.map((o) => o.label),
        mapping: Object.fromEntries(options.map((o) => [o.label, o.value])),
        description: c.label,
      };
    }
    case 'number':
      return { control: 'number', min: c.min, max: c.max, step: c.step, description: c.label };
    default:
      return { control: c.type, description: c.label };
  }
}

const exportName = (variant: string) =>
  variant.replace(/(^|[-_ ])(\w)/g, (_, __, ch: string) => ch.toUpperCase()).replace(/\W/g, '');

/**
 * `entry.render()` is `<Preview>{component}</Preview>`, and Preview paints the
 * app background for the catalog's own gallery. The playground draws its own
 * sheet (or none, for cards), so components keep only Preview's child — the
 * catalog's live wrapper, taps included.
 */
function catalogBody(element: ReactElement): ReactElement {
  const child = (element.props as { children?: unknown }).children;
  return isValidElement(child) ? child : element;
}

function CatalogStory({ entry, args }: { entry: AnyCatalogEntry; args: Args }) {
  const { theme } = usePlaygroundGlobals();
  // `theme` is the round-2 render option; older catalogs ignore it.
  const element = (entry.render as (p: Args, o: { theme: string }) => ReactElement)(args, { theme });
  if (entry.kind === 'screen') return element;
  return <IgniteReadyGate>{catalogBody(element)}</IgniteReadyGate>;
}

/** The generated app's boot gate (fonts + i18n) — replaces the hand-built IgniteFontGate. */
function IgniteReadyGate({ children }: { children: ReactElement }) {
  return useIgniteReady() ? children : null;
}

/** Screens that are not the whole app pad by the device's safe area, as Ignite's <Screen safeAreaEdges> would. */
function SafeAreaScreen({ children }: { children: ReactElement }) {
  const insets = useSurfaceInsets();
  return (
    <View style={{ flex: 1, paddingTop: insets.top, paddingBottom: insets.bottom, backgroundColor: colors.background }}>
      {children}
    </View>
  );
}
const safeArea: Decorator = (Story) => <SafeAreaScreen>{Story()}</SafeAreaScreen>;

function layoutOf(entry: AnyCatalogEntry): PlaygroundParameters['layout'] {
  if (entry.kind === 'screen' || entry.size.height >= 600) return 'fullscreen';
  if (entry.size.width >= 320) return 'fullwidth';
  if (entry.size.width >= 272) return 'padded';
  return 'centered';
}

export function catalogModule(entry: AnyCatalogEntry): Record<string, unknown> {
  const handlers = Object.fromEntries((HANDLER_ARGS[entry.name] ?? []).map((name) => [name, () => {}]));
  const layout = layoutOf(entry);
  const parameters: PlaygroundParameters = {
    kind: entry.kind,
    layout,
    surface: entry.bleed > 0 ? 'transparent' : 'sheet',
    bleed: entry.bleed,
    description: entry.description,
    usage: entry.usage,
    sourceNames: [entry.name, /<(\w+)/.exec(entry.usage)?.[1] ?? entry.name],
    catalog: true,
  };
  const args: Args = { ...cloneArgs(entry.defaultProps as Args), ...handlers };
  // The playground's device frame draws the status bar; the app pads by the insets.
  if (entry.name === 'IgniteApp') args.showStatusBar = false;
  const meta: Meta = {
    title: `${entry.kind === 'screen' ? 'Screens' : 'Components'}/${entry.name}`,
    args,
    // CSF files carry Storybook's wider ArgType (date control, mapping); the playground reads it as PlaygroundArgType.
    argTypes: Object.fromEntries(Object.entries(entry.controls).map(([key, c]) => [key, argType(c)])) as Meta['argTypes'],
    render: (a) => <CatalogStory entry={entry} args={a} />,
    decorators: entry.kind === 'screen' && entry.name !== 'IgniteApp' ? [safeArea] : [],
    parameters: parameters as unknown as Record<string, unknown>,
    order: entry.variants.map((v) => exportName(v.name)),
  };
  const mod: Record<string, unknown> = { default: meta };
  for (const v of entry.variants) {
    const story: Story = { name: v.name, args: cloneArgs(v.props as Args) };
    mod[exportName(v.name)] = story;
  }
  return mod;
}

/** Every catalog entry as `catalog/<Name>.stories.tsx` → module. */
export function catalogModules(): Map<string, Record<string, unknown>> {
  return new Map(
    [...componentCatalog, ...screenCatalog]
      .filter((e) => !SKIP.has(e.name))
      .map((e) => [`catalog/${e.name}.stories.tsx`, catalogModule(e)] as const),
  );
}
