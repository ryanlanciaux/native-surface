/**
 * native-surface adapter: the component/screen catalog the site and the
 * playground render. Every entry draws the generated app's REAL component
 * (app/components/*, the EpisodeCard from DemoPodcastListScreen, the screens
 * through the real navigators) inside the same providers app.tsx sets up.
 */
import { useEffect, useRef, useState } from "react"
import type { Dispatch, ReactElement, ReactNode, SetStateAction } from "react"
import { View } from "react-native"
import type { ViewStyle } from "react-native"
import { SafeAreaProvider } from "react-native-safe-area-context"

import { AutoImage } from "@/components/AutoImage"
import { Button } from "@/components/Button"
import { Card } from "@/components/Card"
import { EmptyState } from "@/components/EmptyState"
import { Header } from "@/components/Header"
import { Icon, iconRegistry } from "@/components/Icon"
import type { IconTypes } from "@/components/Icon"
import { ListItem } from "@/components/ListItem"
import { Text } from "@/components/Text"
import { TextField } from "@/components/TextField"
import { Checkbox } from "@/components/Toggle/Checkbox"
import { Radio } from "@/components/Toggle/Radio"
import { Switch } from "@/components/Toggle/Switch"
import { EpisodeProvider, EpisodeSeedContext, useEpisodes } from "@/context/EpisodeContext"
import { EpisodeCard } from "@/screens/DemoPodcastListScreen"
import type { EpisodeItem } from "@/services/api/types"
import { ThemeProvider } from "@/theme/context"
import { darkTheme, lightTheme } from "@/theme/theme"

import { rnrEpisodes, rnrInitialFavorites } from "./adapter/feed"
import { useIgniteReady } from "./boot"
import { device } from "./device"
import { IgniteApp } from "./IgniteApp"
import type { IgniteRoute } from "./IgniteApp"

export interface CatalogVariant<P> {
  /** Short id shown as a state pill, e.g. "default" / "favorited" / "pressed". */
  name: string
  description?: string
  /** Merged over defaultProps. */
  props: Partial<P>
}

export type CatalogControlType = "boolean" | "enum" | "text" | "number" | "date"

export interface CatalogControlOption {
  label: string
  /** `undefined` means "unset". */
  value: string | number | boolean | undefined
}

export interface CatalogControl {
  type: CatalogControlType
  label: string
  /** For `enum`. */
  options?: readonly CatalogControlOption[]
  /** For `number`. */
  min?: number
  max?: number
  step?: number
}

export interface CatalogRenderOptions {
  /**
   * Pad the preview by the entry's `bleed` so shadows are not clipped. The
   * host's surface must then be `catalogSurfaceSize(entry)`, not `entry.size`.
   */
  bleed?: boolean
  /** Light (default) or dark Ignite theme. */
  theme?: "light" | "dark"
  /** Size the frame to its content instead of filling the surface (measuring, docs layouts). */
  fit?: boolean
}

export interface CatalogEntry<P = Record<string, unknown>> {
  name: string
  kind: "component" | "screen"
  description: string
  /** The component's own box in points. */
  size: { width: number; height: number }
  /**
   * Points the component paints outside `size` (shadows), per side. Hosts that
   * show the shadow give the surface `size + 2 * bleed` (see
   * `catalogSurfaceSize`) and render with `{ bleed: true }`.
   */
  bleed: number
  /** JSX usage snippet for docs / the playground code panel. */
  usage: string
  defaultProps: P
  variants: CatalogVariant<P>[]
  /**
   * Playground knobs keyed by prop name, or a dotted path into an object prop
   * (`'episode.title'`). Read / write values with `getControlValue` /
   * `setControlValue`.
   */
  controls: Record<string, CatalogControl>
  /**
   * Renders the component (a React Native tree: mount it inside a
   * NativeSurface) in the Ignite providers, gated on fonts + i18n. State the
   * component owns (favorite, toggle value, text input) stays live, seeded
   * from props, so taps work without a host store.
   */
  render: (props?: Partial<P>, options?: CatalogRenderOptions) => ReactElement
}

