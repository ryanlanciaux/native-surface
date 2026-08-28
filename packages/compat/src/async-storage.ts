/**
 * @react-native-async-storage/async-storage compat shim — localStorage-backed.
 *
 * Boundary-general (docs/compat-strategy.md): implements the package's
 * documented API — the AsyncStorage default export (getItem/setItem/removeItem/
 * mergeItem/clear/getAllKeys/multiGet/multiSet/multiRemove/multiMerge/
 * flushGetRequests) plus the useAsyncStorage hook. Every method returns a
 * Promise AND honors the optional trailing callback, matching the documented
 * value-or-callback signatures (single-error callbacks for item ops, error-
 * array callbacks for multi ops).
 *
 * Keys are namespaced under "rn-async-storage:" (mirrors mmkv.ts's convention)
 * so the shim shares the page's localStorage without colliding with other
 * stores. Consequence: clear() erases only this namespace — on a shared
 * browser origin the documented "erase everything" contract would destroy
 * unrelated page state (including the mmkv shim's keys). Falls back to a
 * module-level in-memory Map when localStorage is unavailable (SSR / privacy
 * mode); that fallback lives as long as the JS realm, so reads-after-writes
 * stay consistent but nothing persists across reloads.
 *
 * mergeItem/multiMerge implement the documented recursive JSON merge: nested
 * plain objects merge key-by-key, scalars and arrays are replaced. Non-JSON
 * values reject (and report through the callback), matching upstream's
 * "existing and new values must be valid JSON" contract.
 */
import * as React from 'react';

type SingleCallback<T> = (error?: Error | null, result?: T) => void;
type MultiCallback<T> = (errors?: readonly (Error | null)[] | null, result?: T) => void;

const PREFIX = 'rn-async-storage:';
const memory = new Map<string, string>(); // fallback when localStorage is unavailable

function storageAvailable(): Storage | null {
  try {
    if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
  } catch {
    /* SSR / privacy mode */
  }
  return null;
}

function readRaw(key: string): string | null {
  const ls = storageAvailable();
  return ls ? ls.getItem(PREFIX + key) : (memory.get(PREFIX + key) ?? null);
}

function writeRaw(key: string, value: string): void {
  const ls = storageAvailable();
  if (ls) ls.setItem(PREFIX + key, value);
  else memory.set(PREFIX + key, value);
}

function removeRaw(key: string): void {
  const ls = storageAvailable();
  if (ls) ls.removeItem(PREFIX + key);
  else memory.delete(PREFIX + key);
}

function allKeys(): string[] {
  const ls = storageAvailable();
  const keys: string[] = [];
  if (ls) {
    for (let i = 0; i < ls.length; i++) {
      const full = ls.key(i);
      if (full?.startsWith(PREFIX)) keys.push(full.slice(PREFIX.length));
    }
  } else {
    for (const full of memory.keys()) {
      if (full.startsWith(PREFIX)) keys.push(full.slice(PREFIX.length));
    }
  }
  return keys;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function deepMerge(target: unknown, patch: unknown): unknown {
  if (isPlainObject(target) && isPlainObject(patch)) {
    const out: Record<string, unknown> = { ...target };
    for (const [k, v] of Object.entries(patch)) out[k] = deepMerge(out[k], v);
    return out;
  }
  return patch;
}

function mergeRaw(key: string, value: string): void {
  const existing = readRaw(key);
  if (existing === null) {
    writeRaw(key, value);
    return;
  }
  writeRaw(key, JSON.stringify(deepMerge(JSON.parse(existing), JSON.parse(value))));
}

async function run<T>(op: () => T, callback?: SingleCallback<T>): Promise<T> {
  try {
    const result = op();
    callback?.(null, result);
    return result;
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    callback?.(error);
    throw error;
  }
}

async function runMulti<T>(op: () => T, callback?: MultiCallback<T>): Promise<T> {
  try {
    const result = op();
    callback?.(null, result);
    return result;
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    callback?.([error]);
    throw error;
  }
}

const AsyncStorage = {
  getItem: (key: string, callback?: SingleCallback<string | null>): Promise<string | null> =>
    run(() => readRaw(key), callback),

  setItem: (key: string, value: string, callback?: SingleCallback<void>): Promise<void> =>
    run(() => {
      writeRaw(key, value);
    }, callback),

  removeItem: (key: string, callback?: SingleCallback<void>): Promise<void> =>
    run(() => {
      removeRaw(key);
    }, callback),

  mergeItem: (key: string, value: string, callback?: SingleCallback<void>): Promise<void> =>
    run(() => {
      mergeRaw(key, value);
    }, callback),

  /** Erases this shim's namespace only — see the header note on shared localStorage. */
  clear: (callback?: SingleCallback<void>): Promise<void> =>
    run(() => {
      for (const k of allKeys()) removeRaw(k);
    }, callback),

  getAllKeys: (callback?: SingleCallback<readonly string[]>): Promise<readonly string[]> =>
    run(() => allKeys(), callback),

  multiGet: (
    keys: readonly string[],
    callback?: MultiCallback<readonly [string, string | null][]>
  ): Promise<readonly [string, string | null][]> =>
    runMulti(() => keys.map((k): [string, string | null] => [k, readRaw(k)]), callback),

  multiSet: (pairs: ReadonlyArray<[string, string]>, callback?: MultiCallback<void>): Promise<void> =>
    runMulti(() => {
      for (const [k, v] of pairs) writeRaw(k, v);
    }, callback),

  multiRemove: (keys: readonly string[], callback?: MultiCallback<void>): Promise<void> =>
    runMulti(() => {
      for (const k of keys) removeRaw(k);
    }, callback),

  multiMerge: (pairs: ReadonlyArray<[string, string]>, callback?: MultiCallback<void>): Promise<void> =>
    runMulti(() => {
      for (const [k, v] of pairs) mergeRaw(k, v);
    }, callback),

  /** Upstream batches native reads; the backing store here is synchronous, so nothing to flush. */
  flushGetRequests: (): void => {},
};

export default AsyncStorage;
export { AsyncStorage };

/** Documented hook: key-bound handle over the same store. */
export function useAsyncStorage(key: string) {
  return React.useMemo(
    () => ({
      getItem: (callback?: SingleCallback<string | null>) => AsyncStorage.getItem(key, callback),
      setItem: (value: string, callback?: SingleCallback<void>) => AsyncStorage.setItem(key, value, callback),
      mergeItem: (value: string, callback?: SingleCallback<void>) => AsyncStorage.mergeItem(key, value, callback),
      removeItem: (callback?: SingleCallback<void>) => AsyncStorage.removeItem(key, callback),
    }),
    [key]
  );
}
