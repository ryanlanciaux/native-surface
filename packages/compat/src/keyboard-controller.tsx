/**
 * react-native-keyboard-controller compat shim.
 *
 * A canvas host has no OS keyboard, so the keyboard is permanently closed;
 * this shim implements the package's documented surface with that truth:
 * providers/views render children, keyboard measurements are 0/closed,
 * subscriptions never fire, and imperative dismissal resolves immediately.
 * KeyboardAwareScrollView is the engine ScrollView (no insets to avoid).
 */
import * as React from 'react';
import { ScrollView, View } from 'native-surface';
import type { ScrollViewProps, ViewProps } from 'native-surface';

export const KeyboardProvider: React.FC<{ children?: React.ReactNode; statusBarTranslucent?: boolean; navigationBarTranslucent?: boolean }> = ({ children }) => <>{children}</>;

export interface KeyboardAwareScrollViewRef {
  scrollTo?: (opts: { x?: number; y?: number; animated?: boolean }) => void;
}

export interface KeyboardAwareScrollViewProps extends ScrollViewProps {
  bottomOffset?: number;
  extraKeyboardSpace?: number;
  disableScrollOnKeyboardHide?: boolean;
  enabled?: boolean;
  children?: React.ReactNode;
}

export const KeyboardAwareScrollView = React.forwardRef<KeyboardAwareScrollViewRef, KeyboardAwareScrollViewProps>(
  function KeyboardAwareScrollView(
    { bottomOffset: _b, extraKeyboardSpace: _e, disableScrollOnKeyboardHide: _d, enabled: _en, ...rest },
    ref
  ) {
    // Forward the REAL engine ScrollView handle (scrollTo/scrollToEnd) so
    // callers like SectionList.scrollToLocation drive actual scrolling.
    return <ScrollView ref={ref as React.Ref<React.ComponentRef<typeof ScrollView>>} {...rest} />;
  }
);

export const KeyboardStickyView: React.FC<ViewProps & { offset?: { closed?: number; opened?: number }; children?: React.ReactNode }> = ({ offset: _o, ...rest }) => <View {...rest} />;

export const KeyboardController = {
  dismiss: async (): Promise<void> => {},
  setInputMode: (): void => {},
  setDefaultMode: (): void => {},
  isVisible: (): boolean => false,
  state: () => ({ isVisible: false }),
};

const CLOSED_STATE = {
  isVisible: false,
  height: 0,
  duration: 0,
  timestamp: 0,
  target: -1,
  type: 'keyboard',
  appearance: 'light',
};

export function useKeyboardState(): typeof CLOSED_STATE {
  return CLOSED_STATE;
}

function staticValue(v: number): { value: number } {
  return { value: v };
}

export function useKeyboardAnimation() {
  return React.useMemo(() => ({ height: staticValue(0), progress: staticValue(0) }), []);
}
export function useReanimatedKeyboardAnimation() {
  return useKeyboardAnimation();
}

export const KeyboardEvents = {
  addListener: (_event: string, _cb: (e: unknown) => void) => ({ remove: () => {} }),
};

export const KeyboardGestureArea: React.FC<ViewProps & { children?: React.ReactNode }> = (props) => <View {...props} />;

// ---------------------------------------------------------------------------
// The rest of the package's documented surface.
//
// Everything below follows the same truth as above: no OS keyboard exists on
// a canvas host, so the avoiding/sticky/toolbar views are layout passthroughs
// and every measurement is zero. They exist as real exports because a missing
// NAME breaks the whole ESM module at link time — and apps wrap their ROOT in
// these, so that failure is total rather than local.
// ---------------------------------------------------------------------------

export interface KeyboardAvoidingViewProps extends ViewProps {
  behavior?: 'height' | 'position' | 'padding' | 'translate-with-padding';
  contentContainerStyle?: ViewProps['style'];
  keyboardVerticalOffset?: number;
  enabled?: boolean;
  children?: React.ReactNode;
}

