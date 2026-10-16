import * as React from 'react';
import { initEngine } from 'native-surface';
import type { FontSpec } from 'native-surface';
import { typography } from './theme';

/**
 * Space Grotesk (SIL OFL 1.1, assets/fonts/LICENSE-SpaceGrotesk-OFL.txt),
 * bundled with the package. All four weights register under one family so
 * `fontWeight` picks the face, exactly like the engine's bundled Inter.
 */
export const igniteFonts: FontSpec[] = [
  { family: typography.family, weight: 400, url: new URL('../assets/fonts/SpaceGrotesk-Regular.ttf', import.meta.url).href },
  { family: typography.family, weight: 500, url: new URL('../assets/fonts/SpaceGrotesk-Medium.ttf', import.meta.url).href },
  { family: typography.family, weight: 600, url: new URL('../assets/fonts/SpaceGrotesk-SemiBold.ttf', import.meta.url).href },
  { family: typography.family, weight: 700, url: new URL('../assets/fonts/SpaceGrotesk-Bold.ttf', import.meta.url).href },
];

let fontsPromise: Promise<void> | null = null;
let fontsLoaded = false;

/**
 * Registers Space Grotesk with the native-surface engine (idempotent). Hosts
 * should await this before mounting a surface so the first paint already
 * uses the right metrics; `IgniteApp` and the catalog renderers also gate on it.
 */
export function loadIgniteFonts(): Promise<void> {
  if (!fontsPromise) {
    fontsPromise = initEngine({ fonts: igniteFonts }).then(() => {
      fontsLoaded = true;
    });
    fontsPromise.catch(() => {
      fontsPromise = null;
    });
  }
  return fontsPromise;
}

export function areIgniteFontsLoaded(): boolean {
  return fontsLoaded;
}

/** `[loaded, error]`, the same contract as expo-font's `useFonts`. */
export function useIgniteFonts(): [boolean, Error | null] {
  const [state, setState] = React.useState<[boolean, Error | null]>([fontsLoaded, null]);
  React.useEffect(() => {
    if (fontsLoaded) return;
    let alive = true;
    loadIgniteFonts()
      .then(() => alive && setState([true, null]))
      .catch((e: Error) => alive && setState([false, e]));
    return () => {
      alive = false;
    };
  }, []);
  return state;
}

/** Renders children once the fonts are registered (nothing before). */
export function IgniteFontGate({ children }: { children: React.ReactNode }): React.JSX.Element | null {
  const [loaded, error] = useIgniteFonts();
  // A font failure falls back to the engine's default family rather than
  // leaving the surface blank.
  if (!loaded && !error) return null;
  return <>{children}</>;
}
