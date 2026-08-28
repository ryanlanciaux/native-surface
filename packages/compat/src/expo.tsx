/**
 * Compat shims for the Expo module boundary (docs/compat-strategy.md).
 * One file per documented package surface, re-exported via package.json
 * subpaths (expo, expo-font, expo-linking, expo-localization,
 * expo-application, expo-splash-screen, expo-system-ui).
 *
 * Design: font loading is REAL (bytes reach the engine's Skia font registry);
 * advisory chrome (splash screen, system UI) resolves as no-ops; localization
 * is backed by the browser's Intl/navigator surface.
 */
import * as React from 'react';
import { assertOpenable, isOpenableURL } from './url-safety';
import { initEngine } from 'native-surface';

/**
 * The `expo` package re-exports the whole expo-modules-core surface, and
 * local native modules import `requireNativeModule` from EITHER entry point
 * (observed in the wild importing from 'expo' directly). Both must carry it,
 * so the registry lives in one module and is re-exported here.
 */
export * from './expo-modules-core';

// ---------------------------------------------------------------------------
// expo (core): registerRootComponent
// ---------------------------------------------------------------------------

let registeredRoot: React.ComponentType | null = null;

/**
 * On native, registerRootComponent wires AppRegistry. On the canvas host the
 * embedder mounts the component inside a NativeSurface itself; we record it so
 * an embedder may read it back, and warn if nothing ever does.
 */
export function registerRootComponent<P>(component: React.ComponentType<P>): void {
  registeredRoot = component as React.ComponentType;
}

export function getRegisteredRootComponent(): React.ComponentType | null {
  return registeredRoot;
}

// ---------------------------------------------------------------------------
// expo-font
// ---------------------------------------------------------------------------

export type FontSource = string | { uri: string } | ArrayBuffer | { default?: string };

const loadedFamilies = new Set<string>();

function sourceToUrl(source: FontSource): string | null {
  if (typeof source === 'string') return source;
  if (source && typeof source === 'object') {
    if ('uri' in source && typeof source.uri === 'string') return source.uri;
    if ('default' in source && typeof source.default === 'string') return source.default;
  }
  return null;
}

export async function loadAsync(map: Record<string, FontSource> | string, source?: FontSource): Promise<void> {
  const entries: Array<[string, FontSource]> =
    typeof map === 'string' ? [[map, source as FontSource]] : Object.entries(map);
  const fonts = entries
    .map(([family, src]) => {
      if (src instanceof ArrayBuffer) return { family, data: src };
      const url = sourceToUrl(src);
      return url ? { family, url } : null;
    })
    .filter((f): f is NonNullable<typeof f> => f !== null);
  if (fonts.length === 0) return;
  await initEngine({ fonts });
  for (const f of fonts) loadedFamilies.add(f.family);
}

export function isLoaded(family: string): boolean {
  return loadedFamilies.has(family);
}

