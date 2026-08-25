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
