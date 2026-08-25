/**
 * react-native-safe-area-context compat shim (canvas host).
 *
 * Surface inventoried from @react-navigation v7 (elements'
 * SafeAreaProviderCompat + hooks used by stack/bottom-tabs):
 * SafeAreaProvider, SafeAreaInsetsContext, useSafeAreaInsets,
 * useSafeAreaFrame, initialWindowMetrics, SafeAreaView.
 *
 * Inset math is real — a canvas surface simply has no OS chrome, so defaults
 * are zero; embeds simulate device chrome by passing `initialMetrics`
 * (the demo passes iPhone-ish top/bottom insets so headers and tab bars sit
 * like they do on a device).
 */
import * as React from 'react';
import { View, useWindowDimensions } from 'native-surface';
import type { StyleProp, ViewStyle } from 'native-surface';

export interface EdgeInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Metrics {
  insets: EdgeInsets;
  frame: Rect;
}

const ZERO: EdgeInsets = { top: 0, right: 0, bottom: 0, left: 0 };

/** Set only by a real native host at startup; null on this platform. */
export const initialWindowMetrics: Metrics | null = null;

export const SafeAreaInsetsContext = React.createContext<EdgeInsets | null>(null);
export const SafeAreaFrameContext = React.createContext<Rect | null>(null);

export interface SafeAreaProviderProps {
  children?: React.ReactNode;
  initialMetrics?: Metrics | null;
  style?: StyleProp<ViewStyle>;
}

export function SafeAreaProvider({ children, initialMetrics, style }: SafeAreaProviderProps): React.JSX.Element {
  const window = useWindowDimensions();
  const insets = initialMetrics?.insets ?? ZERO;
  const frame = initialMetrics?.frame ?? { x: 0, y: 0, width: window.width, height: window.height };
  return (
    <SafeAreaInsetsContext.Provider value={insets}>
      <SafeAreaFrameContext.Provider value={frame}>
        <View style={[{ flex: 1 }, style]}>{children}</View>
      </SafeAreaFrameContext.Provider>
    </SafeAreaInsetsContext.Provider>
  );
}

export function useSafeAreaInsets(): EdgeInsets {
  const insets = React.useContext(SafeAreaInsetsContext);
  if (insets == null) {
    throw new Error('No safe area value available. Make sure you are rendering `<SafeAreaProvider>` at the top of your app.');
  }
  return insets;
}

export function useSafeAreaFrame(): Rect {
  const frame = React.useContext(SafeAreaFrameContext);
  const window = useWindowDimensions();
  return frame ?? { x: 0, y: 0, width: window.width, height: window.height };
}

export type Edge = 'top' | 'right' | 'bottom' | 'left';

export interface SafeAreaViewProps {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  edges?: Edge[];
  /** Documented API: apply insets as padding (default) or margin. */
  mode?: 'padding' | 'margin';
}

export function SafeAreaView({ children, style, edges, mode = 'padding' }: SafeAreaViewProps): React.JSX.Element {
  const insets = React.useContext(SafeAreaInsetsContext) ?? ZERO;
  const active = edges ?? ['top', 'right', 'bottom', 'left'];
  const prefix = mode === 'margin' ? 'margin' : 'padding';
  const inset: ViewStyle = {
    [`${prefix}Top`]: active.includes('top') ? insets.top : 0,
    [`${prefix}Right`]: active.includes('right') ? insets.right : 0,
    [`${prefix}Bottom`]: active.includes('bottom') ? insets.bottom : 0,
    [`${prefix}Left`]: active.includes('left') ? insets.left : 0,
  } as ViewStyle;
  return <View style={[inset, style]}>{children}</View>;
}

/** Documented HOC form: injects `insets` as a prop. */
export function withSafeAreaInsets<P extends { insets?: EdgeInsets }>(
  Component: React.ComponentType<P>
): React.ComponentType<Omit<P, 'insets'>> {
  function WithSafeAreaInsets(props: Omit<P, 'insets'>) {
    const insets = React.useContext(SafeAreaInsetsContext) ?? ZERO;
    return <Component {...(props as P)} insets={insets} />;
  }
  WithSafeAreaInsets.displayName = `withSafeAreaInsets(${Component.displayName ?? Component.name ?? 'Component'})`;
  return WithSafeAreaInsets;
}
