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
import type { PressableProps, StyleProp, ViewProps, ViewStyle } from '../types';

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

/**
 * requireNativeComponent — RN's escape hatch for a view implemented natively.
 * There are no native views here, so the returned component degrades to an
 * empty box: children still render, View-safe props still apply, and the first
 * render warns once NAMING the component so the gap is findable.
 *
 * Degrading beats throwing for this one specifically. Libraries call it at
 * module scope for views they may never render (a video surface, a map, an ad
 * slot), and a throw would take out the importing module — the failure this
 * whole surface exists to prevent. A missing native view should be an empty
 * box in the layout, not a dead screen.
 *
 * Props are filtered rather than forwarded wholesale: native props (source,
 * onNativeEvent, driver-specific config) mean nothing to a canvas node, so only
 * layout/identity/accessibility props pass through.
 */
const VIEW_SAFE_PROPS = new Set(['ref', 'style', 'children', 'testID', 'pointerEvents', 'onLayout']);
const warnedNativeComponents = new Set<string>();

export function requireNativeComponent<P extends object>(name: string): React.ComponentType<P> {
  const NativeViewFallback: React.FC<Record<string, unknown>> = (props) => {
    if (!warnedNativeComponents.has(name)) {
      warnedNativeComponents.add(name);
      console.warn(
        `native-surface: requireNativeComponent('${name}') — no native views exist on the canvas host; rendering an empty View in its place.`
      );
    }
    const safe: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(props)) {
      if (VIEW_SAFE_PROPS.has(key) || key === 'role' || key.startsWith('accessibility') || key.startsWith('aria-')) {
        safe[key] = value;
      }
    }
    return <View {...(safe as ViewProps)} />;
  };
  NativeViewFallback.displayName = `NativeView(${name})`;
  return NativeViewFallback as React.ComponentType<P>;
}

/**
 * codegenNativeComponent — the Fabric-era spelling of the same escape hatch.
 * Libraries built for the new architecture (reanimated 4, screens, pager-view)
 * declare their host views this way, at module scope, and the name is what
 * the codegen would have registered. Same degrade-don't-throw contract as
 * requireNativeComponent, for the same reason.
 */
export function codegenNativeComponent<P extends object>(
  name: string,
  _options?: Record<string, unknown>
): React.ComponentType<P> {
  return requireNativeComponent<P>(name);
}

/**
 * codegenNativeCommands — imperative commands dispatched at a native view's
 * ref (scrollToIndex on a native list, setPage on a native pager). There is
 * no native view to receive them, so each command is an inert function that
 * warns once. Returning an object rather than throwing keeps the library's
 * module-scope `const Commands = codegenNativeCommands({...})` alive.
 */