/** Same contract as expo-font's hook: [loaded, error]. */
export function useFonts(map: Record<string, FontSource>): [boolean, Error | null] {
  const [state, setState] = React.useState<[boolean, Error | null]>([false, null]);
  const keys = Object.keys(map).join('|');
  React.useEffect(() => {
    let alive = true;
    loadAsync(map)
      .then(() => alive && setState([true, null]))
      .catch((e: Error) => {
        console.error('expo-font shim: font load failed', e);
        if (alive) setState([false, e]);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys]);
  return state;
}

// ---------------------------------------------------------------------------
// expo-linking
// ---------------------------------------------------------------------------

export function createURL(path: string, _opts?: Record<string, unknown>): string {
  const base = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
  return new URL(path, base).toString();
}

export function parse(url: string): { scheme: string | null; hostname: string | null; path: string | null; queryParams: Record<string, string> } {
  try {
    const u = new URL(url);
    return {
      scheme: u.protocol.replace(':', ''),
      hostname: u.hostname,
      path: u.pathname,
      queryParams: Object.fromEntries(u.searchParams),
    };
  } catch {
    return { scheme: null, hostname: null, path: url, queryParams: {} };
  }
}

export async function openURL(url: string): Promise<boolean> {
  // See url-safety.ts: apps route USER-SUPPLIED links through here, and a
  // `javascript:` URL that is inert on a device runs in this page's origin.
  if (!assertOpenable(url, 'Linking.openURL')) return false;
  if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener');
  return true;
}

export async function canOpenURL(url: string): Promise<boolean> {
  return isOpenableURL(url);
}

export function useURL(): string | null {
  return typeof window !== 'undefined' ? window.location.href : null;
}

/**
 * Whether the launch URL has been consumed (see `clearInitialURL`).
 *
 * globalThis-keyed, not module-scoped: a bundler inlines this module into
 * every prebundled dependency that imports it, so an app clearing the URL
 * through one copy must be seen by the copy it later reads through.
 */
const linking = ((globalThis as unknown as { __nativeSurfaceLinking?: { consumed: boolean } }).__nativeSurfaceLinking ??= {
  consumed: false,
});

/** The address bar, unless the app has already consumed it. */
function launchURL(): string | null {
  if (linking.consumed) return null;
  return typeof location !== 'undefined' ? location.href : null;
}

/**
 * SDK 50+ additions. getLinkingURL is the synchronous "what launched this
 * app" accessor — on the web that is simply the current address.
 */
export function getLinkingURL(): string | null {
  return launchURL();
}

export function useLinkingURL(): string | null {
  return React.useSyncExternalStore(
    (onChange) => {
      if (typeof window === 'undefined') return () => {};
      window.addEventListener('popstate', onChange);
      window.addEventListener('hashchange', onChange);
      return () => {
        window.removeEventListener('popstate', onChange);
        window.removeEventListener('hashchange', onChange);
      };
    },
    () => launchURL(),
    () => null
  );
}

export function collectManifestSchemes(): string[] {
  return [];
}

/**
 * Clears the URL that launched the app, so a deep link is handled once.
 *
 * It does NOT touch the address bar, and that is the whole point. This used to
 * do `history.replaceState(history.state, '', location.pathname)`, reasoning
 * that on the web the address bar IS the launch URL. On a canvas host that
 * reasoning fails: the app is a COMPONENT inside somebody's page, and the URL
 * belongs to the host document, not to the app. Wiping it destroyed state the
 * app never owned — every `?flag=` an embedder or a harness had put there,
 * silently, seconds into boot, with no navigation to show for it.
 *
 * It was reached on every boot, not just on a real deep link: `getInitialURL()`
 * returns the current address, which is always truthy, so an app guarding with
 * `if (url) handle(url).finally(clearInitialURL)` clears unconditionally.
 *
 * What the callers actually want is the NATIVE semantics — expo-linking caches
 * the launch URL and replays it to every later reader, and clearing drops that
 * cache so a remount does not re-handle the same link. So that is what this
 * does: the launch URL is marked consumed and every subsequent
 * `getInitialURL` / `getLinkingURL` / `useLinkingURL` answers null. The app
 * gets the behaviour it asked for and the page keeps its URL.
 *
 * (expo-linking's own web build makes this a no-op, which also leaves the URL
 * alone but lets a remount re-handle the link. Marking it consumed is the
 * closer match to the native contract the caller is written against.)
 */
export async function clearInitialURL(): Promise<void> {
  linking.consumed = true;
}

export function addEventListener(_type: 'url', _cb: (e: { url: string }) => void): { remove: () => void } {
  return { remove: () => {} };
}

export async function getInitialURL(): Promise<string | null> {
  return launchURL();
}

// ---------------------------------------------------------------------------
// expo-localization
// ---------------------------------------------------------------------------

export interface Locale {
  languageTag: string;
  languageCode: string | null;
  regionCode: string | null;
  currencyCode: string | null;
  currencySymbol: string | null;
  decimalSeparator: string | null;
  digitGroupingSeparator: string | null;
  textDirection: 'ltr' | 'rtl';
  measurementSystem: 'metric' | 'us' | 'uk' | null;
  temperatureUnit: 'celsius' | 'fahrenheit' | null;
}

const RTL_LANGS = new Set(['ar', 'fa', 'he', 'ur', 'ps', 'sd', 'yi']);

export function getLocales(): Locale[] {
  const tags =
    typeof navigator !== 'undefined' && navigator.languages?.length ? navigator.languages : ['en-US'];
  return tags.map((tag) => {
    const [languageCode, regionCode] = tag.split('-');
    return {
      languageTag: tag,
      languageCode: languageCode ?? null,
      regionCode: regionCode ?? null,
      currencyCode: null,
      currencySymbol: null,
      decimalSeparator: '.',
      digitGroupingSeparator: ',',
      textDirection: RTL_LANGS.has(languageCode ?? '') ? 'rtl' : 'ltr',
      measurementSystem: null,
      temperatureUnit: null,
    };
  });
}

export function getCalendars(): Array<{ calendar: string | null; timeZone: string | null; uses24hourClock: boolean | null; firstWeekday: number | null }> {
  return [
    {
      calendar: 'gregory',
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
      uses24hourClock: null,
      firstWeekday: 1,
    },
  ];
}

export const locale = getLocales()[0]?.languageTag ?? 'en-US';

// ---------------------------------------------------------------------------
// expo-application
// ---------------------------------------------------------------------------

export const nativeApplicationVersion: string | null = '1.0.0';
export const nativeBuildVersion: string | null = '1';
export const applicationName: string | null = 'native-surface-app';
export const applicationId: string | null = 'dev.wasm-playground.canvas';

// ---------------------------------------------------------------------------
// expo-splash-screen (advisory: nothing to hide on a canvas host)
// ---------------------------------------------------------------------------

export async function preventAutoHideAsync(): Promise<boolean> {
  return true;
}
export async function hideAsync(): Promise<boolean> {
  return true;
}
export function hide(): void {}
export function setOptions(_opts: { duration?: number; fade?: boolean }): void {}

// ---------------------------------------------------------------------------
// expo-system-ui (advisory)
// ---------------------------------------------------------------------------

export async function setBackgroundColorAsync(_color: string): Promise<void> {}
export async function getBackgroundColorAsync(): Promise<string | null> {
  return null;
}
