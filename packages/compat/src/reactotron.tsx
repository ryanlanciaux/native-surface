/**
 * Reactotron compat stubs (reactotron-react-native / -react-js /
 * -core-client / -react-native-mmkv). Dev tooling with a native/websocket
 * transport — inert here by design (advisory boundary). The client object is
 * an infinitely-chainable no-op so any configure().use().connect() pipeline
 * runs; `ArgType` carries the real enum values custom-command configs use.
 */

type AnyFn = (...args: unknown[]) => unknown;

/**
 * Callable + chainable: one alias target serves every reactotron package, so
 * the default export must work as the client object
 * (`Reactotron.configure().use(...).connect()`) AND as a plugin factory
 * (`mmkvPlugin({storage})` from reactotron-react-native-mmkv).
 */
function makeChainable(): AnyFn & Record<string, AnyFn> {
  const fn = (..._args: unknown[]) => proxy;
  const proxy = new Proxy(fn, {
    get: (_t, prop) => {
      if (prop === 'then') return undefined; // never thenable
      return (..._args: unknown[]) => proxy;
    },
    apply: () => proxy,
  }) as AnyFn & Record<string, AnyFn>;
  return proxy;
}

export const Reactotron = makeChainable();
export default Reactotron;

export const ArgType = { String: 'string', Number: 'number', Boolean: 'boolean' } as const;

export type ReactotronReactNative = typeof Reactotron;

/** reactotron-react-native-mmkv default export: plugin factory. */
export function mmkvPlugin(_config?: unknown): AnyFn {
  return () => ({});
}

export function openInEditor(): void {}
export function trackGlobalErrors(): AnyFn {
  return () => ({});
}
export function networking(): AnyFn {
  return () => ({});
}