/** Erases the props type so heterogeneous entries fit one array. */
export type AnyCatalogEntry = CatalogEntry<any> // eslint-disable-line @typescript-eslint/no-explicit-any

const themeFor = (scheme: "light" | "dark" | undefined) => (scheme === "dark" ? darkTheme : lightTheme)

/** app.tsx's providers around one component, on the theme background (fonts + i18n gated). */
export function IgniteFrame({
  scheme,
  bleed,
  fit = false,
  children,
}: {
  scheme: "light" | "dark"
  bleed: number
  fit?: boolean
  children: ReactNode
}) {
  const ready = useIgniteReady()
  const $frame: ViewStyle = { flex: fit ? 0 : 1, backgroundColor: themeFor(scheme).colors.background, padding: bleed }
  if (!ready) return <View style={$frame} />
  return (
    <SafeAreaProvider style={fit ? { flex: 0 } : undefined}>
      <ThemeProvider initialContext={scheme}>
        <View style={$frame}>{children}</View>
      </ThemeProvider>
    </SafeAreaProvider>
  )
}

/** A prop mirrored into local state, re-seeded whenever the prop changes. */
function useLive<T>(value: T): [T, Dispatch<SetStateAction<T>>] {
  const [live, setLive] = useState(value)
  useEffect(() => setLive(value), [value])
  return [live, setLive]
}

function entry<P>(
  e: Omit<CatalogEntry<P>, "render"> & { draw: (props: P, scheme: "light" | "dark") => ReactElement },
): CatalogEntry<P> {
  const { draw, ...rest } = e
  return {
    ...rest,
    render: (props, options) => {
      const scheme = options?.theme ?? "light"
      const merged = { ...e.defaultProps, ...props } as P
      if (e.kind === "screen") return draw(merged, scheme)
      return (
        <IgniteFrame scheme={scheme} bleed={options?.bleed ? e.bleed : 0} fit={options?.fit}>
          {draw(merged, scheme)}
        </IgniteFrame>
      )
    },
  }
}

/** Surface size for `render(props, { bleed: true })`: `size` plus the bleed on every side. */
export function catalogSurfaceSize(entry: AnyCatalogEntry): { width: number; height: number } {
  return { width: entry.size.width + 2 * entry.bleed, height: entry.size.height + 2 * entry.bleed }
}

/** Reads a control's value from props; `key` may be a dotted path (`'episode.title'`). */
export function getControlValue(props: object, key: string): unknown {
  return key.split(".").reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), props)
}

/** Returns a copy of props with the control's value set, copying each object along a dotted path. */
export function setControlValue<P extends object>(props: P, key: string, value: unknown): P {
  const [head, ...rest] = key.split(".") as [string, ...string[]]
  const current = props as Record<string, unknown>
  const next = rest.length ? setControlValue((current[head] as object | undefined) ?? {}, rest.join("."), value) : value
  return { ...props, [head]: next }
}

// #region Live wrappers (state the real component expects its parent to own)

export interface EpisodeCardEntryProps {
  episode: EpisodeItem
  /** Seeds the favorite state (the card reads it from EpisodeContext, as in the app). */
  isFavorite?: boolean
  /** Shows the card mid-press (TouchableOpacity's activeOpacity, 0.2). */
  pressed?: boolean
  onPressFavorite?: (episode: EpisodeItem, isFavorite: boolean) => void
}

function ConnectedEpisodeCard({ episode }: { episode: EpisodeItem }) {
  const { toggleFavorite } = useEpisodes()
  return <EpisodeCard episode={episode} onPressFavorite={() => toggleFavorite(episode)} />
}

/**
 * The app's EpisodeCard inside its own EpisodeProvider (one episode, favorites
 * live). A changed `episode` or `isFavorite` re-seeds that store.
 */
