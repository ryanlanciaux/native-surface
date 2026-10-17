/**
 * ignite-demo: a brand-new Ignite app (ignite-cli 11.5.0) running on
 * native-surface. Hosts import from here; app/ is the generated boilerplate.
 *
 *   import { NativeSurface } from 'native-surface'
 *   import { IgniteApp } from 'ignite-demo'
 *   <NativeSurface width={320} height={684} safeAreaInsets={{ top: 50 }}><IgniteApp /></NativeSurface>
 *
 * Vite hosts add `igniteDemo()` from 'ignite-demo/vite' (before nativeSurface()).
 */

// The embeddable app and the generated root.
export { IgniteApp } from "./IgniteApp"
export type { IgniteAppProps, IgniteRoute, LegacyTabName } from "./IgniteApp"
export { App } from "@/app"
export { StatusBar } from "./StatusBar"
export { device } from "./device"

// Startup (fonts, i18n): IgniteApp and catalog renders gate on it themselves.
export { loadIgnite, loadIgniteFonts, useIgniteFonts, useIgniteReady, isIgniteReady } from "./boot"

// Catalog for the site / playground.
export {
  componentCatalog,
  screenCatalog,
  getCatalogEntry,
  catalogSurfaceSize,
  getControlValue,
  setControlValue,
  covers,
  initialFavorites,
  LiveEpisodeCard,
  LiveToggle,
  LiveTextField,
  IgniteFrame,
} from "./catalog"
export type {
  AnyCatalogEntry,
  CatalogEntry,
  CatalogVariant,
  CatalogControl,
  CatalogControlType,
  CatalogControlOption,
  CatalogRenderOptions,
  EpisodeCardEntryProps,
  ToggleEntryProps,
  TextFieldEntryProps,
} from "./catalog"

// Episode data + the Ignite episode store (EpisodeContext).
export { rnrEpisodes as episodes, rnrFeed } from "./adapter/feed"
export type { DemoEpisode } from "./adapter/feed"
export { toEpisodeItem } from "./adapter/legacy"
export type { LegacyEpisode } from "./adapter/legacy"
export { EpisodeProvider, EpisodeSeedContext, useEpisodes, useEpisode } from "@/context/EpisodeContext"
export type { EpisodeContextType, EpisodeSeed } from "@/context/EpisodeContext"
export type { EpisodeItem } from "@/services/api/types"
export { episodeStore } from "./episodeStore"

// Theme.
export { lightTheme, darkTheme, lightTheme as theme } from "@/theme/theme"
export { ThemeProvider, useAppTheme } from "@/theme/context"
export { colors } from "@/theme/colors"
export { colors as colorsDark } from "@/theme/colorsDark"
export { spacing } from "@/theme/spacing"
export { typography } from "@/theme/typography"
export type { Theme } from "@/theme/types"

// Every boilerplate component, unmodified.
export { AutoImage } from "@/components/AutoImage"
export type { AutoImageProps } from "@/components/AutoImage"
export { Button } from "@/components/Button"
export type { ButtonProps } from "@/components/Button"
export { Card } from "@/components/Card"
export { EmptyState } from "@/components/EmptyState"
export { Header } from "@/components/Header"
export type { HeaderProps } from "@/components/Header"
export { Icon, PressableIcon, iconRegistry } from "@/components/Icon"
export type { IconTypes } from "@/components/Icon"
export { ListItem } from "@/components/ListItem"
export type { ListItemProps } from "@/components/ListItem"
export { Screen } from "@/components/Screen"
export type { ScreenProps } from "@/components/Screen"
export { Text } from "@/components/Text"
export type { TextProps } from "@/components/Text"
export { TextField } from "@/components/TextField"
export type { TextFieldProps } from "@/components/TextField"
export { Toggle } from "@/components/Toggle/Toggle"
export type { ToggleProps } from "@/components/Toggle/Toggle"
export { Switch } from "@/components/Toggle/Switch"
export { Checkbox } from "@/components/Toggle/Checkbox"
export { Radio } from "@/components/Toggle/Radio"
export { EpisodeCard, DemoPodcastListScreen } from "@/screens/DemoPodcastListScreen"

// Screens and navigators.
export { WelcomeScreen } from "@/screens/WelcomeScreen"
export { LoginScreen } from "@/screens/LoginScreen"
export { DemoShowroomScreen } from "@/screens/DemoShowroomScreen/DemoShowroomScreen"
export { DemoCommunityScreen } from "@/screens/DemoCommunityScreen"
export { DemoDebugScreen } from "@/screens/DemoDebugScreen"
export { AppNavigator } from "@/navigators/AppNavigator"
export { DemoNavigator } from "@/navigators/DemoNavigator"
