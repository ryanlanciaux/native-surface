import * as React from 'react';
import { StyleSheet, View } from 'react-native';
import { IgniteApp } from './app/IgniteApp';
import type { IgniteAppProps } from './app/IgniteApp';
import { CommunityScreen } from './app/screens/CommunityScreen';
import { ComponentsScreen } from './app/screens/ComponentsScreen';
import { DebugScreen } from './app/screens/DebugScreen';
import { PodcastsScreen } from './app/screens/PodcastsScreen';
import {
  AutoImage,
  Button,
  Card,
  EpisodeCard,
  FavButton,
  Header,
  Heading,
  Icon,
  ListItem,
  Screen,
  StatusBar,
  TabBar,
  Text,
  TextField,
  Toggle,
} from './components';
import type {
  AutoImageProps,
  ButtonProps,
  CardProps,
  EpisodeCardProps,
  FavButtonProps,
  HeaderProps,
  HeadingProps,
  IconProps,
  ListItemProps,
  ScreenProps,
  StatusBarProps,
  TabBarProps,
  TabName,
  TextFieldProps,
  TextProps,
  ToggleProps,
} from './components';
import { episodes, initialFavorites } from './data/episodes';
import type { Episode } from './data/episodes';
import { IgniteFontGate } from './fonts';
import { colors, device } from './theme';

export interface CatalogVariant<P> {
  /** Short id shown as a state pill, e.g. "default" / "favorited" / "pressed". */
  name: string;
  description?: string;
  /** Merged over defaultProps. */
  props: Partial<P>;
}

export interface CatalogEntry<P = Record<string, unknown>> {
  name: string;
  kind: 'component' | 'screen';
  description: string;
  /** Suggested preview surface size in points (the design's frame size). */
  size: { width: number; height: number };
  /** JSX usage snippet for docs / the playground code panel. */
  usage: string;
  defaultProps: P;
  variants: CatalogVariant<P>[];
  /**
   * Renders the component (React Native tree, mount it inside a
   * NativeSurface). Gated on the Space Grotesk fonts. Boolean state the
   * component exposes (isFavorite, value, active tab) is kept live inside the
   * preview, seeded from props, so taps work without a host store.
   */
  render: (props?: Partial<P>) => React.ReactElement;
}

/** Erases the props type so heterogeneous entries fit one array. */
export type AnyCatalogEntry = CatalogEntry<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function Preview({ children }: { children: React.ReactNode }) {
  return (
    <IgniteFontGate>
      <View style={styles.preview}>{children}</View>
    </IgniteFontGate>
  );
}

/** A prop mirrored into local state, re-seeded whenever the prop changes. */
function useLive<T>(value: T): [T, (v: T) => void] {
  const [live, setLive] = React.useState(value);
  React.useEffect(() => setLive(value), [value]);
  return [live, setLive];
}

function LiveFavButton(props: FavButtonProps) {
  const [fav, setFav] = useLive(!!props.isFavorite);
  return (
    <FavButton
      {...props}
      isFavorite={fav}
      onPress={() => {
        setFav(!fav);
        props.onPress?.();
      }}
    />
  );
}

function LiveEpisodeCard(props: EpisodeCardProps) {
  const [fav, setFav] = useLive(!!props.isFavorite);
  return (
    <EpisodeCard
      {...props}
      isFavorite={fav}
      onPressFavorite={(ep) => {
        setFav(!fav);
        props.onPressFavorite?.(ep);
      }}
    />
  );
}

function LiveToggle(props: ToggleProps) {
  const [on, setOn] = useLive(!!(props.value ?? props.defaultValue));
  return (
    <Toggle
      {...props}
      value={on}
      onValueChange={(v) => {
        setOn(v);
        props.onValueChange?.(v);
      }}
    />
  );
}

function LiveTabBar(props: TabBarProps) {
  const [active, setActive] = useLive<TabName>(props.active ?? 'Podcasts');
  return (
    <TabBar
      {...props}
      active={active}
      onTabPress={(t) => {
        setActive(t);
        props.onTabPress?.(t);
      }}
    />
  );
}

