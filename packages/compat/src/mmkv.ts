/**
 * react-native-mmkv compat shim — localStorage-backed.
 *
 * Boundary-general (docs/compat-strategy.md): implements the package's
 * documented v3 API — MMKV class (set/getString/getNumber/getBoolean/
 * getBuffer/contains/delete/getAllKeys/clearAll/recrypt/trim, value-change
 * listeners) plus the React hooks. Instances are namespaced by `id` so
 * separate stores do not collide; the default id matches upstream
 * ("mmkv.default"). Numbers/booleans/strings store natively; buffers store
 * base64. Encryption keys are accepted and ignored (browser storage — noted,
 * not hidden: a one-time console.info states values are plaintext).
 */
import * as React from 'react';

export interface MMKVConfiguration {
  id?: string;
  path?: string;
  encryptionKey?: string;
  mode?: number;
  readOnly?: boolean;
}

export const Mode = { SINGLE_PROCESS: 1, MULTI_PROCESS: 2 } as const;

type Listener = (key: string) => void;

let warnedEncryption = false;

function storageAvailable(): Storage | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    /* SSR / privacy mode */
  }
  return null;
}

export class MMKV {
  private readonly prefix: string;
  private readonly listeners = new Set<Listener>();
  private readonly memory = new Map<string, string>(); // fallback when localStorage is unavailable

  constructor(config: MMKVConfiguration = {}) {
    const id = config.id ?? 'mmkv.default';
    this.prefix = `rn-mmkv:${id}:`;
    if (config.encryptionKey && !warnedEncryption) {
      warnedEncryption = true;
      console.info('compat mmkv: encryptionKey accepted but ignored — browser storage is plaintext.');
    }
  }

  private k(key: string): string {
    return this.prefix + key;
  }

  private read(key: string): string | undefined {
    const ls = storageAvailable();
    const raw = ls ? ls.getItem(this.k(key)) : (this.memory.get(this.k(key)) ?? null);
    return raw === null ? undefined : raw;
  }

  private write(key: string, raw: string | undefined): void {
    const ls = storageAvailable();
    if (raw === undefined) {
      if (ls) ls.removeItem(this.k(key));
      else this.memory.delete(this.k(key));
    } else {
      if (ls) ls.setItem(this.k(key), raw);
      else this.memory.set(this.k(key), raw);
    }
    for (const l of this.listeners) l(key);
  }

  set(key: string, value: string | number | boolean | ArrayBuffer | Uint8Array): void {
    if (typeof value === 'string') this.write(key, `s${value}`);
    else if (typeof value === 'number') this.write(key, `n${String(value)}`);
    else if (typeof value === 'boolean') this.write(key, `b${value ? '1' : '0'}`);
    else {
      const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : value;
      let bin = '';
      for (const b of bytes) bin += String.fromCharCode(b);
      this.write(key, `u${btoa(bin)}`);
    }
  }

  getString(key: string): string | undefined {
    const raw = this.read(key);
    return raw?.startsWith('s') ? raw.slice(1) : undefined;
  }

  getNumber(key: string): number | undefined {
    const raw = this.read(key);
    return raw?.startsWith('n') ? Number(raw.slice(1)) : undefined;
  }

  getBoolean(key: string): boolean | undefined {
    const raw = this.read(key);
    return raw?.startsWith('b') ? raw.slice(1) === '1' : undefined;
  }

  getBuffer(key: string): ArrayBuffer | undefined {
    const raw = this.read(key);
    if (!raw?.startsWith('u')) return undefined;
    const bin = atob(raw.slice(1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }

  contains(key: string): boolean {
    return this.read(key) !== undefined;
  }

  delete(key: string): void {
    this.write(key, undefined);
  }

  getAllKeys(): string[] {
    const ls = storageAvailable();
    const keys: string[] = [];
    if (ls) {
      for (let i = 0; i < ls.length; i++) {
        const full = ls.key(i);
        if (full?.startsWith(this.prefix)) keys.push(full.slice(this.prefix.length));
      }
    } else {
      for (const full of this.memory.keys()) {
        if (full.startsWith(this.prefix)) keys.push(full.slice(this.prefix.length));
      }
    }
    return keys;
  }

  clearAll(): void {
    for (const key of this.getAllKeys()) this.delete(key);
  }

  recrypt(_key: string | undefined): void {
    /* plaintext store; accepted for API compatibility */
  }

  trim(): void {}

  get size(): number {
    return this.getAllKeys().length;
  }

  addOnValueChangedListener(listener: Listener): { remove: () => void } {
    this.listeners.add(listener);
    return { remove: () => this.listeners.delete(listener) };
  }

  toString(): string {
    return `MMKV(${this.prefix})`;
  }
}

// ---------------------------------------------------------------------------
// Hooks (documented react-native-mmkv surface)
// ---------------------------------------------------------------------------

const defaultInstance = /* lazy */ { current: null as MMKV | null };

function resolveInstance(instance?: MMKV): MMKV {
  if (instance) return instance;
  if (!defaultInstance.current) defaultInstance.current = new MMKV();
  return defaultInstance.current;
}

function useMMKVValue<T>(
  key: string,
  instance: MMKV | undefined,
  get: (m: MMKV, k: string) => T | undefined
): [T | undefined, (value: T | undefined) => void] {
  const mmkv = resolveInstance(instance);
  const subscribe = React.useCallback(
    (cb: () => void) => {
      const sub = mmkv.addOnValueChangedListener((changed) => {
        if (changed === key) cb();
      });
      return () => sub.remove();
    },
    [mmkv, key]
  );
  const value = React.useSyncExternalStore(subscribe, () => get(mmkv, key));
  const setValue = React.useCallback(
    (v: T | undefined) => {
      if (v === undefined) mmkv.delete(key);
      else mmkv.set(key, v as never);
    },
    [mmkv, key]
  );
  return [value, setValue];
}

export function useMMKVString(key: string, instance?: MMKV) {
  return useMMKVValue<string>(key, instance, (m, k) => m.getString(k));
}
export function useMMKVNumber(key: string, instance?: MMKV) {
  return useMMKVValue<number>(key, instance, (m, k) => m.getNumber(k));
}
export function useMMKVBoolean(key: string, instance?: MMKV) {
  return useMMKVValue<boolean>(key, instance, (m, k) => m.getBoolean(k));
}
export function useMMKVObject<T>(key: string, instance?: MMKV): [T | undefined, (value: T | undefined) => void] {
  const [json, setJson] = useMMKVString(key, instance);
  const value = React.useMemo(() => (json === undefined ? undefined : (JSON.parse(json) as T)), [json]);
  const setValue = React.useCallback(
    (v: T | undefined) => setJson(v === undefined ? undefined : JSON.stringify(v)),
    [setJson]
  );
  return [value, setValue];
}
export function useMMKV(config?: MMKVConfiguration): MMKV {
  return React.useMemo(() => (config ? new MMKV(config) : resolveInstance()), [JSON.stringify(config ?? null)]);
}