/** With a permanently-closed keyboard there is nothing to avoid: a plain View. */
export const KeyboardAvoidingView: React.FC<KeyboardAvoidingViewProps> = ({
  behavior: _behavior,
  contentContainerStyle: _contentContainerStyle,
  keyboardVerticalOffset: _keyboardVerticalOffset,
  enabled: _enabled,
  children,
  ...rest
}) => <View {...rest}>{children}</View>;

export interface KeyboardChatScrollViewProps extends ScrollViewProps {
  children?: React.ReactNode;
}
export const KeyboardChatScrollView: React.FC<KeyboardChatScrollViewProps> = (props) => (
  <ScrollView {...props} />
);

export interface KeyboardToolbarProps {
  children?: React.ReactNode;
  content?: React.ReactNode;
  doneText?: React.ReactNode;
  showArrows?: boolean;
  opacity?: string;
  onDoneCallback?: () => void;
  onNextCallback?: () => void;
  onPrevCallback?: () => void;
  [key: string]: unknown;
}

/** The toolbar docks to a keyboard that never appears, so it renders nothing. */
export const KeyboardToolbar: React.FC<KeyboardToolbarProps> = () => null;

export const DefaultKeyboardToolbarTheme = {
  dark: { primary: '#FFFFFF', disabled: '#555555', background: '#232323', ripple: '#FFFFFF' },
  light: { primary: '#000000', disabled: '#B4B4B4', background: '#F0F0F0', ripple: '#000000' },
} as const;

/**
 * Views that render ABOVE the keyboard in a separate native window. There is
 * no such window here; children render inline so their content is at least
 * reachable, which beats dropping it.
 */
export const OverKeyboardView: React.FC<{ visible?: boolean; children?: React.ReactNode }> = ({
  visible = true,
  children,
}) => (visible ? <View>{children}</View> : null);

export const KeyboardExtender: React.FC<{ enabled?: boolean; children?: React.ReactNode }> = ({
  children,
}) => <View>{children}</View>;

/** KeyboardStickyView's documented offset shape, for consumers that type it. */
export interface KeyboardStickyViewProps extends ViewProps {
  offset?: { closed?: number; opened?: number };
  enabled?: boolean;
  children?: React.ReactNode;
}

export const AndroidSoftInputModes = {
  SOFT_INPUT_ADJUST_NOTHING: 48,
  SOFT_INPUT_ADJUST_PAN: 32,
  SOFT_INPUT_ADJUST_RESIZE: 16,
  SOFT_INPUT_ADJUST_UNSPECIFIED: 0,
  SOFT_INPUT_IS_FORWARD_NAVIGATION: 256,
  SOFT_INPUT_MASK_ADJUST: 240,
  SOFT_INPUT_MASK_STATE: 15,
  SOFT_INPUT_MODE_CHANGED: 512,
  SOFT_INPUT_STATE_ALWAYS_HIDDEN: 3,
  SOFT_INPUT_STATE_ALWAYS_VISIBLE: 5,
  SOFT_INPUT_STATE_HIDDEN: 2,
  SOFT_INPUT_STATE_UNCHANGED: 1,
  SOFT_INPUT_STATE_UNSPECIFIED: 0,
  SOFT_INPUT_STATE_VISIBLE: 4,
} as const;

/** Focused-input controls; the engine's own TextInput owns focus here. */
export const FocusedInputEvents = {
  addListener: (_event: string, _cb: (e: unknown) => void) => ({ remove: () => {} }),
};

export function useFocusedInputHandler(_handlers: Record<string, unknown>, _deps?: unknown[]): void {}
export function useKeyboardHandler(_handlers: Record<string, unknown>, _deps?: unknown[]): void {}
export function useFocusedInputLayout() {
  return React.useMemo(() => ({ value: null }), []);
}
export function useKeyboardContext() {
  return React.useMemo(
    () => ({
      animated: { progress: staticValue(0), height: staticValue(0) },
      reanimated: { progress: staticValue(0), height: staticValue(0) },
      layout: { value: null },
      setEnabled: (_enabled: boolean) => {},
    }),
    []
  );
}