export function LiveEpisodeCard(props: EpisodeCardEntryProps) {
  return <SeededEpisodeCard key={`${JSON.stringify(props.episode)}:${!!props.isFavorite}`} {...props} />
}

function SeededEpisodeCard({ episode, isFavorite = false, pressed = false, onPressFavorite }: EpisodeCardEntryProps) {
  const onPress = useRef(onPressFavorite)
  onPress.current = onPressFavorite
  const [seed] = useState(() => ({
    episodes: [episode],
    initialFavorites: isFavorite ? [episode.guid] : [],
    onToggleFavorite: (ep: EpisodeItem, fav: boolean) => onPress.current?.(ep, fav),
  }))
  return (
    <EpisodeSeedContext.Provider value={seed}>
      <EpisodeProvider>
        {/* The card's own `marginTop` spaces list items; a standalone card starts at 0. */}
        <View style={{ marginTop: -16, opacity: pressed ? 0.2 : 1 }}>
          <ConnectedEpisodeCard episode={episode} />
        </View>
      </EpisodeProvider>
    </EpisodeSeedContext.Provider>
  )
}

export interface ToggleEntryProps {
  variant: "switch" | "checkbox" | "radio"
  label?: string
  helper?: string
  value?: boolean
  labelPosition?: "left" | "right"
  status?: "error" | "disabled"
  onValueChange?: (value: boolean) => void
}

/** Ignite's Toggle family (Switch / Checkbox / Radio), value kept live. */
export function LiveToggle({ variant, value = false, onValueChange, ...rest }: ToggleEntryProps) {
  const [on, setOn] = useLive(value)
  const props = {
    ...rest,
    value: on,
    onValueChange: (v: boolean) => {
      setOn(v)
      onValueChange?.(v)
    },
  }
  if (variant === "checkbox") return <Checkbox {...props} />
  if (variant === "radio") return <Radio {...props} />
  return <Switch {...props} />
}

export interface TextFieldEntryProps {
  label?: string
  placeholder?: string
  helper?: string
  status?: "error" | "disabled"
  value?: string
  onChangeText?: (text: string) => void
}

/** Ignite's TextField with its text kept live, so typing works. */
export function LiveTextField({ value = "", onChangeText, ...rest }: TextFieldEntryProps) {
  const [text, setText] = useLive(value)
  return (
    <TextField
      {...rest}
      value={text}
      onChangeText={(t) => {
        setText(t)
        onChangeText?.(t)
      }}
    />
  )
}

// #endregion

const opts = (values: readonly string[]): CatalogControlOption[] => values.map((v) => ({ label: v, value: v }))
const iconNames = Object.keys(iconRegistry) as IconTypes[]
const iconOptions: CatalogControlOption[] = [{ label: "none", value: undefined }, ...opts(iconNames)]
/** guid → bundled cover URL. */
export const covers: Record<string, string> = Object.fromEntries(rnrEpisodes.map((e) => [e.guid, e.thumbnail]))
const coverOptions: CatalogControlOption[] = Object.entries(covers).map(([guid, uri]) => ({ label: guid, value: uri }))
const remoteImage = (name: string) => new URL(`../assets/remote/${name}.png`, import.meta.url).href
const igniteLogo = remoteImage("188244137-a35ab1b9-658d-4701-b1dd-7caa51173fa9")
const igniteLogoAlt = remoteImage("184508739-f90d0ce5-7219-42fd-a91f-3382d016eae0")
const imageOptions: CatalogControlOption[] = [
  { label: "Ignite logo", value: igniteLogo },
  { label: "Ignite logo (alt)", value: igniteLogoAlt },
  ...coverOptions,
]
/** Ignite Card shadow: radius 12.81 at y+12 reaches ~25pt below the card. */
const CARD_BLEED = 28
// Default component width (the design's 272pt column). Hosts lay components
// out at their own device width minus the app's 24pt gutters (354 on iPhone 16 Pro).
const W = 272
const ep314 = rnrEpisodes[0]!
const screenSize = { width: device.screenWidth, height: device.screenHeight }

