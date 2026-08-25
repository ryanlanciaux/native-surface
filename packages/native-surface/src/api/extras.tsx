/**
 * Auxiliary react-native surface required so third-party RN libraries
 * (currently: @gorhom/bottom-sheet and its @gorhom/portal dependency) can be
 * imported under the alias. Policy mirrors the Animated stub (API.md):
 * components we cannot faithfully render THROW when rendered — never silently
 * misrender — but exist as values so module graphs load. Event-less runtime
 * objects (Keyboard, StatusBar) are honest no-ops for a keyboard-less,
 * status-bar-less canvas host.
 */
import * as React from 'react';
import { Pressable, View } from '../components/primitives';
import { Appearance, type ColorSchemeName } from './Appearance';
import { dismissKeyboard, setKeyboardEmitter } from '../engine/textInputState';
import type { PressableProps, StyleProp, ViewStyle } from '../types';

interface Subscription {
  remove(): void;
}

// A real (if simple) emitter: TextInput's DOM overlay drives show/hide when
// focus moves, so KeyboardAvoiding-style listeners genuinely fire.
const keyboardListeners = new Map<string, Set<(e: unknown) => void>>();
let keyboardVisible = false;
const KEYBOARD_METRICS = { height: 0, screenX: 0, screenY: 0, width: 0 }; // canvas host: no OS inset

setKeyboardEmitter((event) => {
  keyboardVisible = event === 'keyboardWillShow' || event === 'keyboardDidShow';
  const payload = { endCoordinates: KEYBOARD_METRICS, duration: 0, easing: 'keyboard' };
  keyboardListeners.get(event)?.forEach((cb) => cb(payload));
});

export const Keyboard = {
  addListener: (event: string, cb: (...args: unknown[]) => void): Subscription => {
    let set = keyboardListeners.get(event);
    if (!set) keyboardListeners.set(event, (set = new Set()));
    set.add(cb);
    return {
      remove() {
        set!.delete(cb);
      },
    };
  },
  removeAllListeners: (event?: string): void => {
    if (event) keyboardListeners.delete(event);
    else keyboardListeners.clear();
  },
  dismiss: (): void => dismissKeyboard(),
  isVisible: (): boolean => keyboardVisible,
  metrics: () => (keyboardVisible ? KEYBOARD_METRICS : undefined),
  scheduleLayoutAnimation: (): void => {},
};

export function StatusBar(): null {
  return null;
}
StatusBar.currentHeight = 0 as number | undefined;
StatusBar.setBarStyle = (): void => {};
StatusBar.setHidden = (): void => {};

/**
 * RN's findNodeHandle returns an opaque native tag; ours returns the host
 * instance itself (or null), which is what callers can actually use here.
 */
export function findNodeHandle(instance: unknown): unknown {
  if (instance == null) return null;
  const maybeRef = instance as { current?: unknown };
  return maybeRef.current !== undefined ? maybeRef.current : instance;
}

