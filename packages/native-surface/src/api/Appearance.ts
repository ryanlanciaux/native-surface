/**
 * Appearance — RN's color-scheme module.
 *
 * The only "system" signal a canvas host has is the embedding page's
 * `matchMedia('(prefers-color-scheme: dark)')`; where that doesn't exist (SSR,
 * headless test runs, an old JSDOM) the scheme reports 'light' and change
 * events never fire. RN 0.72+'s `setColorScheme()` override outranks the media
 * query until it is reset with null — the same precedence RN uses natively.
 *
 * MUST exist as a named export even for apps that never call it: libraries
 * that re-export the react-native surface from an ESM index (react-native-paper)
 * fail to LINK — the whole package, not just the dark-mode path — when a single
 * imported name is missing from the aliased module.
 */

export type ColorSchemeName = 'light' | 'dark' | null;

export interface AppearancePreferences {
  colorScheme: ColorSchemeName;
}

export type AppearanceChangeListener = (preferences: AppearancePreferences) => void;

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** Explicit setColorScheme() override; null = follow the media query. */
let override: ColorSchemeName = null;
const listeners = new Set<AppearanceChangeListener>();

/** `undefined` = not probed yet, `null` = this host has no matchMedia. */
let mediaQuery: MediaQueryList | null | undefined;
let mediaBound = false;

function queryList(): MediaQueryList | null {
  if (mediaQuery === undefined) {
    const mm = (globalThis as { matchMedia?: (q: string) => MediaQueryList }).matchMedia;
    // Probed once: a host either has matchMedia for its whole lifetime or never.
    mediaQuery = typeof mm === 'function' ? mm.call(globalThis, DARK_QUERY) : null;
  }
  return mediaQuery;
}

function notify(): void {
  const preferences: AppearancePreferences = { colorScheme: Appearance.getColorScheme() };
  // Copied: a listener may remove itself (or another) while being notified.
  for (const listener of [...listeners]) listener(preferences);
}

/** Media-query change is only interesting while the override is off. */
const onMediaChange = (): void => {
  if (override === null) notify();
};

/** Bound on the first listener, released with the last: a canvas host can be
 *  mounted and unmounted many times inside one page. */
function syncMediaBinding(): void {
  const list = queryList();
  if (!list) return;
  const want = listeners.size > 0;
  if (want === mediaBound) return;
  mediaBound = want;
  if (typeof list.addEventListener === 'function') {
    if (want) list.addEventListener('change', onMediaChange);
    else list.removeEventListener('change', onMediaChange);
  } else if (typeof list.addListener === 'function') {
    // Pre-2020 Safari / partial MediaQueryList polyfills.
    if (want) list.addListener(onMediaChange);
    else if (typeof list.removeListener === 'function') list.removeListener(onMediaChange);
  }
}

export const Appearance = {
  /** The override when one is set, else the page's preference, else 'light'. */
  getColorScheme(): ColorSchemeName {
    if (override !== null) return override;
    return queryList()?.matches ? 'dark' : 'light';
  },

  /** RN 0.72+: forces the reported scheme; `null` restores the media query.
   *  Notifies listeners, since the reported value just changed. */
  setColorScheme(scheme: ColorSchemeName): void {
    if (override === scheme) return;
    const before = Appearance.getColorScheme();
    override = scheme;
    if (Appearance.getColorScheme() !== before) notify();
  },

  addChangeListener(listener: AppearanceChangeListener): { remove(): void } {
    listeners.add(listener);
    syncMediaBinding();
    return {
      remove(): void {
        Appearance.removeChangeListener(listener);
      },
    };
  },

  removeChangeListener(listener: AppearanceChangeListener): void {
    listeners.delete(listener);
    syncMediaBinding();
  },
};
