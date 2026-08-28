/**
 * expo-modules-core compat — the bridging seam for LOCAL native modules.
 *
 * Expo apps reach their own native code through string names:
 *
 *   const Sheet = requireNativeModule('BottomSheet')
 *   const GifView = requireNativeViewManager('ExpoBlueskyGifView')
 *
 * Those modules live inside the app (imported by relative path), so there is
 * nothing for the Vite preset to alias — per-package aliasing cannot reach
 * them. What CAN reach them is this registry: a host registers a web
 * implementation under the same name, and every `requireNativeModule` call
 * in the app tree resolves to it.
 *
 *   import { registerNativeModule } from '@native-surface/compat/expo-modules-core'
 *   registerNativeModule('BottomSheet', { dismissAll() {} })
 *
 * Resolution contract (matches the real package, which apps branch on):
 * - `requireNativeModule(name)` NEVER throws at import — a module-scope
 *   `requireNativeModule('X')` in an unbridged package must not kill the
 *   bundle. It returns a proxy that throws an actionable error on first USE,
 *   so the failure names the module and arrives where the call is.
 * - `requireOptionalNativeModule(name)` returns null when unregistered. That
 *   is the documented graceful path and libraries test for it.
 * - `requireNativeView(name)` / `requireNativeViewManager(name)` fall back to
 *   a View passthrough: a missing native VIEW should degrade to an empty box
 *   rather than break the render tree it sits in.
 */
import * as React from 'react';
import { View } from 'native-surface';

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const moduleRegistry = new Map<string, unknown>();
const viewRegistry = new Map<string, React.ComponentType<Record<string, unknown>>>();
/** Requested but unregistered — the host-facing diagnostic of what an app wanted. */
const missing = new Set<string>();
const warned = new Set<string>();

function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}

/** Supply the web implementation of a local native module. */
export function registerNativeModule<T>(name: string, impl: T): T {
  moduleRegistry.set(name, impl);
  missing.delete(name);
  return impl;
}

/** Supply the web implementation of a local native view. */
export function registerNativeView(
  name: string,
  component: React.ComponentType<Record<string, unknown>>
): React.ComponentType<Record<string, unknown>> {
  viewRegistry.set(name, component);
  missing.delete(name);
  return component;
}

export function getRegisteredNativeModules(): string[] {
  return [...moduleRegistry.keys(), ...viewRegistry.keys()];
}

/** Names an app asked for that nothing registered — what still needs bridging. */
export function getMissingNativeModules(): string[] {
  return [...missing];
}

/** Proxy that survives import and reports precisely on use. */
function unavailableModule(name: string): Record<string, never> {
  const fail = (): never => {
    throw new Error(
      `native-surface: native module '${name}' has no web implementation. ` +
        `Register one with registerNativeModule('${name}', impl) from ` +
        `'@native-surface/compat/expo-modules-core', or use ` +
        `requireOptionalNativeModule('${name}') and branch on null.`
    );
  };
  return new Proxy(
    {},
    {
      get(_t, prop) {
        // Interop probes must stay silent, or the proxy masquerades as a
        // thenable/module namespace and breaks await + ESM interop.
        if (prop === 'then' || prop === '__esModule' || prop === Symbol.toStringTag) return undefined;
        return fail();
      },
      apply: fail,
      construct: fail,
    }
  ) as Record<string, never>;
}

export function requireNativeModule<T = Record<string, never>>(name: string): T {
  const found = moduleRegistry.get(name);
  if (found !== undefined) return found as T;
  missing.add(name);
  warnOnce(
    `mod:${name}`,
    `native-surface: no web implementation for native module '${name}' — calls into it will throw. ` +
      `Register one with registerNativeModule('${name}', impl).`
  );
  return unavailableModule(name) as T;
}

export function requireOptionalNativeModule<T = unknown>(name: string): T | null {
  const found = moduleRegistry.get(name);
  if (found !== undefined) return found as T;
  missing.add(name);
  return null;
}

function passthroughView(name: string): React.ComponentType<Record<string, unknown>> {
  const Passthrough = ({ children, ...rest }: Record<string, unknown> & { children?: React.ReactNode }) => {
    warnOnce(
      `view:${name}`,
      `native-surface: no web implementation for native view '${name}' — rendering an empty View. ` +
        `Register one with registerNativeView('${name}', Component).`
    );
    // Only style/children are safe to forward blind; native view props are
    // arbitrary and would reach the engine as unknown props.
    return <View style={(rest as { style?: unknown }).style as never}>{children}</View>;
  };
  Passthrough.displayName = `NativeView(${name})`;
  return Passthrough as React.ComponentType<Record<string, unknown>>;
}