export function codegenNativeCommands<T extends Record<string, unknown>>(options: {
  supportedCommands: ReadonlyArray<string>;
}): T {
  const commands: Record<string, unknown> = {};
  for (const command of options?.supportedCommands ?? []) {
    commands[command] = (..._args: unknown[]) => {
      if (!warnedNativeComponents.has(`cmd:${command}`)) {
        warnedNativeComponents.add(`cmd:${command}`);
        console.warn(
          `native-surface: native command '${command}' has no receiver on the canvas host; the call is a no-op.`
        );
      }
    };
  }
  return commands as T;
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

/**
 * AccessibilityInfo — the assistive-technology state, which a canvas surface
 * genuinely does not have: the tree the screen reader would walk is pixels, not
 * a11y nodes. Every query therefore answers "off" and every command is inert.
 *
 * The whole documented surface is present rather than the two members that
 * happen to be common, because a MISSING member is a TypeError at the call
 * site — `AccessibilityInfo.setAccessibilityFocus(tag)` on a focus trap takes
 * down whatever opened the dialog, where an inert one costs nothing. Reduced
 * motion is the one signal a browser can answer, and Appearance/useReducedMotion
 * are where that already comes from.
 */
export const AccessibilityInfo = {
  isScreenReaderEnabled: (): Promise<boolean> => Promise.resolve(false),
  isReduceMotionEnabled: (): Promise<boolean> => Promise.resolve(false),
  isReduceTransparencyEnabled: (): Promise<boolean> => Promise.resolve(false),
  isBoldTextEnabled: (): Promise<boolean> => Promise.resolve(false),
  isGrayscaleEnabled: (): Promise<boolean> => Promise.resolve(false),
  isInvertColorsEnabled: (): Promise<boolean> => Promise.resolve(false),
  isAccessibilityServiceEnabled: (): Promise<boolean> => Promise.resolve(false),
  prefersCrossFadeTransitions: (): Promise<boolean> => Promise.resolve(false),
  /** RN's default when no assistive timeout is set: the caller's own value. */
  getRecommendedTimeoutMillis: (original: number): Promise<number> => Promise.resolve(original),
  addEventListener: (_event: string, _cb: (...args: unknown[]) => void): Subscription => ({ remove() {} }),
  /** No a11y focus ring to move — there is no accessibility tree to move it in. */
  setAccessibilityFocus: (_reactTag: number): void => {},
  announceForAccessibility: (_announcement: string): void => {},
  announceForAccessibilityWithOptions: (_announcement: string, _options?: Record<string, unknown>): void => {},
  sendAccessibilityEvent: (_handle: unknown, _action: string): void => {},
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
  /**
   * iOS's "open this app's page in Settings.app". There is no OS settings page
   * for a web page, and no browser API grants one — a site cannot open the
   * user's notification or permission settings. Apps reach for this from a
   * "permission denied → Open Settings" button, so it resolves inertly rather
   * than throwing: the button does nothing, which is the truth, instead of
   * taking down the screen it is on.
   */
  openSettings: async (): Promise<void> => {},
  /** Android intents. No Android, no intents. */
  sendIntent: async (_action: string, _extras?: Array<{ key: string; value: string | number | boolean }>): Promise<void> => {},
};

/**
 * PlatformColor: RN resolves named system colors natively; a canvas host has
 * no system palette. Returns a neutral resolvable color so layouts render;
 * callers needing exact system colors should pass explicit values.
 */
export function PlatformColor(..._names: string[]): string {
  return '#000000';
}

// ---------------------------------------------------------------------------
// Remaining react-native surface that libraries import at module scope.
//
// The rule these all follow: a missing NAME breaks the importing module at
// link time, which takes out far more than the feature it belongs to. Each of
// these is either genuinely implementable here or an honest, documented inert
// stand-in — never a throw at import.
// ---------------------------------------------------------------------------

/**
 * React 18+ batches automatically, so this is a passthrough rather than a
 * no-op wrapper: callers rely on the callback running synchronously.
 */
export function unstable_batchedUpdates<T, R>(callback: (arg: T) => R, arg?: T): R {
  return callback(arg as T);
}

/** RN's global event bus. Real emitter — app code both emits and listens. */
class DeviceEventEmitterImpl {
  private listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  addListener(event: string, listener: (...args: unknown[]) => void): { remove(): void } {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(listener);
    return { remove: () => void set!.delete(listener) };
  }
  removeAllListeners(event?: string): void {
    if (event) this.listeners.get(event)?.clear();
    else this.listeners.clear();
  }
  removeSubscription(sub: { remove(): void }): void {
    sub.remove();
  }
  listenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0;
  }
  emit(event: string, ...args: unknown[]): void {
    for (const l of [...(this.listeners.get(event) ?? [])]) l(...args);
  }
}
export const DeviceEventEmitter = new DeviceEventEmitterImpl();

/** navigator.vibrate where available; silently absent otherwise (as on a device with it disabled). */
export const Vibration = {
  vibrate(pattern: number | number[] = 400, _repeat = false): void {
    try {
      (navigator as { vibrate?: (p: number | number[]) => boolean }).vibrate?.(pattern);
    } catch {
      /* refused without a user gesture */
    }
  },
  cancel(): void {
    try {
      (navigator as { vibrate?: (p: number | number[]) => boolean }).vibrate?.(0);
    } catch {
      /* nothing to cancel */
    }
  },
};

