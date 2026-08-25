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
import { initEngine } from 'native-surface';

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
  if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener');
  return true;
}

export async function canOpenURL(_url: string): Promise<boolean> {
  return true;
}

export function useURL(): string | null {
  return typeof window !== 'undefined' ? window.location.href : null;
}

export function addEventListener(_type: 'url', _cb: (e: { url: string }) => void): { remove: () => void } {
  return { remove: () => {} };
}

export async function getInitialURL(): Promise<string | null> {
  return typeof window !== 'undefined' ? window.location.href : null;
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
