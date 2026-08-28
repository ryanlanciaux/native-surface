/**
 * react-native-screens compat shim — documented core surface as plain Views.
 *
 * ALIASED in nativeSurfaceAliases() (`screens: 'shim'`, the default; `'off'`
 * is the escape hatch): npm installs the real package as a peer of the
 * navigators, and its `react-native` export condition + Metro platform
 * extensions resolve NATIVE entries (Tabs/TabsScreen/TabsHost) that don't
 * exist in a usable web build — a production build dies at resolution. The
 * alias (a regex, so subpath imports too) lands every react-native-screens
 * import here instead.
 *
 * Once the import resolves, navigators branch to their screens-enabled code
 * paths, so these components must be layout-faithful, not just resolvable:
 * every View-safe prop is forwarded — onLayout especially, because
 * react-navigation's CardStack measures `layouts.screen` through onLayout on
 * ScreenContainer, and dropping it leaves layouts at 0×0, turning the stack
 * card interpolators into no-ops (push/pop snaps). Screens-specific props
 * (activityState, stackPresentation, lifecycle callbacks, …) are stripped
 * before the spread; they configure native screen containers that don't
 * exist here.
 *
 * Visibility semantics (`activityState` / `active`): 0 = hidden, non-zero =
 * shown — but navigators mid-transition pass an Animated node, not a number.
 * A non-number therefore means "transitioning": treat as visible, never
 * display:none a card that is animating.
 */
import * as React from 'react';
import { View } from 'native-surface';
import type { StyleProp, ViewProps, ViewStyle } from 'native-surface';

let screensEnabledFlag = true; // library default; components here are Views either way

export function enableScreens(enabled = true): void {
  screensEnabledFlag = enabled;
}
export function screensEnabled(): boolean {
  return screensEnabledFlag;
}
export function enableFreeze(_enabled = true): void {}

interface ScreenLikeProps {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** 0 = detached/hidden, 1 = transitioning, 2 = attached/active.
   *  Mid-transition the navigators pass an Animated node — see header. */
  activityState?: 0 | 1 | 2 | unknown;
  active?: 0 | 1 | unknown;
  enabled?: boolean;
  [key: string]: unknown;
}

/** Props that configure real native screens (or fire from them) — meaningless
 *  on a plain View, so they never reach the engine. Everything else spreads
 *  through so View-safe props (onLayout, pointerEvents, testID, …) survive. */
const SCREENS_ONLY_PROPS = new Set([
  'activityState',
  'active',
  'enabled',
  'freezeOnBlur',
  'isNativeStack',
  'gestureEnabled',
  'gestureResponseDistance',
  'customAnimationOnSwipe',
  'fullScreenSwipeEnabled',
  'hideKeyboardOnSwipe',
  'homeIndicatorHidden',
  'preventNativeDismiss',
  'nativeBackButtonDismissalEnabled',
  'navigationBarColor',
  'navigationBarTranslucent',
  'replaceAnimation',
  'screenOrientation',
  'sheetAllowedDetents',
  'sheetCornerRadius',
  'sheetExpandsWhenScrolledToEdge',
  'sheetGrabberVisible',
  'sheetLargestUndimmedDetent',
  'stackAnimation',
  'stackPresentation',
  'statusBarAnimation',
  'statusBarColor',
  'statusBarHidden',
  'statusBarStyle',
  'statusBarTranslucent',
  'swipeDirection',
  'transitionDuration',
  'headerConfig',
  'screenId',
  'onAppear',
  'onDisappear',
  'onWillAppear',
  'onWillDisappear',
  'onHeaderBackButtonClicked',
  'onNativeDismissCancelled',
  'onDismissed',
  'onGestureCancel',
  'onTransitionProgress',
]);

function viewSafeRest(props: ScreenLikeProps): ViewProps {
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (key === 'children' || key === 'style' || SCREENS_ONLY_PROPS.has(key)) continue;
    rest[key] = value;
  }
  return rest as ViewProps;
}

function visible(p: ScreenLikeProps): boolean {
  if (p.activityState !== undefined)
    return typeof p.activityState === 'number' ? p.activityState !== 0 : true;
  if (p.active !== undefined) return typeof p.active === 'number' ? p.active !== 0 : true;
  return true;
}

