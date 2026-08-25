export interface Viewport {
  id: string;
  label: string;
  width: number;
  height: number;
}

export const VIEWPORTS: Viewport[] = [
  { id: 'iphone-16', label: 'iPhone 16', width: 390, height: 844 },
  { id: 'iphone-se', label: 'iPhone SE', width: 375, height: 667 },
  { id: 'pixel-8', label: 'Pixel 8', width: 412, height: 915 },
  { id: 'square', label: 'Square', width: 400, height: 400 },
];

export const DEFAULT_VIEWPORT: Viewport = VIEWPORTS[0]!;

export function matchViewport(width: number, height: number): Viewport | null {
  return VIEWPORTS.find((v) => v.width === width && v.height === height) ?? null;
}
