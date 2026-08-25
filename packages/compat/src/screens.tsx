/**
 * react-native-screens compat shim — documented core surface as plain Views.
 *
 * NOT YET ALIASED in nativeSurfaceAliases(): with the package absent, the
 * navigators use their own maintained plain-View fallbacks (their web
 * behavior), which is the well-tested path our react-navigation slice ships
 * on. This module exists per docs/compat-strategy.md for the queued
 * native-stack adapter work: `screensEnabled()` reports the runtime truth, and
 * every component honors the documented visibility semantics (`activityState`
 * / `active`) so screens-aware code behaves, just without native screens.
 *
 * To adopt: add { find: 'react-native-screens', replacement:
 * '@native-surface/compat/screens' } to the alias set and verify the
 * navigator e2es — the navigators branch to different code once the import
 * resolves.
 */
import * as React from 'react';
import { View } from 'native-surface';
import type { StyleProp, ViewStyle } from 'native-surface';

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
  /** 0 = detached/hidden, 1 = transitioning, 2 = attached/active */
  activityState?: 0 | 1 | 2;
  active?: 0 | 1;
  enabled?: boolean;
  [key: string]: unknown;
}

function visible(p: ScreenLikeProps): boolean {
  if (p.activityState !== undefined) return p.activityState !== 0;
  if (p.active !== undefined) return p.active !== 0;
  return true;
}

export function Screen(props: ScreenLikeProps): React.JSX.Element {
  const { children, style } = props;
  return <View style={[{ flex: 1 }, style, visible(props) ? null : { display: 'none' }]}>{children}</View>;
}

export function ScreenContainer({ children, style }: ScreenLikeProps): React.JSX.Element {
  return <View style={[{ flex: 1 }, style]}>{children}</View>;
}

export const ScreenStack = ScreenContainer;
export function ScreenStackItem(props: ScreenLikeProps): React.JSX.Element {
  return <Screen {...props} />;
}

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