export function Screen(props: ScreenLikeProps): React.JSX.Element {
  const { children, style } = props;
  return (
    <View {...viewSafeRest(props)} style={[{ flex: 1 }, style, visible(props) ? null : { display: 'none' }]}>
      {children}
    </View>
  );
}

export function ScreenContainer(props: ScreenLikeProps): React.JSX.Element {
  const { children, style } = props;
  return (
    <View {...viewSafeRest(props)} style={[{ flex: 1 }, style]}>
      {children}
    </View>
  );
}

export const ScreenStack = ScreenContainer;
export function ScreenStackItem(props: ScreenLikeProps): React.JSX.Element {
  return <Screen {...props} />;
}

// Native tab primitives (react-native-screens 4.x): some builds resolve them
// through the package's native entries (see header). Plain-View passthroughs;
// bottom-tabs' unstable native path renders them as `<Tabs.Host>` /
// `<Tabs.Screen>`, so Tabs carries the compound shape.
export function TabsHost(props: ScreenLikeProps): React.JSX.Element {
  return <ScreenContainer {...props} />;
}
export function TabsScreen(props: ScreenLikeProps): React.JSX.Element {
  return <Screen {...props} />;
}
export const Tabs = Object.assign(
  (props: ScreenLikeProps): React.JSX.Element => <TabsHost {...props} />,
  { Host: TabsHost, Screen: TabsScreen }
);

// Header-config views are layout-inert containers on this platform.
const Inert = ({ children }: { children?: React.ReactNode }) => <View>{children}</View>;
export const ScreenStackHeaderConfig = Inert;
export const ScreenStackHeaderLeftView = Inert;
export const ScreenStackHeaderCenterView = Inert;
export const ScreenStackHeaderRightView = Inert;
export const ScreenStackHeaderBackButtonImage = Inert;
export const ScreenStackHeaderSearchBarView = Inert;
export const SearchBar = (): null => null;
export const isSearchBarAvailableForCurrentPlatform = false;
export const FullWindowOverlay = Inert;

/**
 * Version-capability flags the navigators branch on.
 *
 * `@react-navigation/native-stack`'s NATIVE view imports these directly
 * (`import { compatibilityFlags, ScreenStack, ScreenStackItem } from
 * 'react-native-screens'`), so a missing name here does not degrade a
 * feature — it breaks the whole ESM module at link time and the navigator
 * never mounts. That path is reachable whenever an app has native-stack
 * WITHOUT @react-navigation/stack, since the JS-stack adapter alias is then
 * correctly dropped (see nativeSurfaceAliases) and the real native-stack runs
 * over this shim.
 *
 * Every flag reports the MODERN shape, which is the truthful answer: these
 * describe which API a downstream library should target, and this shim
 * implements the current one — `ScreenStackItem`, the flexbox header
 * contract, and the stabilised Tabs API are all present above. Reporting a
 * legacy shape would send the navigators down compatibility paths for
 * behavior this shim does not have.
 */
export const compatibilityFlags = {
  isNewBackTitleImplementation: true,
  usesHeaderFlexboxImplementation: true,
  usesNewAndroidHeaderHeightImplementation: true,
  usesStableTabsApi: true,
} as const;

/**
 * Global behavior switches. Every one of them configures NATIVE screen
 * containers — synchronous shadow-tree updates, Android inset behavior — none
 * of which exist here, so they are settable and readable (libraries assign
 * them at import time) and otherwise inert.
 */
export const featureFlags = {
  experiment: {
    synchronousScreenUpdatesEnabled: true,
    synchronousHeaderConfigUpdatesEnabled: true,
    synchronousHeaderSubviewUpdatesEnabled: true,
    androidLegacyTopInsetBehavior: false,
    androidResetScreenShadowStateOnOrientationChangeEnabled: true,
    iosPreventReattachmentOfDismissedScreens: true,
    iosPreventReattachmentOfDismissedModals: true,
    ios26AllowInteractionsDuringTransition: true,
  },
  stable: { debugLogging: false },
};

export default featureFlags;