function LivePodcasts() {
  const [favorites, setFavorites] = React.useState<ReadonlySet<string>>(() => new Set(initialFavorites));
  const [only, setOnly] = React.useState(false);
  return (
    <PodcastsScreen
      episodes={episodes}
      favorites={favorites}
      onToggleFavorite={(e: Episode) => {
        const next = new Set(favorites);
        if (next.has(e.guid)) next.delete(e.guid);
        else next.add(e.guid);
        setFavorites(next);
      }}
      favoritesOnly={only}
      onFavoritesOnlyChange={setOnly}
    />
  );
}

function LiveDebug() {
  const [count, setCount] = React.useState(initialFavorites.length);
  const [bar, setBar] = React.useState(false);
  return (
    <DebugScreen
      favoritesCount={count}
      episodesCount={episodes.length}
      onResetFavorites={() => setCount(initialFavorites.length)}
      onFavoriteAll={() => setCount(episodes.length)}
      showStatusBar={bar}
      onShowStatusBarChange={setBar}
    />
  );
}

function entry<P>(e: Omit<CatalogEntry<P>, 'render'> & { draw: (props: P) => React.ReactElement }): CatalogEntry<P> {
  const { draw, ...rest } = e;
  return {
    ...rest,
    render: (props) => <Preview>{draw({ ...e.defaultProps, ...props })}</Preview>,
  };
}

const ep314 = episodes[0]!;
const screenSize = { width: device.screenWidth, height: device.screenHeight };

