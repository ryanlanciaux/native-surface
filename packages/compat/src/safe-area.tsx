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
import { View, useSurfaceInsets, useWindowDimensions } from 'native-surface';
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

/**
 * Modern-iPhone-ish metrics for embeds that simulate device chrome:
 *
 *   <SafeAreaProvider initialMetrics={simulatedDeviceMetrics()}>
 *
 * The provider's zero default is deliberate — a canvas surface genuinely has
 * no notch or home indicator — but without insets React Navigation's headers
 * and tab bars sit flush against the bezel, and its stack interpolators need
 * a non-zero frame. Defaults: insets { top: 59, bottom: 34 }, frame 390×844;
 * `overrides` merge in. Because the preset aliases
 * react-native-safe-area-context to this module, consumers can import this
 * straight from 'react-native-safe-area-context'.
 */
export function simulatedDeviceMetrics(overrides?: {
  width?: number;
  height?: number;
  insets?: Partial<EdgeInsets>;
}): Metrics {
  return {
    insets: { top: 59, right: 0, bottom: 34, left: 0, ...overrides?.insets },
    frame: { x: 0, y: 0, width: overrides?.width ?? 390, height: overrides?.height ?? 844 },
  };
}

export const SafeAreaInsetsContext = React.createContext<EdgeInsets | null>(null);
export const SafeAreaFrameContext = React.createContext<Rect | null>(null);

export interface SafeAreaProviderProps {
  children?: React.ReactNode;
  initialMetrics?: Metrics | null;
  style?: StyleProp<ViewStyle>;
}

export function SafeAreaProvider({ children, initialMetrics, style }: SafeAreaProviderProps): React.JSX.Element {
  const window = useWindowDimensions();
  /**
   * The SURFACE's declared insets are the fallback, not zero.
   *
   * Apps overwhelmingly write `<SafeAreaProvider initialMetrics={initialWindowMetrics}>`,
   * and `initialWindowMetrics` is `null` here — honestly so: at module-eval
   * time no surface exists yet, which is the same "not measured yet" the real
   * package reports on Android. But that meant an embedder standing a surface
   * in for a device viewport had NO way to give the app that device's insets:
   * `simulatedDeviceMetrics()` only reaches an app that opts into calling it,
   * and no real app does. So the app laid out flush to the bezel, and a
   * `fullHeight` sheet — sized `screenHeight - insets.top` — covered the whole
   * surface with no backdrop left to dismiss it by.
   *
   * `<NativeSurface safeAreaInsets={...}>` is where the embedder declares them
   * now, and this is where they arrive. Explicit `initialMetrics` still wins:
   * an app passing real values means them.
   */
  const surfaceInsets = useSurfaceInsets();
  const insets = initialMetrics?.insets ?? surfaceInsets;
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
