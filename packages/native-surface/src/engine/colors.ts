import type { ColorValue } from '../types';

export interface RGBA {
  r: number; // 0-255
  g: number;
  b: number;
  a: number; // 0-1
}

const NAMED: Record<string, string> = {
  transparent: '#00000000',
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  yellow: '#ffff00',
  cyan: '#00ffff',
  magenta: '#ff00ff',
  gray: '#808080',
  grey: '#808080',
  lightgray: '#d3d3d3',
  lightgrey: '#d3d3d3',
  darkgray: '#a9a9a9',
  darkgrey: '#a9a9a9',
  silver: '#c0c0c0',
  orange: '#ffa500',
  purple: '#800080',
  pink: '#ffc0cb',
  brown: '#a52a2a',
  navy: '#000080',
  teal: '#008080',
  olive: '#808000',
  maroon: '#800000',
  lime: '#00ff00',
  aqua: '#00ffff',
  fuchsia: '#ff00ff',
  gold: '#ffd700',
  indigo: '#4b0082',
  ivory: '#fffff0',
  khaki: '#f0e68c',
  lavender: '#e6e6fa',
  salmon: '#fa8072',
  tomato: '#ff6347',
  turquoise: '#40e0d0',
  violet: '#ee82ee',
  wheat: '#f5deb3',
  whitesmoke: '#f5f5f5',
  rebeccapurple: '#663399',
  slategray: '#708090',
  slategrey: '#708090',
  dodgerblue: '#1e90ff',
  royalblue: '#4169e1',
  crimson: '#dc143c',
  coral: '#ff7f50',
  skyblue: '#87ceeb',
  steelblue: '#4682b4',
  seagreen: '#2e8b57',
  forestgreen: '#228b22',
  midnightblue: '#191970',
  ghostwhite: '#f8f8ff',
  gainsboro: '#dcdcdc',
  honeydew: '#f0fff0',
};

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  s = Math.min(Math.max(s, 0), 1);
  l = Math.min(Math.max(l, 0), 1);
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let rgb: [number, number, number];
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return [Math.round((rgb[0] + m) * 255), Math.round((rgb[1] + m) * 255), Math.round((rgb[2] + m) * 255)];
}

export function parseColor(color: ColorValue | undefined | null): RGBA | null {
  if (color == null) return null;
  // RN processed colors are 0xAARRGGBB integers (processColor output,
  // reanimated's interpolateColor, PlatformColor fallbacks). Valid anywhere a
  // ColorValue is.
  if (typeof color === 'number') {
    const n = color >>> 0;
    return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff, a: ((n >> 24) & 0xff) / 255 };
  }
  let c = String(color).trim().toLowerCase();
  if (c in NAMED) c = NAMED[c]!;

  if (c.startsWith('#')) {
    const hex = c.slice(1);
    if (/^[0-9a-f]{3}$/.test(hex)) {
      return { r: parseInt(hex[0]! + hex[0], 16), g: parseInt(hex[1]! + hex[1], 16), b: parseInt(hex[2]! + hex[2], 16), a: 1 };
    }
    if (/^[0-9a-f]{4}$/.test(hex)) {
      return {
        r: parseInt(hex[0]! + hex[0], 16),
        g: parseInt(hex[1]! + hex[1], 16),
        b: parseInt(hex[2]! + hex[2], 16),
        a: parseInt(hex[3]! + hex[3], 16) / 255,
      };
    }
    if (/^[0-9a-f]{6}$/.test(hex)) {
      return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16), a: 1 };
    }
    if (/^[0-9a-f]{8}$/.test(hex)) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: parseInt(hex.slice(6, 8), 16) / 255,
      };
    }
    return null;
  }

  // channel: number or percentage (percentage scales to 0-255)
  const chan = (v: string): number => (v.endsWith('%') ? Math.round((parseFloat(v) / 100) * 255) : Math.round(+v));
  const alpha = (v: string | undefined): number => (v == null ? 1 : v.endsWith('%') ? parseFloat(v) / 100 : +v);

  let m = c.match(/^rgba?\(\s*([\d.]+%?)\s*,\s*([\d.]+%?)\s*,\s*([\d.]+%?)\s*(?:,\s*([\d.]+%?)\s*)?\)$/);
  if (m) {
    return { r: chan(m[1]!), g: chan(m[2]!), b: chan(m[3]!), a: alpha(m[4]) };
  }
  // rgb(a) with spaces / slash syntax
  m = c.match(/^rgba?\(\s*([\d.]+%?)\s+([\d.]+%?)\s+([\d.]+%?)\s*(?:\/\s*([\d.]+%?)\s*)?\)$/);
  if (m) {
    return { r: chan(m[1]!), g: chan(m[2]!), b: chan(m[3]!), a: alpha(m[4]) };
  }
  m = c.match(/^hsla?\(\s*([\d.-]+)(?:deg)?\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*(?:,\s*([\d.]+%?)\s*)?\)$/);
  if (m) {
    const [r, g, b] = hslToRgb(+m[1]!, +m[2]! / 100, +m[3]! / 100);
    return { r, g, b, a: alpha(m[4]) };
  }
  // hsl(a) with spaces / slash syntax
  m = c.match(/^hsla?\(\s*([\d.-]+)(?:deg)?\s+([\d.]+)%\s+([\d.]+)%\s*(?:\/\s*([\d.]+%?)\s*)?\)$/);
  if (m) {
    const [r, g, b] = hslToRgb(+m[1]!, +m[2]! / 100, +m[3]! / 100);
    return { r, g, b, a: alpha(m[4]) };
  }
  return null;
}

/** RN-compatible: returns 0xAARRGGBB as an unsigned 32-bit number. */
export function processColor(color: ColorValue | undefined | null): number | undefined {
  const rgba = parseColor(color);
  if (!rgba) return undefined;
  const a = Math.round(rgba.a * 255);
  return ((a << 24) >>> 0) + (rgba.r << 16) + (rgba.g << 8) + rgba.b;
}
