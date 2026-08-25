/**
 * expo-blur + @react-native-community/blur compat (canvas host).
 *
 * Both packages mean "frosted glass over whatever is behind me". Props
 * compile to the engine's `__backdropBlur` channel: a saveLayer with a
 * backdrop ImageFilter blurs the scene already painted under the node's
 * rounded rect, then a tint wash approximates the platform material.
 *
 * Prop mapping: expo's intensity (0–100) is the native unit; the community
 * package's blurAmount maps onto it 1:1 and blurType onto tint. Expo's many
 * material tint names collapse by keyword — anything containing "dark" tints
 * dark, "light" light, other system materials default; an unrecognized
 * string is treated as a color and tints directly.
 */
import * as React from 'react';
import { View } from 'native-surface';
import type { StyleProp, ViewStyle } from 'native-surface';

// The host view takes engine-channel props (__backdropBlur) that ViewProps doesn't type.
const HostView = View as unknown as React.FC<Record<string, unknown>>;

export type BlurTint = string;

export interface BlurViewProps {
  // expo-blur surface
  /** 0–100; default 50. */
  intensity?: number;
  tint?: BlurTint;
  /** Android renderer selection on-device; the canvas has one renderer. */
  experimentalBlurMethod?: 'none' | 'dimezisBlurView';
  blurReductionFactor?: number;
  // @react-native-community/blur surface
  blurType?: string;
  /** Community intensity knob, same 0–100 range. */
  blurAmount?: number;
  /** iOS accessibility fallback; transparency is never reduced here. */
  reducedTransparencyFallbackColor?: string;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
  [prop: string]: unknown;
}

function normalizeTint(t: string | undefined): string {
  if (!t) return 'default';
  const k = t.toLowerCase();
  if (k === 'default' || k === 'regular' || k === 'prominent') return 'default';
  if (k.includes('dark')) return 'dark';
  if (k.includes('light')) return 'light'; // xlight, extraLight, materials…
  if (k.startsWith('system')) return 'default'; // remaining material names
  return t; // color string: the engine tints with it directly
}

export function BlurView(props: BlurViewProps): React.JSX.Element {
  const {
    intensity,
    tint,
    blurType,
    blurAmount,
    experimentalBlurMethod: _method,
    blurReductionFactor: _reduction,
    reducedTransparencyFallbackColor: _fallback,
    children,
    ...rest
  } = props;
  const spec = {
    intensity: intensity ?? blurAmount ?? 50,
    tint: normalizeTint(tint ?? blurType),
  };
  return (
    <HostView {...rest} __backdropBlur={spec}>
      {children}
    </HostView>
  );
}

let warnedVibrancy = false;

/**
 * iOS vibrancy pulls content color through the blur; without that
 * compositing mode it renders as a plain BlurView.
 */
export function VibrancyView(props: BlurViewProps): React.JSX.Element {
  if (!warnedVibrancy) {
    warnedVibrancy = true;
    console.warn('native-surface: VibrancyView renders as BlurView (vibrancy compositing is not supported on the canvas host)');
  }
  return <BlurView {...props} />;
}

export default BlurView;