export function requireNativeView(name: string): React.ComponentType<Record<string, unknown>> {
  const found = viewRegistry.get(name);
  if (found) return found;
  missing.add(name);
  return passthroughView(name);
}

export const requireNativeViewManager = requireNativeView;

// ---------------------------------------------------------------------------
// Event emitter + module base classes
// ---------------------------------------------------------------------------

export type EventSubscription = { remove(): void };

/** The documented EventEmitter shape modules extend or instantiate. */
export class EventEmitter<TEvents extends Record<string, (...args: never[]) => void> = Record<string, (...args: never[]) => void>> {
  private listeners = new Map<string, Set<(...args: never[]) => void>>();

  addListener<K extends keyof TEvents & string>(event: K, listener: TEvents[K]): EventSubscription {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(listener);
    return { remove: () => void set!.delete(listener) };
  }

  removeListener<K extends keyof TEvents & string>(event: K, listener: TEvents[K]): void {
    this.listeners.get(event)?.delete(listener);
  }

  removeAllListeners(event?: string): void {
    if (event) this.listeners.get(event)?.clear();
    else this.listeners.clear();
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  emit<K extends keyof TEvents & string>(event: K, ...args: Parameters<TEvents[K]>): void {
    for (const l of [...(this.listeners.get(event) ?? [])]) (l as (...a: unknown[]) => void)(...args);
  }
}

/** Base class app modules extend (`class Foo extends NativeModule {}`). */
export class NativeModule<TEvents extends Record<string, (...args: never[]) => void> = Record<string, (...args: never[]) => void>> extends EventEmitter<TEvents> {
  [key: string]: unknown;
}

/** Native-backed handles; on this host they are plain JS objects. */
export class SharedObject<TEvents extends Record<string, (...args: never[]) => void> = Record<string, (...args: never[]) => void>> extends EventEmitter<TEvents> {
  release(): void {}
}

export class SharedRef<TNativeRefType extends string = string, TEvents extends Record<string, (...args: never[]) => void> = Record<string, (...args: never[]) => void>> extends SharedObject<TEvents> {
  nativeRefType: TNativeRefType = 'unknown' as TNativeRefType;
}

/** Legacy bridge proxy: reads resolve through the same registry. */
export const NativeModulesProxy: Record<string, unknown> = new Proxy(
  {},
  {
    get: (_t, prop) => (typeof prop === 'string' ? requireOptionalNativeModule(prop) ?? undefined : undefined),
    has: (_t, prop) => typeof prop === 'string' && moduleRegistry.has(prop),
  }
);

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

export const PermissionStatus = {
  GRANTED: 'granted',
  UNDETERMINED: 'undetermined',
  DENIED: 'denied',
} as const;
export type PermissionStatus = (typeof PermissionStatus)[keyof typeof PermissionStatus];

export interface PermissionResponse {
  status: PermissionStatus;
  granted: boolean;
  canAskAgain: boolean;
  expires: 'never' | number;
}

export const GRANTED_PERMISSION: PermissionResponse = {
  status: PermissionStatus.GRANTED,
  granted: true,
  canAskAgain: true,
  expires: 'never',
};

/**
 * expo-modules-core's hook factory. Browser capabilities gate themselves at
 * the point of use (the file dialog IS the consent step), so a permission
 * this host cannot broker reports granted and lets the real API decide.
 */
export function createPermissionHook<TOptions = unknown>(methods: {
  getMethod?: (options?: TOptions) => Promise<PermissionResponse>;
  requestMethod?: (options?: TOptions) => Promise<PermissionResponse>;
  getMethodName?: string;
}): (
  options?: TOptions
) => [PermissionResponse | null, () => Promise<PermissionResponse>, () => Promise<PermissionResponse>] {
  return function usePermissions(options?: TOptions) {
    const [response, setResponse] = React.useState<PermissionResponse | null>(null);
    const get = React.useCallback(async () => {
      const r = (await methods.getMethod?.(options)) ?? GRANTED_PERMISSION;
      setResponse(r);
      return r;
    }, [options]);
    const request = React.useCallback(async () => {
      const r = (await methods.requestMethod?.(options)) ?? GRANTED_PERMISSION;
      setResponse(r);
      return r;
    }, [options]);
    React.useEffect(() => {
      void get();
    }, [get]);
    return [response, request, get];
  };
}

// ---------------------------------------------------------------------------
// Misc surface
// ---------------------------------------------------------------------------

export class UnavailabilityError extends Error {
  constructor(moduleName: string, propertyName: string) {
    super(`native-surface: ${moduleName}.${propertyName} is not available on this platform.`);
    this.name = 'UnavailabilityError';
  }
}

export class CodedError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'CodedError';
  }
}