export const componentCatalog: AnyCatalogEntry[] = [
  entry<{ text: string; preset: string; size?: string; weight?: string }>({
    name: "Text",
    kind: "component",
    description: "Ignite's Text: presets, sizes and weights from the theme's typography (Space Grotesk), i18n via `tx`.",
    size: { width: W, height: 88 },
    bleed: 0,
    usage: `<Text preset="heading" tx="demoPodcastListScreen:title" />`,
    defaultProps: { text: "React Native Radio episodes", preset: "heading" },
    variants: [
      { name: "heading", props: { preset: "heading" } },
      { name: "subheading", props: { preset: "subheading", text: "Components to jump start your project!" } },
      { name: "default", props: { preset: "default", text: "The same layout engine. Real Skia pixels." } },
      { name: "bold", props: { preset: "bold", text: "Only Show Favorites" } },
    ],
    controls: {
      text: { type: "text", label: "Text" },
      preset: { type: "enum", label: "Preset", options: opts(["default", "bold", "heading", "subheading", "formLabel", "formHelper"]) },
      size: { type: "enum", label: "Size", options: [{ label: "preset", value: undefined }, ...opts(["xxl", "xl", "lg", "md", "sm", "xs", "xxs"])] },
      weight: { type: "enum", label: "Weight", options: [{ label: "preset", value: undefined }, ...opts(["light", "normal", "medium", "semiBold", "bold"])] },
    },
    draw: (p) => <Text {...(p as object)} />,
  }),
  entry<{ text: string; preset: "default" | "filled" | "reversed"; disabled?: boolean; onPress?: () => void }>({
    name: "Button",
    kind: "component",
    description: "Ignite's Button: default / filled / reversed presets with pressed styles, optional accessories.",
    size: { width: W, height: 56 },
    bleed: 0,
    usage: `<Button preset="reversed" tx="welcomeScreen:letsGo" onPress={goToDemo} />`,
    defaultProps: { text: "Let's go!", preset: "reversed" },
    variants: [
      { name: "reversed", props: { preset: "reversed" } },
      { name: "default", props: { preset: "default" } },
      { name: "filled", props: { preset: "filled" } },
      { name: "disabled", props: { preset: "reversed", disabled: true } },
    ],
    controls: {
      text: { type: "text", label: "Text" },
      preset: { type: "enum", label: "Preset", options: opts(["default", "filled", "reversed"]) },
      disabled: { type: "boolean", label: "Disabled" },
    },
    draw: (p) => <Button {...p} />,
  }),
  entry<{ heading: string; content: string; footer: string; preset: "default" | "reversed"; verticalAlignment: "top" | "center" | "space-between" | "force-footer-bottom" }>({
    name: "Card",
    kind: "component",
    description: "Ignite's Card: heading / content / footer slots or components, default and reversed presets, a soft shadow.",
    size: { width: W, height: 144 },
    bleed: CARD_BLEED,
    usage: `<Card heading="Card" content="Content" footer="Footer" preset="default" />`,
    defaultProps: {
      heading: "Yoga, Skia and the canvas",
      content: "Yoga lays out React Native on iOS and Android. Here it runs in wasm, and Skia paints the result.",
      footer: "Jun 29, 2023",
      preset: "default",
      verticalAlignment: "top",
    },
    variants: [
      { name: "default", props: { preset: "default" } },
      { name: "reversed", props: { preset: "reversed" } },
    ],
    controls: {
      heading: { type: "text", label: "Heading" },
      content: { type: "text", label: "Content" },
      footer: { type: "text", label: "Footer" },
      preset: { type: "enum", label: "Preset", options: opts(["default", "reversed"]) },
      verticalAlignment: { type: "enum", label: "Vertical alignment", options: opts(["top", "center", "space-between", "force-footer-bottom"]) },
    },
    draw: (p) => <Card {...p} />,
  }),
  entry<EpisodeCardEntryProps>({
    name: "EpisodeCard",
    kind: "component",
    description:
      "The podcast list's card from DemoPodcastListScreen: date and duration, title, cover art, an animated Favorite / Unfavorite button (long-press the card too).",
    size: { width: W, height: 192 },
    bleed: CARD_BLEED,
    usage: `const { toggleFavorite } = useEpisodes()

<EpisodeCard episode={episode} onPressFavorite={() => toggleFavorite(episode)} />`,
    defaultProps: { episode: ep314, isFavorite: false, pressed: false },
    variants: [
      { name: "default", props: {} },
      { name: "favorited", props: { isFavorite: true } },
      { name: "pressed", description: "Mid-press: the card's TouchableOpacity at activeOpacity", props: { pressed: true } },
    ],
    controls: {
      "episode.title": { type: "text", label: "Title" },
      "episode.pubDate": { type: "date", label: "Published" },
      "episode.enclosure.duration": { type: "number", label: "Duration (s)", min: 0, max: 14400, step: 1 },
      "episode.thumbnail": { type: "enum", label: "Cover", options: coverOptions },
      isFavorite: { type: "boolean", label: "Favorited" },
      pressed: { type: "boolean", label: "Pressed" },
    },
    draw: (p) => <LiveEpisodeCard {...p} />,
  }),
  entry<{ title: string; leftIcon?: IconTypes; rightIcon?: IconTypes; rightText?: string; titleMode: "center" | "flex" }>({
    name: "Header",
    kind: "component",
    description: "Ignite's Header: title with left / right actions (icon, text or component), safe-area aware.",
    size: { width: device.screenWidth, height: 56 },
    bleed: 0,
    usage: `<Header title="Podcasts" leftIcon="back" onLeftPress={goBack} rightText="Edit" />`,
    defaultProps: { title: "Podcasts", leftIcon: "back", rightIcon: "more", titleMode: "center" },
    variants: [
      { name: "icons", props: {} },
      { name: "text", props: { rightIcon: undefined, rightText: "Edit" } },
      { name: "flex", props: { titleMode: "flex", rightIcon: undefined } },
    ],
    controls: {
      title: { type: "text", label: "Title" },
      leftIcon: { type: "enum", label: "Left icon", options: iconOptions },
      rightIcon: { type: "enum", label: "Right icon", options: iconOptions },
      rightText: { type: "text", label: "Right text" },
      titleMode: { type: "enum", label: "Title mode", options: opts(["center", "flex"]) },
    },
    draw: (p) => <Header {...p} safeAreaEdges={[]} onLeftPress={() => {}} onRightPress={() => {}} />,
  }),
  entry<{ text: string; leftIcon?: IconTypes; rightIcon?: IconTypes; topSeparator?: boolean; bottomSeparator?: boolean }>({
    name: "ListItem",
    kind: "component",
    description: "Ignite's ListItem: a row with optional left/right icons or components and separators.",
    size: { width: W, height: 58 },
    bleed: 0,
    usage: `<ListItem text="Join us on Slack" leftIcon="slack" rightIcon="caretRight" bottomSeparator />`,
    defaultProps: { text: "Join us on Slack", leftIcon: "slack", rightIcon: "caretRight", bottomSeparator: true },
    variants: [
      { name: "icons", props: {} },
      { name: "plain", props: { leftIcon: undefined, rightIcon: undefined } },
      { name: "separators", props: { topSeparator: true, bottomSeparator: true } },
    ],
    controls: {
      text: { type: "text", label: "Text" },
      leftIcon: { type: "enum", label: "Left icon", options: iconOptions },
      rightIcon: { type: "enum", label: "Right icon", options: iconOptions },
      topSeparator: { type: "boolean", label: "Top separator" },
      bottomSeparator: { type: "boolean", label: "Bottom separator" },
    },
    draw: (p) => <ListItem {...p} onPress={() => {}} />,
  }),
  entry<TextFieldEntryProps>({
    name: "TextField",
    kind: "component",
    description: "Ignite's TextField: label, helper, placeholder, error / disabled status, accessories. Typing works.",
    size: { width: W, height: 106 },
    bleed: 0,
    usage: `<TextField value={email} onChangeText={setEmail} labelTx="loginScreen:emailFieldLabel" helper={error} status={error ? "error" : undefined} />`,
    defaultProps: { label: "Email", placeholder: "you@example.com", helper: "We'll never share it.", value: "" },
    variants: [
      { name: "default", props: {} },
      { name: "filled", props: { value: "ignite@infinite.red" } },
      { name: "error", props: { status: "error", value: "ignite@", helper: "must be a valid email address" } },
      { name: "disabled", props: { status: "disabled", value: "ignite@infinite.red" } },
    ],
    controls: {
      label: { type: "text", label: "Label" },
      placeholder: { type: "text", label: "Placeholder" },
      helper: { type: "text", label: "Helper" },
      value: { type: "text", label: "Value" },
      status: { type: "enum", label: "Status", options: [{ label: "none", value: undefined }, ...opts(["error", "disabled"])] },
    },
    draw: (p) => <LiveTextField key={`${p.value}`} {...p} />,
  }),
  entry<ToggleEntryProps>({
    name: "Toggle",
    kind: "component",
    description: "Ignite's Toggle family: Switch (the podcast list's 'Only Show Favorites'), Checkbox and Radio, with label / helper / status.",
    size: { width: W, height: 32 },
    bleed: 0,
    usage: `<Switch value={favoritesOnly} onValueChange={toggleFavoritesOnly} labelTx="demoPodcastListScreen:onlyFavorites" labelPosition="left" />`,
    defaultProps: { variant: "switch", label: "Only Show Favorites", labelPosition: "left", value: false },
    variants: [
      { name: "off", props: {} },
      { name: "on", props: { value: true } },
      { name: "checkbox", props: { variant: "checkbox", labelPosition: "right", label: "Remember me", value: true } },
      { name: "radio", props: { variant: "radio", labelPosition: "right", label: "Light theme", value: true } },
    ],
    controls: {
      variant: { type: "enum", label: "Variant", options: opts(["switch", "checkbox", "radio"]) },
      label: { type: "text", label: "Label" },
      helper: { type: "text", label: "Helper" },
      value: { type: "boolean", label: "On" },
      labelPosition: { type: "enum", label: "Label position", options: opts(["left", "right"]) },
      status: { type: "enum", label: "Status", options: [{ label: "none", value: undefined }, ...opts(["error", "disabled"])] },
    },
    draw: (p) => <LiveToggle {...p} />,
  }),
  entry<{ uri: string; maxWidth?: number; maxHeight?: number }>({
    name: "AutoImage",
    kind: "component",
    description: "Ignite's AutoImage: sizes a remote image to its aspect ratio within maxWidth / maxHeight.",
    size: { width: W, height: 146 },
    bleed: 0,
    usage: `<AutoImage maxWidth={272} source={{ uri: "https://…/ignite.png" }} />`,
    defaultProps: { uri: igniteLogo, maxWidth: W },
    variants: [
      { name: "maxWidth", props: {} },
      { name: "maxHeight", props: { maxWidth: undefined, maxHeight: 80 } },
    ],
    controls: {
      uri: { type: "enum", label: "Image", options: imageOptions },
      maxWidth: { type: "number", label: "Max width", min: 16, max: W, step: 1 },
      maxHeight: { type: "number", label: "Max height", min: 16, max: 300, step: 1 },
    },
    draw: ({ uri, ...p }) => <AutoImage {...p} source={{ uri }} />,
  }),
  entry<{ icon: IconTypes; size: number; color?: string }>({
    name: "Icon",
    kind: "component",
    description: "Ignite's Icon: the registered PNG icon set (1x/2x/3x), tinted.",
    size: { width: 48, height: 48 },
    bleed: 0,
    usage: `<Icon icon="podcast" color={colors.tint} size={30} />`,
    defaultProps: { icon: "podcast", size: 30 },
    variants: [
      { name: "podcast", props: {} },
      { name: "heart", props: { icon: "heart", color: "#C76542" } },
      { name: "components", props: { icon: "components" } },
    ],
    controls: {
      icon: { type: "enum", label: "Icon", options: opts(iconNames) },
      size: { type: "number", label: "Size", min: 8, max: 48, step: 1 },
      color: { type: "text", label: "Color" },
    },
    draw: (p) => (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <Icon {...p} />
      </View>
    ),
  }),
  entry<{ heading?: string; content?: string; button?: string }>({
    name: "EmptyState",
    kind: "component",
    description: "Ignite's EmptyState: image, heading, content and a retry button (the filtered podcast list shows it).",
    size: { width: W, height: 370 },
    bleed: 0,
    usage: `<EmptyState preset="generic" headingTx="demoPodcastListScreen:noFavoritesEmptyState.heading" buttonOnPress={refresh} />`,
    defaultProps: {},
    variants: [
      { name: "generic", props: {} },
      { name: "favorites", props: { heading: "This looks a bit empty", content: "No favorites have been added yet. Tap the heart on an episode to add it to your favorites!", button: "" } },
    ],
    controls: {
      heading: { type: "text", label: "Heading" },
      content: { type: "text", label: "Content" },
      button: { type: "text", label: "Button" },
    },
    draw: (p) => <EmptyState preset="generic" {...p} buttonOnPress={() => {}} />,
  }),
]

