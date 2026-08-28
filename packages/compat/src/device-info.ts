/**
 * react-native-device-info compat shim — a stable simulated iOS device.
 *
 * Boundary-general (docs/compat-strategy.md): implements the common getters
 * as named exports AND as the default export. The identity is a consistent
 * fiction: the surface simulates an iPhone 13 (notch, no Dynamic Island), so
 * getSystemName/getModel/getDeviceId/hasNotch/hasDynamicIsland agree with
 * each other. App/version strings match the expo-application shim in
 * expo.tsx. getUniqueId is a uuid minted once and persisted in localStorage
 * ("rn-device-info:uniqueId"), so it is stable across reloads; without
 * localStorage it is stable per JS realm.
 *
 * The default export is a Proxy over the real object: react-native-device-info
 * has ~100 getters and apps call obscure ones (getCarrier, getApiLevel, ...)
 * in telemetry paths — an undefined method there would crash an otherwise
 * working app. Any getter this file does not implement returns a warn-once
 * stub function that resolves to null (or returns null directly for *Sync
 * names). Named imports of unimplemented getters still fail at build time,
 * which is the honest signal for code that actually branches on the value.
 */

const UNIQUE_ID_KEY = 'rn-device-info:uniqueId';
let memoryUniqueId: string | null = null;

function storageAvailable(): Storage | null {
  try {
    if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
  } catch {
    /* SSR / privacy mode */
  }
  return null;
}

function makeUuid(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    /* insecure context */
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 3) | 8).toString(16);
  });
}

function getOrCreateUniqueId(): string {
  const ls = storageAvailable();
  if (ls) {
    const existing = ls.getItem(UNIQUE_ID_KEY);
    if (existing) return existing;
    const id = makeUuid();
    ls.setItem(UNIQUE_ID_KEY, id);
    return id;
  }
  if (!memoryUniqueId) memoryUniqueId = makeUuid();
  return memoryUniqueId;
}

export function getApplicationName(): string {
  return 'native-surface-app';
}
export function getBundleId(): string {
  return 'dev.wasm-playground.canvas';
}
export function getVersion(): string {
  return '1.0.0';
}
export function getBuildNumber(): string {
  return '1';
}
export function getReadableVersion(): string {
  return `${getVersion()}.${getBuildNumber()}`;
}
export function getSystemName(): string {
  return 'iOS';
}
export function getSystemVersion(): string {
  return '17.0';
}
export function getModel(): string {
  return 'iPhone';
}
export function getBrand(): string {
  return 'Apple';
}
/** Machine identifier consistent with the simulated iPhone 13. */
export function getDeviceId(): string {
  return 'iPhone14,5';
}
export async function getUniqueId(): Promise<string> {
  return getOrCreateUniqueId();
}
export function getUniqueIdSync(): string {
  return getOrCreateUniqueId();
}
export function isTablet(): boolean {
  return false;
}
export function hasNotch(): boolean {
  return true;
}
export function hasDynamicIsland(): boolean {
  return false;
}
export async function isEmulator(): Promise<boolean> {
  return false;
}
export async function getFontScale(): Promise<number> {
  return 1;
}
export function getFontScaleSync(): number {
  return 1;
}
export async function getUserAgent(): Promise<string> {
  return typeof navigator !== 'undefined' ? navigator.userAgent : 'native-surface';
}
export function getUserAgentSync(): string {
  return typeof navigator !== 'undefined' ? navigator.userAgent : 'native-surface';
}
export function getDeviceType(): string {
  return 'Handset';
}

const implemented = {
  getApplicationName,
  getBundleId,
  getVersion,
  getBuildNumber,
  getReadableVersion,
  getSystemName,
  getSystemVersion,
  getModel,
  getBrand,
  getDeviceId,
  getUniqueId,
  getUniqueIdSync,
  isTablet,
  hasNotch,
  hasDynamicIsland,
  isEmulator,
  getFontScale,
  getFontScaleSync,
  getUserAgent,
  getUserAgentSync,
  getDeviceType,
};

const warnedStubs = new Set<string>();

const DeviceInfo = new Proxy(implemented, {
  get(target, prop, receiver) {
    if (prop in target) return Reflect.get(target, prop, receiver);
    // Interop probes must not look like getters.
    if (typeof prop !== 'string' || prop === 'then' || prop === '__esModule' || prop === '$$typeof') return undefined;
    return (..._args: unknown[]) => {
      if (!warnedStubs.has(prop)) {
        warnedStubs.add(prop);
        console.warn(`compat device-info: ${prop}() is not implemented on the canvas host; returning null.`);
      }
      return prop.endsWith('Sync') ? null : Promise.resolve(null);
    };
  },
}) as typeof implemented & Record<string, (...args: unknown[]) => unknown>;

export default DeviceInfo;