export const componentCatalog: AnyCatalogEntry[] = [
  entry<HeadingProps>({
    name: 'Heading',
    kind: 'component',
    description: 'Screen title: <Text preset="heading" />, Space Grotesk Bold 30 / 112%.',
    size: { width: 272, height: 68 },
    usage: '<Text preset="heading" text="React Native Radio episodes" />',
    defaultProps: { text: 'React Native Radio episodes' },
    variants: [
      { name: 'default', props: {} },
      { name: 'short', props: { text: 'Components' } },
    ],
    draw: (p) => <Heading {...p} />,
  }),
  entry<ToggleProps>({
    name: 'Toggle',
    kind: 'component',
    description: 'Labelled switch / checkbox / radio with an animated control. Controlled or uncontrolled.',
    size: { width: 272, height: 33 },
    usage: '<Toggle variant="switch" label="Only Show Favorites" value={showFavorites} onValueChange={setShowFavorites} />',
    defaultProps: { variant: 'switch', label: 'Only Show Favorites', value: false },
    variants: [
      { name: 'off', props: { value: false } },
      { name: 'on', props: { value: true } },
      { name: 'checkbox', props: { variant: 'checkbox', label: 'Remember me', value: true } },
      { name: 'radio', props: { variant: 'radio', label: 'Daily digest', value: true } },
      { name: 'disabled', props: { disabled: true } },
    ],
    draw: (p) => <LiveToggle {...p} />,
  }),
  entry<FavButtonProps>({
    name: 'FavButton',
    kind: 'component',
    description: 'Like / Unlike pill with a heart; tinted when favorited.',
    size: { width: 74, height: 32 },
    usage: '<FavButton isFavorite={isFavorite} onPress={toggleFavorite} />',
    defaultProps: { isFavorite: false },
    variants: [
      { name: 'like', props: { isFavorite: false } },
      { name: 'unlike', props: { isFavorite: true } },
    ],
    draw: (p) => <LiveFavButton {...p} />,
  }),
  entry<EpisodeCardProps>({
    name: 'EpisodeCard',
    kind: 'component',
    description: 'Podcast episode: date · duration, title, FavButton and circular cover art.',
    size: { width: 272, height: 140 },
    usage:
      '<EpisodeCard\n  episode={episodeStore.episodes[0]}\n  isFavorite={true}\n  onPressFavorite={() => episodeStore.toggleFavorite(episode)}\n/>',
    defaultProps: { episode: ep314, isFavorite: false },
    variants: [
      { name: 'default', props: { isFavorite: false } },
      { name: 'favorited', props: { isFavorite: true } },
      { name: 'pressed', props: { pressed: true } },
    ],
    draw: (p) => <LiveEpisodeCard {...p} />,
  }),
  entry<TabBarProps>({
    name: 'TabBar',
    kind: 'component',
    description: 'Bottom navigator: Components / Community / Podcasts / Debug, icons above labels.',
    size: { width: 320, height: 75 },
    usage: '<TabBar active="Podcasts" onTabPress={navigation.navigate} />',
    defaultProps: { active: 'Podcasts' },
    variants: [
      { name: 'podcasts', props: { active: 'Podcasts' } },
      { name: 'components', props: { active: 'Components' } },
      { name: 'community', props: { active: 'Community' } },
      { name: 'debug', props: { active: 'Debug' } },
    ],
    draw: (p) => <LiveTabBar {...p} />,
  }),
  entry<ButtonProps>({
    name: 'Button',
    kind: 'component',
    description: 'Pressable button in default (outlined), filled and reversed presets.',
    size: { width: 272, height: 48 },
    usage: '<Button preset="filled" text="Subscribe" onPress={subscribe} />',
    defaultProps: { text: 'Button', preset: 'default' },
    variants: [
      { name: 'default', props: { preset: 'default' } },
      { name: 'filled', props: { preset: 'filled', text: 'Filled' } },
      { name: 'reversed', props: { preset: 'reversed', text: 'Reversed' } },
      { name: 'icon', props: { preset: 'filled', text: 'Favorite all', leftIcon: 'heart' } },
      { name: 'disabled', props: { disabled: true } },
    ],
    draw: (p) => <Button {...p} />,
  }),
  entry<ScreenProps>({
    name: 'Screen',
    kind: 'component',
    description: 'Screen container: scrolling or fixed, padded by the surface safe-area insets.',
    size: screenSize,
    usage: '<Screen preset="scroll" safeAreaEdges={["top"]}>{children}</Screen>',
    defaultProps: { preset: 'scroll', safeAreaEdges: ['top'] },
    variants: [
      { name: 'scroll', props: { preset: 'scroll' } },
      { name: 'fixed', props: { preset: 'fixed' } },
    ],
    draw: (p) => (
      <Screen {...p} contentContainerStyle={styles.screenContent}>
        <Heading text={p.preset === 'fixed' ? 'Fixed screen' : 'Scrolling screen'} />
        {episodes.map((e) => (
          <EpisodeCard key={e.guid} episode={e} />
        ))}
      </Screen>
    ),
  }),
  entry<TextProps>({
    name: 'Text',
    kind: 'component',
    description: 'Themed text with presets (default, bold, heading, subheading, title, meta, formLabel, formHelper).',
    size: { width: 272, height: 40 },
    usage: '<Text preset="heading" text="Hello" />',
    defaultProps: { preset: 'default', text: 'The quick brown fox' },
    variants: [
      { name: 'default', props: {} },
      { name: 'heading', props: { preset: 'heading', text: 'Heading' } },
      { name: 'subheading', props: { preset: 'subheading', text: 'Subheading' } },
      { name: 'meta', props: { preset: 'meta', text: 'Jul 13, 2023 · 47:02' } },
    ],
    draw: (p) => <Text {...p} />,
  }),
  entry<CardProps>({
    name: 'Card',
    kind: 'component',
    description: 'Surface with heading / content / footer slots.',
    size: { width: 272, height: 120 },
    usage: '<Card heading="Heading" content="Content" footer="Footer" />',
    defaultProps: { heading: 'Card heading', content: 'Cards hold a heading, content and a footer.', footer: 'Footer' },
    variants: [{ name: 'default', props: {} }],
    draw: (p) => <Card {...p} />,
  }),
  entry<ListItemProps>({
    name: 'ListItem',
    kind: 'component',
    description: 'Row with optional icons, value and separators.',
    size: { width: 272, height: 56 },
    usage: '<ListItem text="Settings" leftIcon="info" onPress={open} />',
    defaultProps: { text: 'List item', leftIcon: 'star', onPress: () => {} },
    variants: [
      { name: 'default', props: {} },
      { name: 'value', props: { value: '42', onPress: undefined } },
    ],
    draw: (p) => <ListItem {...p} />,
  }),
  entry<TextFieldProps>({
    name: 'TextField',
    kind: 'component',
    description: 'Labelled text input with helper and error state.',
    size: { width: 272, height: 100 },
    usage: '<TextField label="Email" placeholder="you@example.com" value={email} onChangeText={setEmail} />',
    defaultProps: { label: 'Email', placeholder: 'you@example.com', helper: 'One email a week. No spam.' },
    variants: [
      { name: 'default', props: {} },
      { name: 'error', props: { status: 'error', value: 'nope', helper: 'That does not look like an email address.' } },
    ],
    draw: (p) => <TextField {...p} />,
  }),
  entry<HeaderProps>({
    name: 'Header',
    kind: 'component',
    description: 'Navigation header with centered title and optional actions.',
    size: { width: 320, height: 56 },
    usage: '<Header title="Episodes" rightIcon="search" onRightPress={search} />',
    defaultProps: { title: 'Episodes', rightIcon: 'search' },
    variants: [{ name: 'default', props: {} }],
    draw: (p) => <Header {...p} />,
  }),
  entry<AutoImageProps>({
    name: 'AutoImage',
    kind: 'component',
    description: 'Image that sizes itself from its intrinsic aspect ratio within max bounds.',
    size: { width: 96, height: 96 },
    usage: '<AutoImage uri={episode.cover} maxWidth={96} />',
    defaultProps: { uri: ep314.cover, maxWidth: 96 },
    variants: [{ name: 'default', props: {} }],
    draw: (p) => <AutoImage {...p} />,
  }),
  entry<IconProps>({
    name: 'Icon',
    kind: 'component',
    description: 'Vector icon (react-native-svg) from the app icon registry.',
    size: { width: 24, height: 24 },
    usage: '<Icon icon="podcast" size={22} color={colors.tint} />',
    defaultProps: { icon: 'podcast', size: 24, color: colors.tint },
    variants: [
      { name: 'podcast', props: {} },
      { name: 'heart', props: { icon: 'heart', color: colors.text } },
    ],
    draw: (p) => <Icon {...p} />,
  }),
  entry<StatusBarProps>({
    name: 'StatusBar',
    kind: 'component',
    description: 'The 50pt iOS status bar drawn in-app: 9:41, dynamic island, indicators.',
    size: { width: 320, height: 50 },
    usage: '<StatusBar time="9:41" />',
    defaultProps: { time: '9:41', showIsland: true },
    variants: [{ name: 'default', props: {} }],
    draw: (p) => <StatusBar {...p} />,
  }),
];