export interface TouchableWithoutFeedbackProps extends Omit<PressableProps, 'style' | 'children'> {
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

/** Pressable with no visual feedback — faithful to RN's semantics. */
export function TouchableWithoutFeedback(props: TouchableWithoutFeedbackProps): React.JSX.Element {
  const { children, style, ...rest } = props;
  return (
    <Pressable {...rest} style={style}>
      {children}
    </Pressable>
  );
}

export interface TouchableHighlightProps extends TouchableWithoutFeedbackProps {
  underlayColor?: string;
  activeOpacity?: number;
}

/** Approximated with a pressed underlay color; documented in API.md extras. */
export function TouchableHighlight(props: TouchableHighlightProps): React.JSX.Element {
  const { children, style, underlayColor = '#00000014', ...rest } = props;
  return (
    <Pressable
      {...rest}
      style={({ pressed }) => [style, pressed ? { backgroundColor: underlayColor } : null]}
    >
      {children}
    </Pressable>
  );
}

function throwingComponent(name: string, why: string): React.ComponentType<Record<string, unknown>> {
  const Throwing: React.FC<Record<string, unknown>> = () => {
    throw new Error(`native-surface: <${name}> is not supported in v1 (${why}). It may be imported but not rendered.`);
  };
  Throwing.displayName = name;
  return Throwing;
}

// TextInput is the real primitive: Skia paints it unfocused, a DOM overlay
// provides the OS keyboard/IME while focused (engine/textInputOverlay.ts).
// Lists are real ScrollView-backed implementations (non-virtualized).
export { TextInput, TextInputState } from '../components/TextInputImpl';
export type { TextInputRef } from '../components/TextInputImpl';
export { FlatList, SectionList, VirtualizedList } from '../components/lists';
export type {
  FlatListProps,
  SectionListProps,
  SectionListData,
  SectionListRenderItemInfo,
  ListRenderItem,
  ListRenderItemInfo,
} from '../components/lists';
export type { TextInputProps } from '../components/TextInputImpl';

/**
 * NativeModules: always present on RN; a canvas host has none. Property reads
 * return undefined (libraries feature-detect this way); this is data-shaped,
 * so it does not throw.
 */
export const NativeModules: Record<string, unknown> = new Proxy(
  {},
  {
    get: (_t, prop) => {
      if (typeof prop === 'string' && !warnedNativeModules.has(prop)) {
        warnedNativeModules.add(prop);
        console.warn(`native-surface: NativeModules.${prop} does not exist on the canvas host (returned undefined).`);
      }
      return undefined;
    },
  }
);
const warnedNativeModules = new Set<string>();

/**
 * Color scheme: RN's hook over the Appearance module, so a setColorScheme()
 * override and the page's prefers-color-scheme reach hook consumers the same
 * way they reach Appearance.getColorScheme() callers.
 */
export function useColorScheme(): ColorSchemeName {
  const [scheme, setScheme] = React.useState<ColorSchemeName>(() => Appearance.getColorScheme());
  React.useEffect(() => {
    // Re-read on subscribe: the scheme can change between the initial render
    // and the effect (a theme provider calling setColorScheme on mount).
    setScheme(Appearance.getColorScheme());
    const sub = Appearance.addChangeListener((preferences) => setScheme(preferences.colorScheme));
    return () => sub.remove();
  }, []);
  return scheme;
}

/** No OS keyboard on a canvas host: behaves as a plain View (documented RN props accepted). */
export const KeyboardAvoidingView: React.FC<
  React.ComponentProps<typeof View> & {
    behavior?: 'height' | 'position' | 'padding';
    keyboardVerticalOffset?: number;
    enabled?: boolean;
  }
> = ({ behavior: _b, keyboardVerticalOffset: _k, enabled: _e, ...rest }) => <View {...rest} />;

/** LayoutAnimation: advisory on this host (layout changes apply un-animated). */
export const LayoutAnimation = {
  configureNext: (_config: unknown, _onEnd?: () => void, _onFail?: () => void): void => {},
  create: (duration: number, type?: string, property?: string) => ({ duration, type, property }),
  Types: {
    spring: 'spring',
    linear: 'linear',
    easeInEaseOut: 'easeInEaseOut',
    easeIn: 'easeIn',
    easeOut: 'easeOut',
    keyboard: 'keyboard',
  },
  Properties: { opacity: 'opacity', scaleX: 'scaleX', scaleY: 'scaleY', scaleXY: 'scaleXY' },
  Presets: {
    easeInEaseOut: { duration: 300 },
    linear: { duration: 500 },
    spring: { duration: 700 },
  },
};

export function RefreshControl(): null {
  return null;
}

export const I18nManager = {
  isRTL: false,
  doLeftAndRightSwapInRTL: true,
  allowRTL: (): void => {},
  forceRTL: (): void => {},
  getConstants: () => ({ isRTL: false, doLeftAndRightSwapInRTL: true, localeIdentifier: 'en-US' }),
};

export const AccessibilityInfo = {
  isScreenReaderEnabled: (): Promise<boolean> => Promise.resolve(false),
  isReduceMotionEnabled: (): Promise<boolean> => Promise.resolve(false),
  addEventListener: (_event: string, _cb: (...args: unknown[]) => void): Subscription => ({ remove() {} }),
};

export const InteractionManager = {
  runAfterInteractions: (cb?: () => void): { then: (r: () => void) => void; cancel: () => void } => {
    const p = Promise.resolve().then(() => cb?.());
    return { then: (r: () => void) => void p.then(r), cancel: () => {} };
  },
  createInteractionHandle: (): number => 0,
  clearInteractionHandle: (): void => {},
};

/**
 * TurboModule registry surface for libraries that probe for native modules at
 * import time (reanimated's specs/*.js does `TurboModuleRegistry.get(...)` in
 * module scope). `get` reports "no native module" — the JS/web code paths are
 * what run on this host; `getEnforcing` names the seam when something demands
 * a real native module.
 */
export const TurboModuleRegistry = {
  get: (_name: string): null => null,
  getEnforcing: (name: string): never => {
    throw new Error(
      `native-surface: TurboModuleRegistry.getEnforcing('${name}') — no native modules exist on this host; the library must use its JS/web path`
    );
  },
};

/** Minimal NativeEventEmitter: registration works, nothing is ever emitted. */
export class NativeEventEmitter {
  addListener(_event: string, _cb: (...args: unknown[]) => void): Subscription {
    return { remove() {} };
  }
  removeAllListeners(_event: string): void {}
  listenerCount(_event: string): number {
    return 0;
  }
}

/** LogBox: dev-overlay API accepted, entries forwarded to the console. */
export const LogBox = {
  ignoreLogs: (_patterns: ReadonlyArray<string | RegExp>): void => {},
  ignoreAllLogs: (_value?: boolean): void => {},
  install: (): void => {},
  uninstall: (): void => {},
  addLog: (log: { level?: string; message?: { content?: string } }): void => {
    // eslint-disable-next-line no-console
    console.warn('[LogBox]', log?.message?.content ?? log);
  },
};

/**
 * UIManager: only the view-manager probe third-party code uses to detect
 * optional native components (e.g. @react-navigation/elements' MaskedView
 * check). Reporting null routes those libraries onto their JS fallbacks.
 */
export const UIManager = {
  getViewManagerConfig: (_name: string): null => null,
  hasViewManagerConfig: (_name: string): boolean => false,
};

/** No hardware back button on a canvas host; subscriptions are inert. */
export const BackHandler = {
  addEventListener: (_event: string, _handler: () => boolean | null | undefined): Subscription => ({
    remove() {},
  }),
  exitApp: (): void => {},
};

/**
 * Linking: enough for NavigationContainer's optional deep-linking probe.
 * There are no OS-level URLs to open on a canvas surface.
 */
export const Linking = {
  getInitialURL: async (): Promise<string | null> => null,
  addEventListener: (_event: string, _handler: (e: { url: string }) => void): Subscription => ({
    remove() {},
  }),
  openURL: async (_url: string): Promise<void> => {},
  canOpenURL: async (_url: string): Promise<boolean> => false,
};

/**
 * PlatformColor: RN resolves named system colors natively; a canvas host has
 * no system palette. Returns a neutral resolvable color so layouts render;
 * callers needing exact system colors should pass explicit values.
 */
export function PlatformColor(..._names: string[]): string {
  return '#000000';
}
