/**
 * react-responsive compat shim — media queries answered by the SURFACE.
 *
 * This is the sharpest instance so far of a recurring hazard: a library whose
 * feature detection asks "am I in a browser?", where the honest answer here is
 * yes and the useful answer is no.
 *
 * `react-responsive` resolves queries through `window.matchMedia`. On a device
 * there is no `matchMedia`, so every query answers false and an app falls into
 * its phone layout — which is why apps ship this on native at all. Here
 * `matchMedia` exists and answers about the BROWSER WINDOW, so an app rendering
 * into a 390pt surface inside a 1400px window is told it is on a desktop. It
 * then takes desktop branches for everything: Bluesky reserves no space for its
 * mobile header (`useHeaderOffset` returns 0 when `gtMobile`), and the compose
 * area renders entirely underneath it.
 *
 * So the queries are evaluated against the surface's own dimensions — the same
 * ones `useWindowDimensions()` reports, which is what a native app would be
 * measuring. Width, height, orientation, aspect ratio and resolution are all
 * answered from the surface; `devicePixelRatio` still comes from the display,
 * because that IS a property of the screen rather than of the layout box.
 *
 * Ceiling: the `device` override parameter and `<Context>` are honored, since
 * an app that passes explicit values means them. Queries this shim does not
 * understand evaluate false and warn once, rather than silently reporting true
 * and sending an app down a path it did not ask for.
 */
import * as React from 'react';
import { useWindowDimensions } from 'native-surface';

/** The documented settings object, plus the raw-string form. */
export interface MediaQuerySettings {
  orientation?: 'portrait' | 'landscape';
  minResolution?: number | string;
  maxResolution?: number | string;
  minWidth?: number | string;
  maxWidth?: number | string;
  minHeight?: number | string;
  maxHeight?: number | string;
  minDeviceWidth?: number | string;
  maxDeviceWidth?: number | string;
  minDeviceHeight?: number | string;
  maxDeviceHeight?: number | string;
  minAspectRatio?: number | string;
  maxAspectRatio?: number | string;
  query?: string;
  [key: string]: unknown;
}

export interface DeviceValues {
  width?: number;
  height?: number;
  deviceWidth?: number;
  deviceHeight?: number;
  orientation?: 'portrait' | 'landscape';
  scale?: number;
}

const DeviceContext = React.createContext<DeviceValues | null>(null);
/** react-responsive exports this as `Context`; apps wrap to inject values. */
export const Context = DeviceContext;

const warned = new Set<string>();
function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}

/** "1024px" | 1024 | "40em" → px. em/rem use the CSS default of 16. */
function toPx(value: number | string | undefined): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  const m = /^(-?\d*\.?\d+)\s*(px|em|rem)?$/.exec(value.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return m[2] === 'em' || m[2] === 'rem' ? n * 16 : n;
}

/** "2dppx" | 2 | "192dpi" → device pixel ratio. */
function toDppx(value: number | string | undefined): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  const m = /^(-?\d*\.?\d+)\s*(dppx|dpi|dpcm|x)?$/.exec(value.trim());
  if (!m) return null;
  const n = Number(m[1]);
  if (m[2] === 'dpi') return n / 96;
  if (m[2] === 'dpcm') return n / 96 / 2.54;
  return n;
}

/** "16/9" | 1.777 → number. */
function toRatio(value: number | string | undefined): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  const parts = String(value).split('/');
  if (parts.length === 2) {
    const w = Number(parts[0]!.trim());
    const h = Number(parts[1]!.trim());
    return Number.isFinite(w) && Number.isFinite(h) && h !== 0 ? w / h : null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

interface Resolved {
  width: number;
  height: number;
  deviceWidth: number;
  deviceHeight: number;
  scale: number;
}

/**
 * A raw query string, reduced to the settings this shim understands. Only the
 * simple `(min-width: 700px) and (max-width: 900px)` shape is handled — enough
 * for the breakpoint queries apps actually write. Anything with `or`/`not`/
 * commas is refused loudly rather than half-evaluated.
 */
function parseQueryString(query: string): MediaQuerySettings | null {
  if (/,|\bor\b|\bnot\b|\bonly\b/i.test(query)) return null;
  const out: MediaQuerySettings = {};
  let matched = false;
  for (const m of query.matchAll(/\(\s*([a-z-]+)\s*:\s*([^)]+)\)/gi)) {
    const key = m[1]!.toLowerCase().replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    out[key] = m[2]!.trim();
    matched = true;
  }
  return matched ? out : null;
}

