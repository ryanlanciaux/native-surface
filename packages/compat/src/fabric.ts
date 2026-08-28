/**
 * react-native/Libraries/* stub — served for EVERY deep `react-native/
 * Libraries/…` import via the regex alias in nativeSurfaceAliases().
 *
 * Why one stub for the whole subtree: the preset aliases 'react-native' to a
 * FILE (the engine entry), so a deep import like
 * react-native/Libraries/ReactNative/ReactFabricPublicInstance/ReactFabricPublicInstance
 * resolves to `<engine file>/Libraries/…`. Dev survives — reanimated wraps
 * these requires in try/catch and the failed load just returns — but a
 * production build resolves the graph eagerly and exits 1 with
 * UNLOADABLE_DEPENDENCY / "Not a directory".
 *
 * Scope: the union of the three modules react-native-reanimated's web path
 * probes — ReactNative/ReactFabricPublicInstance/ReactFabricPublicInstance,
 * Renderer/shims/ReactNative, Renderer/shims/ReactFabric — as null-returning
 * no-ops. On web reanimated only calls these behind try/catch to look up
 * fabric host instances it has no other use for (its web animations drive
 * setNativeProps through refs it already holds), so `null` here is the
 * documented "no host instance on this platform" answer, not a silent lie.
 * Anything else under Libraries/* that lands here gets the same inert shape.
 */

type Noop = (...args: unknown[]) => null;
const noop: Noop = () => null;

// --- ReactNative/ReactFabricPublicInstance/ReactFabricPublicInstance -------
export const getNodeFromPublicInstance: Noop = noop;
export const getPublicInstanceFromInternalInstanceHandle: Noop = noop;
export const getNativeTagFromPublicInstance: Noop = noop;
export const getInternalInstanceHandleFromPublicInstance: Noop = noop;
export const createPublicInstance: Noop = noop;
export const createPublicTextInstance: Noop = noop;

// --- Renderer/shims/ReactNative + Renderer/shims/ReactFabric ---------------
// Both shims export a renderer-ish default object; consumers reach
// `.findHostInstance_DEPRECATED(ref)` / `.getPublicInstance(...)` on it.
export const findHostInstance_DEPRECATED: Noop = noop;
export const getPublicInstance: Noop = noop;
export const findNodeHandle: Noop = noop;

export const ReactNative = {
  findHostInstance_DEPRECATED,
  findNodeHandle,
  getPublicInstance,
};
export const ReactFabric = {
  findHostInstance_DEPRECATED,
  findNodeHandle,
  getPublicInstance,
  getNodeFromInternalInstanceHandle: noop,
};

// Default export doubles as the "module object" for `require()`-style
// consumers going through CJS interop, so property access works whichever
// interop shape the bundler picks.
const fabricStub = {
  getNodeFromPublicInstance,
  getPublicInstanceFromInternalInstanceHandle,
  getNativeTagFromPublicInstance,
  getInternalInstanceHandleFromPublicInstance,
  createPublicInstance,
  createPublicTextInstance,
  findHostInstance_DEPRECATED,
  findNodeHandle,
  getPublicInstance,
  ReactNative,
  ReactFabric,
};
export default fabricStub;
