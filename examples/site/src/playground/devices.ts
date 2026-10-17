// Environment devices for the playground: the native-surface playground's own
// viewport list (packages/playground/src/viewports.ts) plus the design's
// default iPhone 16 Pro, with the safe-area insets each one declares to the
// surface (status bar / island, home indicator).
import { VIEWPORTS, type Viewport } from '@native-surface/playground/src/viewports';

export interface Device extends Viewport {
  insets: { top: number; bottom: number };
  /** DOM status bar drawn over the top inset for screens. */
  chrome: 'island' | 'notch-less' | 'android';
  /** Corner radius of the screen, CSS px. */
  radius: number;
}

const EXTRA: Record<string, Omit<Device, keyof Viewport>> = {
  'iphone-16-pro': { insets: { top: 62, bottom: 34 }, chrome: 'island', radius: 55 },
  'iphone-16': { insets: { top: 59, bottom: 34 }, chrome: 'island', radius: 47 },
  'iphone-se': { insets: { top: 20, bottom: 0 }, chrome: 'notch-less', radius: 0 },
  'pixel-8': { insets: { top: 32, bottom: 24 }, chrome: 'android', radius: 36 },
};

export const DEVICES: Device[] = [
  { id: 'iphone-16-pro', label: 'iPhone 16 Pro', width: 402, height: 874 },
  // `Square` is a component frame, not a device: the canvas already frames components.
  ...VIEWPORTS.filter((v) => v.id in EXTRA),
].map((v) => ({ ...v, ...EXTRA[v.id]! }));

export const DEFAULT_DEVICE = DEVICES[0]!;

/** Screen padding of the Ignite app (spacing.lg on each side): components lay out at device width minus this. */
export const SCREEN_GUTTER = 24;

export function contentWidth(device: Device): number {
  return device.width - 2 * SCREEN_GUTTER;
}