/** RN's internal profiler hooks; inert but shaped, because libraries call them in hot paths. */
export const Systrace = {
  installReactHook(): void {},
  setEnabled(_enabled: boolean): void {},
  beginEvent(_name?: string | (() => string), _args?: unknown): void {},
  endEvent(_args?: unknown): void {},
  beginAsyncEvent(_name?: string | (() => string)): number {
    return 0;
  },
  endAsyncEvent(): void {},
  counterEvent(): void {},
  isEnabled(): boolean {
    return false;
  },
};

/** Dev-menu controls; no dev menu exists on this host. */
export const DevSettings = {
  addMenuItem(_title: string, _handler: () => void): void {},
  reload(_reason?: string): void {
    if (typeof location !== 'undefined') location.reload();
  },
  onFastRefresh(): void {},
  setHotLoadingEnabled(_enabled: boolean): void {},
  setIsDebuggingRemotely(_enabled: boolean): void {},
  setProfilingEnabled(_enabled: boolean): void {},
};

/** Android-only in RN; accepted and inert so cross-platform code links. */
export const ToastAndroid = {
  SHORT: 0,
  LONG: 1,
  TOP: 0,
  BOTTOM: 1,
  CENTER: 2,
  show(_message: string, _duration: number): void {},
  showWithGravity(_m: string, _d: number, _g: number): void {},
  showWithGravityAndOffset(_m: string, _d: number, _g: number, _x: number, _y: number): void {},
};

/** Android runtime permissions; the browser brokers its own at point of use. */
export const PermissionsAndroid = {
  PERMISSIONS: new Proxy({} as Record<string, string>, { get: (_t, p) => String(p) }),
  RESULTS: { GRANTED: 'granted', DENIED: 'denied', NEVER_ASK_AGAIN: 'never_ask_again' } as const,
  async check(_permission: string): Promise<boolean> {
    return true;
  },
  async request(_permission: string): Promise<string> {
    return 'granted';
  },
  async requestMultiple(permissions: string[]): Promise<Record<string, string>> {
    return Object.fromEntries(permissions.map((p) => [p, 'granted']));
  },
};

/** iOS Settings.bundle values; none exist here, so reads are null. */
export const Settings = {
  get(_key: string): unknown {
    return null;
  },
  set(_settings: Record<string, unknown>): void {},
  watchKeys(_keys: string | string[], _callback: () => void): number {
    return 0;
  },
  clearWatch(_watchId: number): void {},
};

/** iOS action sheets — browser-native chrome, same trade as Alert. */
export const ActionSheetIOS = {
  showActionSheetWithOptions(
    options: { options: string[]; cancelButtonIndex?: number; title?: string; message?: string },
    callback: (index: number) => void
  ): void {
    const { options: labels, cancelButtonIndex, title, message } = options;
    if (typeof window === 'undefined' || typeof window.prompt !== 'function') {
      callback(cancelButtonIndex ?? 0);
      return;
    }
    const list = labels.map((l, i) => `${i}: ${l}`).join('\n');
    const answer = window.prompt(`${title ?? ''}${message ? `\n${message}` : ''}\n${list}`.trim(), '');
    const index = answer === null ? cancelButtonIndex ?? 0 : Number.parseInt(answer, 10);
    callback(Number.isFinite(index) && index >= 0 && index < labels.length ? index : cancelButtonIndex ?? 0);
  },
  showShareActionSheetWithOptions(
    _options: unknown,
    _onError: (e: Error) => void,
    onSuccess: (completed: boolean, method: string | null) => void
  ): void {
    onSuccess(false, null);
  },
  dismissActionSheet(): void {},
};

/**
 * iOS dynamic colors resolve per appearance. The engine paints one scheme at
 * a time, so this collapses to the light value — Appearance drives the rest.
 */
export function DynamicColorIOS(tuple: { light: string; dark: string; highContrastLight?: string; highContrastDark?: string }): string {
  return tuple.light;
}