interface ScreenEntryProps {
  showStatusBar?: boolean
  initialFavorites?: readonly string[]
  onPressFavorite?: (episode: EpisodeItem, isFavorite: boolean) => void
}

function screen(name: string, route: IgniteRoute, description: string): AnyCatalogEntry {
  return entry<ScreenEntryProps>({
    name,
    kind: "screen",
    description,
    size: screenSize,
    bleed: 0,
    usage: `<NativeSurface width={${device.screenWidth}} height={${device.screenHeight}} safeAreaInsets={{ top: ${device.safeAreaInsets.top}, bottom: ${device.safeAreaInsets.bottom} }}>\n  <IgniteApp initialRoute="${route}" />\n</NativeSurface>`,
    defaultProps: { showStatusBar: true },
    variants: [{ name: "default", props: {} }],
    controls: { showStatusBar: { type: "boolean", label: "Status bar" } },
    // The real app at that route: navigators, providers and all.
    draw: (p, scheme) => <IgniteApp key={`${scheme}:${p.showStatusBar}`} {...p} theme={scheme} initialRoute={route} />,
  })
}

export const screenCatalog: AnyCatalogEntry[] = [
  screen("WelcomeScreen", "Welcome", "The generated app's welcome screen; \"Let's go!\" opens the demo tabs."),
  screen("LoginScreen", "Login", "Sign-in (fresh install): prefilled demo credentials, validation, \"Tap to log in!\"."),
  screen("DemoShowroomScreen", "DemoShowroom", "Components tab: every boilerplate component with its use cases, drawer navigation."),
  screen("DemoPodcastListScreen", "DemoPodcastList", "Podcasts tab: React Native Radio episodes, favorites and the 'Only Show Favorites' filter."),
  screen("DemoCommunityScreen", "DemoCommunity", "Community tab: Infinite Red community links."),
  screen("DemoDebugScreen", "DemoDebug", "Debug tab: app info, theme toggle, Reactotron, log out."),
]

export function getCatalogEntry(name: string): AnyCatalogEntry | undefined {
  return [...componentCatalog, ...screenCatalog].find((e) => e.name === name)
}

export { rnrInitialFavorites as initialFavorites }