/** Not Expo Go, and not a native runtime: a browser canvas host. */
export const isRunningInExpoGo = (): boolean => false;
export const ExecutionEnvironment = { Bare: 'bare', Standalone: 'standalone', StoreClient: 'storeClient' } as const;

export const Platform = {
  OS: 'ios' as const,
  select: <T,>(specifics: { ios?: T; android?: T; native?: T; default?: T; web?: T }): T | undefined =>
    specifics.ios ?? specifics.native ?? specifics.default,
};

export async function reloadAppAsync(_reason?: string): Promise<void> {
  if (typeof location !== 'undefined') location.reload();
}

export function uuidv4(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
export const uuid = { v4: uuidv4, v5: (name: string) => uuidv4() + name.length.toString(16).slice(0, 0) };

// ---------------------------------------------------------------------------
// Generic implementation factories
//
// Boundary-general building blocks for the module shapes that recur across
// apps. They are exported, not auto-registered: the NAMES are app-specific,
// so a host wires them up in one line.
// ---------------------------------------------------------------------------

/** localStorage-backed key/value module (the shared-preferences shape). */
export function createSharedPrefsModule(namespace = 'expo-shared-prefs'): Record<string, unknown> {
  const key = (k: string) => `${namespace}:${k}`;
  const mem = new Map<string, string>();
  const store = () => {
    try {
      return typeof localStorage !== 'undefined' ? localStorage : null;
    } catch {
      return null;
    }
  };
  const read = (k: string): string | null => store()?.getItem(key(k)) ?? mem.get(key(k)) ?? null;
  const write = (k: string, v: string): void => {
    const ls = store();
    if (ls) ls.setItem(key(k), v);
    else mem.set(key(k), v);
  };
  const remove = (k: string): void => {
    store()?.removeItem(key(k));
    mem.delete(key(k));
  };
  const readSet = (k: string): string[] => {
    const raw = read(k);
    try {
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? (parsed as string[]) : [];
    } catch {
      return [];
    }
  };
  return {
    setStringAsync: async (k: string, v: string) => write(k, v),
    getStringAsync: async (k: string) => read(k),
    setBoolAsync: async (k: string, v: boolean) => write(k, JSON.stringify(v)),
    getBoolAsync: async (k: string) => (read(k) === null ? null : read(k) === 'true'),
    setValueAsync: async (k: string, v: unknown) => write(k, JSON.stringify(v)),
    getValueAsync: async (k: string) => {
      const raw = read(k);
      try {
        return raw === null ? null : (JSON.parse(raw) as unknown);
      } catch {
        return raw;
      }
    },
    removeValueAsync: async (k: string) => remove(k),
    addToSetAsync: async (k: string, v: string) => {
      const set = readSet(k);
      if (!set.includes(v)) write(k, JSON.stringify([...set, v]));
    },
    removeFromSetAsync: async (k: string, v: string) =>
      write(k, JSON.stringify(readSet(k).filter((x) => x !== v))),
    setContainsAsync: async (k: string, v: string) => readSet(k).includes(v),
  };
}

/** Advisory module: every named method resolves undefined. */
export function createNoopModule(name: string, methods: string[]): Record<string, unknown> {
  const impl: Record<string, unknown> = {};
  for (const m of methods) {
    impl[m] = async (...args: unknown[]) => {
      warnOnce(`noop:${name}.${m}`, `native-surface: ${name}.${m}() is a no-op on this host.`);
      void args;
      return undefined;
    };
  }
  return impl;
}

/**
 * Visibility-reporting view. The canvas has no DOM node per view, so there is
 * no IntersectionObserver target: this reports visible once on mount and
 * renders its children. Honest ceiling — scroll-driven visibility (autoplay
 * arbitration and the like) needs an engine-level viewport test.
 */
export function createVisibilityViewComponent(
  onVisibleProp = 'onChangeStatus'
): React.ComponentType<Record<string, unknown>> {
  const VisibilityView = (props: Record<string, unknown> & { children?: React.ReactNode }) => {
    const cb = props[onVisibleProp];
    React.useEffect(() => {
      if (typeof cb === 'function') (cb as (e: { nativeEvent: { isActive: boolean } }) => void)({ nativeEvent: { isActive: true } });
    }, [cb]);
    return <View style={(props as { style?: unknown }).style as never}>{props.children}</View>;
  };
  VisibilityView.displayName = 'VisibilityView';
  return VisibilityView as React.ComponentType<Record<string, unknown>>;
}