export const screenCatalog: AnyCatalogEntry[] = [
  entry<IgniteAppProps>({
    name: 'IgniteApp',
    kind: 'screen',
    description: 'The whole app: tab bar navigation over four screens.',
    size: screenSize,
    usage: '<IgniteApp showStatusBar />',
    defaultProps: { showStatusBar: true },
    variants: [
      { name: 'podcasts', props: { initialTab: 'Podcasts' } },
      { name: 'components', props: { initialTab: 'Components' } },
    ],
    draw: (p) => <IgniteApp {...p} />,
  }),
  entry<Record<string, never>>({
    name: 'DemoPodcastListScreen',
    kind: 'screen',
    description: 'React Native Radio episodes with a working favorites filter.',
    size: screenSize,
    usage: '<PodcastsScreen episodes={episodes} favorites={favorites} … />',
    defaultProps: {},
    variants: [{ name: 'default', props: {} }],
    draw: () => <LivePodcasts />,
  }),
  entry<Record<string, never>>({
    name: 'DemoShowroomScreen',
    kind: 'screen',
    description: 'Every component, live.',
    size: screenSize,
    usage: '<ComponentsScreen />',
    defaultProps: {},
    variants: [{ name: 'default', props: {} }],
    draw: () => <ComponentsScreen />,
  }),
  entry<Record<string, never>>({
    name: 'DemoCommunityScreen',
    kind: 'screen',
    description: 'Community channels and a validated newsletter form.',
    size: screenSize,
    usage: '<CommunityScreen />',
    defaultProps: {},
    variants: [{ name: 'default', props: {} }],
    draw: () => <CommunityScreen />,
  }),
  entry<Record<string, never>>({
    name: 'DemoDebugScreen',
    kind: 'screen',
    description: 'Surface facts and state controls.',
    size: screenSize,
    usage: '<DebugScreen … />',
    defaultProps: {},
    variants: [{ name: 'default', props: {} }],
    draw: () => <LiveDebug />,
  }),
];

export function getCatalogEntry(name: string): AnyCatalogEntry | undefined {
  return componentCatalog.find((e) => e.name === name) ?? screenCatalog.find((e) => e.name === name);
}

const styles = StyleSheet.create({
  preview: { flex: 1, backgroundColor: colors.background, justifyContent: 'center' },
  screenContent: { paddingTop: 10, paddingHorizontal: 24, paddingBottom: 24, gap: 14 },
});
