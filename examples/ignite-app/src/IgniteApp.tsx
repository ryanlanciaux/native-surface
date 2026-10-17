/**
 * native-surface adapter: the generated app's root (app/app.tsx) for hosts
 * that embed it. Same provider tree and the same AppNavigator, minus what an
 * embedded surface must not share with the host page or with other instances:
 * no URL linking, no persisted navigation state, and per-instance auth state.
 * Theme, starting route and episode data come from props.
 *
 * app/app.tsx itself is untouched and still runs as-is (dev harness `#/app`),
 * Login screen first, exactly like a fresh install.
 */
import "@/utils/gestureHandler"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { ReactNode } from "react"
import { View } from "react-native"
import { KeyboardProvider } from "react-native-keyboard-controller"
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context"
import type { NavigationState, PartialState } from "@react-navigation/native"

import { AuthContext, type AuthContextType } from "@/context/AuthContext"
import { EpisodeSeedContext, type EpisodeSeed } from "@/context/EpisodeContext"
import { AppNavigator } from "@/navigators/AppNavigator"
import type { AppStackParamList, DemoTabParamList } from "@/navigators/navigationTypes"
import { getActiveRouteName } from "@/navigators/navigationUtilities"
import type { EpisodeItem } from "@/services/api/types"
import { ThemeProvider, useAppTheme } from "@/theme/context"
import { darkTheme, lightTheme } from "@/theme/theme"
import { storage } from "@/utils/storage"

import { demoEpisodes, demoInitialFavorites } from "./adapter/feed"
import { toEpisodeItem, type LegacyEpisode } from "./adapter/legacy"
import { useIgniteReady } from "./boot"
import { StatusBar } from "./StatusBar"
import { device } from "./device"

export type IgniteRoute = "Login" | "Welcome" | keyof DemoTabParamList
/** The hand-built app's tab names, still accepted by `initialTab`. */
export type LegacyTabName = "Components" | "Community" | "Podcasts" | "Debug"

const LEGACY_TABS: Record<LegacyTabName, keyof DemoTabParamList> = {
  Components: "DemoShowroom",
  Community: "DemoCommunity",
  Podcasts: "DemoPodcastList",
  Debug: "DemoDebug",
}
const TAB_TO_LEGACY = Object.fromEntries(
  Object.entries(LEGACY_TABS).map(([k, v]) => [v, k]),
) as Record<keyof DemoTabParamList, LegacyTabName>

export interface IgniteAppProps {
  /** Light or dark Ignite theme. Default "light". The Debug tab's "Toggle Theme" still works. */
  theme?: "light" | "dark"
  /**
   * First screen. Default "DemoPodcastList" (Welcome sits underneath, as after
   * "Let's go!"). "Login" starts signed out, like a fresh install.
   */
  initialRoute?: IgniteRoute
  /** Alias of `initialRoute` that takes the hand-built app's tab names. */
  initialTab?: LegacyTabName | IgniteRoute
  /** Draw a 62pt (iPhone 16 Pro) "9:41" status bar inside the app (a host bezel usually draws its own). */
  showStatusBar?: boolean
  /** Episodes to list instead of the bundled demo feed (fictional "Lanternfish Radio"). */
  episodes?: ReadonlyArray<EpisodeItem | LegacyEpisode>
  /** Episode guids favorited at start. Default: episode 314 ("lfr-314"), as in the design. */
  initialFavorites?: readonly string[]
  /** After a Like/Unlike, with the episode and its new state. */
  onPressFavorite?: (episode: EpisodeItem, isFavorite: boolean) => void
  /** When the visible screen changes: the Ignite route name, plus the legacy tab name for tabs. */
  onTabChange?: (route: IgniteRoute | "Login" | string, legacyTab?: LegacyTabName) => void
}

function initialStateFor(route: IgniteRoute): PartialState<NavigationState<AppStackParamList>> {
  if (route === "Login" || route === "Welcome") return { index: 0, routes: [{ name: route }] }
  return {
    index: 1,
    routes: [{ name: "Welcome" }, { name: "Demo", state: { routes: [{ name: route }] } }],
  }
}

