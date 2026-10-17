import type { Theme } from './story-types';

export interface Viewport {
  id: string;
  label: string;
  /** Logical points. The surface always lays out at this size; any visual
   *  shrink is a CSS transform on the whole device. */
  width: number;
  height: number;
  /** Safe-area insets the device declares to the surface (status bar / island, home indicator). */
  insets: { top: number; bottom: number };
  /** Display corner radius, points. */
  radius: number;
  /** OS chrome the frame draws over the top inset for screens; `none` for plain frames. */
  chrome: 'island' | 'notch-less' | 'android' | 'none';
  /** Platform the stories render as on this device (`Platform.OS`). */
  platform: Theme;
}

// iPhone point sizes, safe areas and display radii: the binding table in
// work/briefs/_iphones.md. Pixel and Square stay for the standalone tool.
export const VIEWPORTS: Viewport[] = [
  { id: 'iphone-16-pro', label: 'iPhone 16 Pro', width: 402, height: 874, insets: { top: 62, bottom: 34 }, radius: 62, chrome: 'island', platform: 'ios' },
  { id: 'iphone-16-pro-max', label: 'iPhone 16 Pro Max', width: 440, height: 956, insets: { top: 62, bottom: 34 }, radius: 62, chrome: 'island', platform: 'ios' },
  { id: 'iphone-16', label: 'iPhone 16 / 15', width: 393, height: 852, insets: { top: 59, bottom: 34 }, radius: 55, chrome: 'island', platform: 'ios' },
  { id: 'iphone-se', label: 'iPhone SE', width: 375, height: 667, insets: { top: 20, bottom: 0 }, radius: 0, chrome: 'notch-less', platform: 'ios' },
  { id: 'pixel-8', label: 'Pixel 8', width: 412, height: 915, insets: { top: 32, bottom: 24 }, radius: 36, chrome: 'android', platform: 'android' },
  { id: 'square', label: 'Square', width: 400, height: 400, insets: { top: 0, bottom: 0 }, radius: 0, chrome: 'none', platform: 'ios' },
];

/** The iPhone rows only: what an embed that shows real phones offers. */
export const IPHONES: Viewport[] = VIEWPORTS.filter((v) => v.id.startsWith('iphone-'));

export const DEFAULT_VIEWPORT: Viewport = VIEWPORTS[0]!;

export function matchViewport(width: number, height: number, list: Viewport[] = VIEWPORTS): Viewport | null {
  return list.find((v) => v.width === width && v.height === height) ?? null;
}

/** A free-form size (the Custom device, shoot mode's ?w/?h): no insets, no chrome. */
export function customViewport(width: number, height: number, platform: Theme = 'ios'): Viewport {
  return { id: 'custom', label: 'Custom', width, height, insets: { top: 0, bottom: 0 }, radius: 0, chrome: 'none', platform };
}