function evaluate(settings: MediaQuerySettings, d: Resolved): boolean {
  const checks: Array<[unknown, () => boolean]> = [
    [settings.minWidth, () => d.width >= (toPx(settings.minWidth) ?? 0)],
    [settings.maxWidth, () => d.width <= (toPx(settings.maxWidth) ?? Infinity)],
    [settings.minHeight, () => d.height >= (toPx(settings.minHeight) ?? 0)],
    [settings.maxHeight, () => d.height <= (toPx(settings.maxHeight) ?? Infinity)],
    [settings.minDeviceWidth, () => d.deviceWidth >= (toPx(settings.minDeviceWidth) ?? 0)],
    [settings.maxDeviceWidth, () => d.deviceWidth <= (toPx(settings.maxDeviceWidth) ?? Infinity)],
    [settings.minDeviceHeight, () => d.deviceHeight >= (toPx(settings.minDeviceHeight) ?? 0)],
    [settings.maxDeviceHeight, () => d.deviceHeight <= (toPx(settings.maxDeviceHeight) ?? Infinity)],
    [settings.orientation, () => (d.width >= d.height ? 'landscape' : 'portrait') === settings.orientation],
    [settings.minResolution, () => d.scale >= (toDppx(settings.minResolution) ?? 0)],
    [settings.maxResolution, () => d.scale <= (toDppx(settings.maxResolution) ?? Infinity)],
    [settings.minAspectRatio, () => d.width / d.height >= (toRatio(settings.minAspectRatio) ?? 0)],
    [settings.maxAspectRatio, () => d.width / d.height <= (toRatio(settings.maxAspectRatio) ?? Infinity)],
  ];
  let sawOne = false;
  for (const [value, test] of checks) {
    if (value == null) continue;
    sawOne = true;
    if (!test()) return false;
  }
  // An empty/unrecognized settings object must not report a match: `true`
  // would send an app down a branch nothing asked for.
  return sawOne;
}

/**
 * `useMediaQuery(settings, device?, callback?)`.
 *
 * Answers from the SURFACE, not the browser window — see the module comment.
 * An explicit `device` (or a `<Context>` value) still wins, because an app
 * that passes values means them.
 */
export function useMediaQuery(
  settings: MediaQuerySettings,
  device?: DeviceValues,
  callback?: (matches: boolean) => void
): boolean {
  const surface = useWindowDimensions();
  const ctx = React.useContext(DeviceContext);
  const override = device ?? ctx ?? undefined;

  const resolved: Resolved = {
    width: override?.width ?? surface.width,
    height: override?.height ?? surface.height,
    deviceWidth: override?.deviceWidth ?? override?.width ?? surface.width,
    deviceHeight: override?.deviceHeight ?? override?.height ?? surface.height,
    scale: override?.scale ?? surface.scale ?? 1,
  };

  let effective: MediaQuerySettings | null = settings;
  if (typeof settings === 'string') {
    effective = parseQueryString(settings);
  } else if (settings && typeof settings.query === 'string') {
    effective = parseQueryString(settings.query);
  }
  if (!effective) {
    const shown = typeof settings === 'string' ? settings : JSON.stringify(settings);
    warnOnce(
      `query:${shown}`,
      `react-responsive compat: cannot evaluate the media query ${shown} against the surface — ` +
        `reporting no match. Simple (min-width: …) / (max-width: …) forms are supported.`
    );
  }

  const matches = effective ? evaluate(effective, resolved) : false;

  // The callback contract is "called when the match CHANGES".
  const previous = React.useRef<boolean | null>(null);
  React.useEffect(() => {
    if (previous.current !== matches) {
      previous.current = matches;
      callback?.(matches);
    }
  }, [matches, callback]);

  return matches;
}

export interface MediaQueryProps extends MediaQuerySettings {
  children?: React.ReactNode | ((matches: boolean) => React.ReactNode);
  device?: DeviceValues;
  onChange?: (matches: boolean) => void;
}

/** The component form: renders children when the query matches, or calls a
 *  function child with the result. */
export function MediaQuery(props: MediaQueryProps): React.ReactNode {
  const { children, device, onChange, ...settings } = props;
  const matches = useMediaQuery(settings, device, onChange);
  if (typeof children === 'function') return (children as (m: boolean) => React.ReactNode)(matches);
  return matches ? (children as React.ReactNode) : null;
}

export default MediaQuery;