/** AuthProvider's contract on component state: signed in, nothing persisted. */
function EmbeddedAuthProvider({ signedIn, children }: { signedIn: boolean; children: ReactNode }) {
  const [authToken, setAuthToken] = useState<string | undefined>(signedIn ? "embedded" : undefined)
  const [authEmail, setAuthEmail] = useState<string | undefined>("ignite@infinite.red")
  const logout = useCallback(() => {
    setAuthToken(undefined)
    setAuthEmail("")
  }, [])
  const validationError = useMemo(() => {
    if (!authEmail || authEmail.length === 0) return "can't be blank"
    if (authEmail.length < 6) return "must be at least 6 characters"
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(authEmail)) return "must be a valid email address"
    return ""
  }, [authEmail])
  const value: AuthContextType = {
    isAuthenticated: !!authToken,
    authToken,
    authEmail,
    setAuthToken,
    setAuthEmail,
    logout,
    validationError,
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

/**
 * ThemeProvider with a host-chosen scheme. `initialContext` pins it; writes by
 * the Debug screen's toggle (ThemeProvider persists them under this key) move
 * the pin, so the toggle behaves as on a device without the stored choice
 * leaking into the next page load.
 */
function EmbeddedThemeProvider({ scheme, children }: { scheme: "light" | "dark"; children: ReactNode }) {
  const [current, setCurrent] = useState(scheme)
  const hostScheme = useRef(scheme)
  hostScheme.current = scheme
  useEffect(() => setCurrent(scheme), [scheme])
  useEffect(() => {
    const sub = storage.addOnValueChangedListener((key) => {
      if (key !== "ignite.themeScheme") return
      const next = storage.getString(key)
      // "Reset" clears the override: back to the host's scheme (the "system" here).
      setCurrent(next === "light" || next === "dark" ? next : hostScheme.current)
    })
    return () => sub.remove()
  }, [])
  return <ThemeProvider initialContext={current}>{children}</ThemeProvider>
}

function Splash({ scheme }: { scheme: "light" | "dark" }) {
  const theme = scheme === "dark" ? darkTheme : lightTheme
  return <View style={{ flex: 1, backgroundColor: theme.colors.background }} />
}

/** Reserves the status bar's height as the top safe-area inset (what a device reports). */
function StatusBarInsets({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets()
  return (
    <SafeAreaProvider initialMetrics={{ insets: { ...insets, top: device.statusBarHeight }, frame: { x: 0, y: 0, width: 0, height: 0 } }}>
      {children}
    </SafeAreaProvider>
  )
}

/** The in-app status bar, following the app's current theme (Debug's toggle included). */
function ThemedStatusBar() {
  const { themeContext } = useAppTheme()
  return <StatusBar scheme={themeContext} />
}

/** The generated Ignite app, embeddable: `<NativeSurface …><IgniteApp /></NativeSurface>`. */
export function IgniteApp({
  theme = "light",
  initialRoute,
  initialTab,
  showStatusBar = false,
  episodes,
  initialFavorites = demoInitialFavorites,
  onPressFavorite,
  onTabChange,
}: IgniteAppProps) {
  const ready = useIgniteReady()
  const route: IgniteRoute =
    initialRoute ??
    (initialTab ? (LEGACY_TABS[initialTab as LegacyTabName] ?? (initialTab as IgniteRoute)) : "DemoPodcastList")
  // Read once, like a cold start: later prop changes don't reset the app.
  const [initialState] = useState(() => initialStateFor(route))
  const onPressFavoriteRef = useRef(onPressFavorite)
  onPressFavoriteRef.current = onPressFavorite
  const [seed] = useState<EpisodeSeed>(() => ({
    episodes: (episodes ?? demoEpisodes).map(toEpisodeItem),
    initialFavorites,
    onToggleFavorite: (episode, isFavorite) => onPressFavoriteRef.current?.(episode, isFavorite),
  }))

  const lastRoute = useRef<string>(route)
  const onTabChangeRef = useRef(onTabChange)
  onTabChangeRef.current = onTabChange
  const onStateChange = useCallback((state: NavigationState | undefined) => {
    if (!state) return
    const name = getActiveRouteName(state)
    if (name === lastRoute.current) return
    lastRoute.current = name
    onTabChangeRef.current?.(name, TAB_TO_LEGACY[name as keyof DemoTabParamList])
  }, [])

  if (!ready) return <Splash scheme={theme} />

  const app = (
    <KeyboardProvider>
      <EmbeddedAuthProvider signedIn={route !== "Login"}>
        <EmbeddedThemeProvider scheme={theme}>
          <EpisodeSeedContext.Provider value={seed}>
            <AppNavigator initialState={initialState} onStateChange={onStateChange} />
          </EpisodeSeedContext.Provider>
          {showStatusBar && <ThemedStatusBar />}
        </EmbeddedThemeProvider>
      </EmbeddedAuthProvider>
    </KeyboardProvider>
  )
  return <SafeAreaProvider>{showStatusBar ? <StatusBarInsets>{app}</StatusBarInsets> : app}</SafeAreaProvider>
}
