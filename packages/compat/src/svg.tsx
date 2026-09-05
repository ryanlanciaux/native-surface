/**
 * react-native-svg compat shim (canvas host).
 *
 * Shape elements never become host nodes: the <Svg> root walks its React
 * element tree at render time and compiles it into the engine's generic
 * draw-op channel (the host view's `__draw` prop — see
 * native-surface/src/engine/drawOps.ts). The op schema here structurally
 * mirrors the engine's; it is duplicated because native-surface's exports map
 * does not expose engine internals.
 *
 * Supported: Path/Rect/Circle/Ellipse/Line/Polygon/Polyline/G with
 * presentation-attribute inheritance (fill, stroke, strokeWidth, …,
 * `currentColor` via the `color` prop), Defs + fill/stroke="url(#id)" from
 * LinearGradient/RadialGradient/Stop, clipPath="url(#id)", Use/Symbol,
 * SvgXml/SvgUri (needs DOMParser), transform strings
 * "translate() rotate() scale() matrix() skewX() skewY()" plus RN-style
 * array/object forms and x/y (containers), translate/rotation/scale/origin
 * props.
 *
 * Out of scope (warn-once stubs or documented gaps):
 * - Text/TSpan render nothing — use a regular Text overlay.
 * - Mask and the mask prop: content paints unmasked. Image paints nothing.
 * - Pattern paints, gradientTransform, clip-rule; transforms on shapes
 *   INSIDE a ClipPath are ignored when building clip geometry.
 * - preserveAspectRatio: only default xMidYMid-meet vs 'none'.
 * - Custom components inside <Svg> are not expanded (calling them during the
 *   root's render would attach their hooks to the Svg fiber); only
 *   react-native-svg elements, fragments, and arrays compile.
 * - Percentage coordinates resolve against the viewBox when present, else the
 *   numeric width/height props (0 when those are percentages themselves).
 * - Press props forward to the host View as-is; per-shape hit testing is out.
 */
import * as React from 'react';
import { View } from 'native-surface';
import type { StyleProp, ViewStyle } from 'native-surface';

// ---------------------------------------------------------------------------
// Draw-op schema (structural mirror of native-surface/src/engine/drawOps.ts)
// ---------------------------------------------------------------------------

export type Affine = [number, number, number, number, number, number];

export interface GradientStop {
  offset: number;
  color: string | number;
  opacity?: number;
}

export type GradientUnits = 'objectBoundingBox' | 'userSpaceOnUse';

export interface LinearGradientSpec {
  type: 'linear';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stops: GradientStop[];
  units: GradientUnits;
}

export interface RadialGradientSpec {
  type: 'radial';
  cx: number;
  cy: number;
  r: number;
  fx?: number;
  fy?: number;
  stops: GradientStop[];
  units: GradientUnits;
}

export type GradientSpec = LinearGradientSpec | RadialGradientSpec;
export type PaintRef = string | number | GradientSpec;

export interface DrawOpCommon {
  fill?: PaintRef;
  fillOpacity?: number;
  fillRule?: 'nonzero' | 'evenodd';
  stroke?: PaintRef;
  strokeWidth?: number;
  strokeOpacity?: number;
  strokeLinecap?: 'butt' | 'round' | 'square';
  strokeLinejoin?: 'miter' | 'round' | 'bevel';
  strokeMiterlimit?: number;
  strokeDasharray?: number[];
  strokeDashoffset?: number;
  opacity?: number;
  transform?: Affine;
  clipPath?: string;
}

export type DrawOp =
  | (DrawOpCommon & { op: 'path'; d: string })
  | (DrawOpCommon & { op: 'rect'; x: number; y: number; width: number; height: number; rx?: number; ry?: number })
  | (DrawOpCommon & { op: 'circle'; cx: number; cy: number; r: number })
  | (DrawOpCommon & { op: 'ellipse'; cx: number; cy: number; rx: number; ry: number })
  | (DrawOpCommon & { op: 'line'; x1: number; y1: number; x2: number; y2: number })
  | (DrawOpCommon & { op: 'group'; children: DrawOp[] });

export interface DrawSpec {
  ops: DrawOp[];
  viewBox?: [number, number, number, number];
  preserveAspectRatio?: 'meet' | 'none';
}

// ---------------------------------------------------------------------------
// Loose prop surfaces (no @types/react-native-svg dependency)
// ---------------------------------------------------------------------------

type NumProp = number | string;

export interface PresentationProps extends Record<string, unknown> {
  fill?: string | number;
  fillOpacity?: NumProp;
  fillRule?: 'nonzero' | 'evenodd';
  stroke?: string | number;
  strokeWidth?: NumProp;
  strokeOpacity?: NumProp;
  strokeLinecap?: 'butt' | 'round' | 'square';
  strokeLinejoin?: 'miter' | 'round' | 'bevel';
  strokeMiterlimit?: NumProp;
  strokeDasharray?: NumProp | ReadonlyArray<NumProp>;
  strokeDashoffset?: NumProp;
  opacity?: NumProp;
  color?: string;
  transform?: unknown;
  clipPath?: string;
  id?: string;
  children?: React.ReactNode;
}

export interface SvgProps extends PresentationProps {
  width?: NumProp;
  height?: NumProp;
  viewBox?: string;
  preserveAspectRatio?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export interface PathProps extends PresentationProps {
  d?: string;
}
export interface RectProps extends PresentationProps {
  x?: NumProp;
  y?: NumProp;
  width?: NumProp;
  height?: NumProp;
  rx?: NumProp;
  ry?: NumProp;
}
export interface CircleProps extends PresentationProps {
  cx?: NumProp;
  cy?: NumProp;
  r?: NumProp;
}
export interface EllipseProps extends PresentationProps {
  cx?: NumProp;
  cy?: NumProp;
  rx?: NumProp;
  ry?: NumProp;
}
export interface LineProps extends PresentationProps {
  x1?: NumProp;
  y1?: NumProp;
  x2?: NumProp;
  y2?: NumProp;
}
export interface PolyProps extends PresentationProps {
  points?: string | ReadonlyArray<NumProp> | ReadonlyArray<readonly [NumProp, NumProp]>;
}
export interface GProps extends PresentationProps {
  x?: NumProp;
  y?: NumProp;
  translate?: unknown;
  rotation?: NumProp;
  scale?: unknown;
  origin?: unknown;
  originX?: NumProp;
  originY?: NumProp;
}
export interface GradientProps extends Record<string, unknown> {
  id?: string;
  gradientUnits?: 'objectBoundingBox' | 'userSpaceOnUse';
  children?: React.ReactNode;
}
export interface StopProps extends Record<string, unknown> {
  offset?: NumProp;
  stopColor?: string | number;
  stopOpacity?: NumProp;
}
export interface UseProps extends PresentationProps {
  href?: string;
  xlinkHref?: string;
  x?: NumProp;
  y?: NumProp;
}
export interface SvgXmlProps extends Record<string, unknown> {
  xml?: string | null;
  width?: NumProp;
  height?: NumProp;
  style?: StyleProp<ViewStyle>;
}
export interface SvgUriProps extends Record<string, unknown> {
  uri?: string | null;
  width?: NumProp;
  height?: NumProp;
  style?: StyleProp<ViewStyle>;
}

// ---------------------------------------------------------------------------
// Element components — identity markers only; the Svg root compiles them.
// Rendering one outside <Svg> draws nothing.
// ---------------------------------------------------------------------------

export function Path(_props: PathProps): null {
  return null;
}
export function Rect(_props: RectProps): null {
  return null;
}
export function Circle(_props: CircleProps): null {
  return null;
}
export function Ellipse(_props: EllipseProps): null {
  return null;
}
export function Line(_props: LineProps): null {
  return null;
}
export function Polygon(_props: PolyProps): null {
  return null;
}
export function Polyline(_props: PolyProps): null {
  return null;
}
export function G(_props: GProps): null {
  return null;
}
export function Defs(_props: { children?: React.ReactNode }): null {
  return null;
}
export function LinearGradient(_props: GradientProps): null {
  return null;
}
export function RadialGradient(_props: GradientProps): null {
  return null;
}
export function Stop(_props: StopProps): null {
  return null;
}
export function ClipPath(_props: { id?: string; children?: React.ReactNode }): null {
  return null;
}
export function Use(_props: UseProps): null {
  return null;
}
function SvgSymbol(_props: Record<string, unknown> & { children?: React.ReactNode }): null {
  return null;
}
function SvgText(_props: Record<string, unknown> & { children?: React.ReactNode }): null {
  return null;
}
export function TSpan(_props: Record<string, unknown> & { children?: React.ReactNode }): null {
  return null;
}
export function Mask(_props: Record<string, unknown> & { children?: React.ReactNode }): null {
  return null;
}
function SvgImage(_props: Record<string, unknown>): null {
  return null;
}
export { SvgSymbol as Symbol, SvgText as Text, SvgImage as Image };

// ---------------------------------------------------------------------------
// Normalized tree: one compiler consumes both React elements and DOM elements
// ---------------------------------------------------------------------------

type SvgKind =
  | 'svg'
  | 'path'
  | 'rect'
  | 'circle'
  | 'ellipse'
  | 'line'
  | 'polygon'
  | 'polyline'
  | 'g'
  | 'defs'
  | 'linearGradient'
  | 'radialGradient'
  | 'stop'
  | 'clipPath'
  | 'symbol'
  | 'use'
  | 'text'
  | 'tspan'
  | 'mask'
  | 'image'
  | 'meta';

interface SNode {
  kind: SvgKind;
  props: Record<string, unknown>;
  children: SNode[];
}

const warned = new Set<string>();
function warnOnce(key: string, msg: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(msg);
}

const KIND_BY_TYPE = new Map<unknown, SvgKind>([
  [Svg, 'svg'],
  [Path, 'path'],
  [Rect, 'rect'],
  [Circle, 'circle'],
  [Ellipse, 'ellipse'],
  [Line, 'line'],
  [Polygon, 'polygon'],
  [Polyline, 'polyline'],
  [G, 'g'],
  [Defs, 'defs'],
  [LinearGradient, 'linearGradient'],
  [RadialGradient, 'radialGradient'],
  [Stop, 'stop'],
  [ClipPath, 'clipPath'],
  [SvgSymbol, 'symbol'],
  [Use, 'use'],
  [SvgText, 'text'],
  [TSpan, 'tspan'],
  [Mask, 'mask'],
  [SvgImage, 'image'],
]);

interface AnimatedPropsHandle {
  get(): Record<string, unknown>;
  subscribe(l: () => void): () => void;
}

function isAnimatedPropsHandle(v: unknown): v is AnimatedPropsHandle {
  return typeof v === 'object' && v !== null && (v as { __cnAnimatedHandle?: boolean }).__cnAnimatedHandle === true;
}

function typeKind(t: unknown): SvgKind | undefined {
  const direct = KIND_BY_TYPE.get(t);
  if (direct) return direct;
  if (typeof t === 'object' && t !== null && '__nsInner' in t) {
    return KIND_BY_TYPE.get((t as { __nsInner: unknown }).__nsInner);
  }
  return undefined;
}

function normalizeReactList(
  children: React.ReactNode,
  handles?: AnimatedPropsHandle[]
): SNode[] {
  const out: SNode[] = [];
  addReact(children, out, handles);
  return out;
}

function addReact(node: React.ReactNode, out: SNode[], handles?: AnimatedPropsHandle[]): void {
  if (node == null || typeof node === 'boolean') return;
  if (Array.isArray(node)) {
    for (const c of node) addReact(c, out, handles);
    return;
  }
  // bare strings/numbers need <Text>, which is unsupported anyway
  if (typeof node === 'string' || typeof node === 'number') return;
  if (!React.isValidElement(node)) return;
  const t = node.type;
  const props = node.props as Record<string, unknown>;
  if (t === React.Fragment) {
    addReact(props.children as React.ReactNode, out, handles);
    return;
  }
  const kind = typeKind(t);
  if (!kind) {
    const named = t as { displayName?: string; name?: string };
    const name = typeof t === 'string' ? t : (named.displayName ?? named.name ?? 'component');
    warnOnce(
      `svg-el-${name}`,
      `native-surface: <${name}> inside <Svg> is not a react-native-svg element; subtree skipped (custom components are not expanded)`
    );
    return;
  }
  let next = props;
  const ap = props.animatedProps;
  if (isAnimatedPropsHandle(ap)) {
    handles?.push(ap);
    next = { ...props, ...ap.get() };
    delete next.animatedProps;
  }
  out.push({ kind, props: next, children: normalizeReactList(props.children as React.ReactNode, handles) });
}

const KIND_BY_TAG: Record<string, SvgKind> = {
  svg: 'svg',
  path: 'path',
  rect: 'rect',
  circle: 'circle',
  ellipse: 'ellipse',
  line: 'line',
  polygon: 'polygon',
  polyline: 'polyline',
  g: 'g',
  defs: 'defs',
  lineargradient: 'linearGradient',
  radialgradient: 'radialGradient',
  stop: 'stop',
  clippath: 'clipPath',
  symbol: 'symbol',
  use: 'use',
  text: 'text',
  tspan: 'tspan',
  mask: 'mask',
  image: 'image',
  title: 'meta',
  desc: 'meta',
  metadata: 'meta',
};

function attrKey(name: string): string {
  if (name === 'xlink:href') return 'xlinkHref';
  return name.replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase());
}

function attrsToProps(el: Element): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const name of el.getAttributeNames()) {
    if (name === 'xmlns' || name.startsWith('xmlns:')) continue;
    props[attrKey(name)] = el.getAttribute(name);
  }
  return props;
}

function addDom(el: Element, out: SNode[]): void {
  const tag = el.tagName.toLowerCase();
  const kind = KIND_BY_TAG[tag];
  if (!kind) {
    warnOnce(`svg-xml-${tag}`, `native-surface: SvgXml element <${tag}> is not supported; skipped`);
    return;
  }
  if (kind === 'meta') return;
  const children: SNode[] = [];
  for (const c of Array.from(el.children)) addDom(c, children);
  out.push({ kind, props: attrsToProps(el), children });
}

// ---------------------------------------------------------------------------
// Value parsing
// ---------------------------------------------------------------------------

function num(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v !== 'string' || v.trim() === '') return undefined;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : undefined;
}

interface Env {
  defs: Map<string, SNode>;
  /** Percentage bases: viewBox size when present, else numeric width/height. */
  vw: number;
  vh: number;
  /** <Use> cycle guard. */
  refStack: string[];
}

/** Length with SVG percentage resolution: x/y against a viewport axis, d(iagonal) for radii. */
function len(v: unknown, env: Env, axis: 'x' | 'y' | 'd'): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v !== 'string' || v.trim() === '') return undefined;
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return undefined;
  if (v.trim().endsWith('%')) {
    const base = axis === 'x' ? env.vw : axis === 'y' ? env.vh : Math.sqrt((env.vw * env.vw + env.vh * env.vh) / 2);
    return (n / 100) * base;
  }
  return n;
}

/** Stop offset: "50%" → 0.5, numbers pass through. */
function parseOffset(v: unknown): number {
  if (typeof v === 'string' && v.trim().endsWith('%')) return (parseFloat(v) || 0) / 100;
  return num(v) ?? 0;
}

function parseDashArray(v: unknown): number[] | undefined {
  if (v == null || v === 'none') return undefined;
  const raw = Array.isArray(v) ? (v as unknown[]).map((n) => num(n)) : String(v).trim().split(/[\s,]+/).map((s) => num(s));
  const arr: number[] = [];
  for (const n of raw) {
    if (n == null || n < 0) return undefined;
    arr.push(n);
  }
  if (!arr.length || arr.every((n) => n === 0)) return undefined;
  return arr;
}

function parseViewBox(v: unknown): [number, number, number, number] | undefined {
  if (typeof v !== 'string') return undefined;
  const parts = v.trim().split(/[\s,]+/).map(parseFloat);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return undefined;
  return [parts[0]!, parts[1]!, parts[2]!, parts[3]!];
}

// ---------------------------------------------------------------------------
// Affine transforms (SVG matrix(a b c d e f) order)
// ---------------------------------------------------------------------------

const DEG = Math.PI / 180;

function mulAffine(m: Affine, n: Affine): Affine {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

const T = (tx: number, ty: number): Affine => [1, 0, 0, 1, tx, ty];
const S = (sx: number, sy: number): Affine => [sx, 0, 0, sy, 0, 0];
function R(deg: number): Affine {
  const c = Math.cos(deg * DEG);
  const s = Math.sin(deg * DEG);
  return [c, s, -s, c, 0, 0];
}

function parseTransformString(str: string): Affine | null {
  let m: Affine | null = null;
  const re = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(str))) {
    const args = match[2]!.trim().split(/[\s,]+/).filter(Boolean).map(parseFloat);
    let n: Affine | null = null;
    switch (match[1]) {
      case 'translate':
        n = T(args[0] ?? 0, args[1] ?? 0);
        break;
      case 'scale':
        n = S(args[0] ?? 1, args[1] ?? args[0] ?? 1);
        break;
      case 'rotate':
        n = R(args[0] ?? 0);
        if (args.length >= 3) n = mulAffine(mulAffine(T(args[1]!, args[2]!), n), T(-args[1]!, -args[2]!));
        break;
      case 'matrix':
        if (args.length === 6) n = [args[0]!, args[1]!, args[2]!, args[3]!, args[4]!, args[5]!];
        break;
      case 'skewX':
        n = [1, 0, Math.tan((args[0] ?? 0) * DEG), 1, 0, 0];
        break;
      case 'skewY':
        n = [1, Math.tan((args[0] ?? 0) * DEG), 0, 1, 0, 0];
        break;
    }
    if (n) m = m ? mulAffine(m, n) : n;
  }
  return m;
}

/** RN-style transform entries: [{translateX: 5}, {rotate: '45deg'}, {scale: 2}]. */
function fromRNTransforms(entries: ReadonlyArray<Record<string, unknown>>): Affine | null {
  let m: Affine | null = null;
  const app = (n: Affine) => {
    m = m ? mulAffine(m, n) : n;
  };
  const rotDeg = (v: unknown): number => {
    if (typeof v === 'number') return v;
    const s = String(v).trim();
    const n = parseFloat(s);
    if (!Number.isFinite(n)) return 0;
    return s.endsWith('rad') ? n / DEG : n;
  };
  for (const e of entries) {
    if (e.translateX != null || e.translateY != null) app(T(num(e.translateX) ?? 0, num(e.translateY) ?? 0));
    if (e.scale != null) app(S(num(e.scale) ?? 1, num(e.scale) ?? 1));
    if (e.scaleX != null || e.scaleY != null) app(S(num(e.scaleX) ?? 1, num(e.scaleY) ?? 1));
    if (e.rotate != null) app(R(rotDeg(e.rotate)));
    if (e.skewX != null) app([1, 0, Math.tan(rotDeg(e.skewX) * DEG), 1, 0, 0]);
    if (e.skewY != null) app([1, Math.tan(rotDeg(e.skewY) * DEG), 0, 1, 0, 0]);
  }
  return m;
}

/** "10, 20" | [10, 20] | 10 → pair; `single` fills the second slot for scale. */
function parsePair(v: unknown, single: 'copy' | 'zero'): [number, number] | null {
  if (v == null) return null;
  if (typeof v === 'number') return [v, single === 'copy' ? v : 0];
  if (Array.isArray(v)) {
    const a = num(v[0]);
    if (a == null) return null;
    return [a, num(v[1]) ?? (single === 'copy' ? a : 0)];
  }
  if (typeof v === 'string') {
    const parts = v.trim().split(/[\s,]+/).map(parseFloat).filter(Number.isFinite);
    if (!parts.length) return null;
    return [parts[0]!, parts[1] ?? (single === 'copy' ? parts[0]! : 0)];
  }
  return null;
}

/**
 * Composes the react-native-svg transform props: x/y (containers only —
 * shapes use them as geometry), translate, origin-wrapped rotation/scale,
 * then the transform prop. Approximates rnsvg's extractTransform ordering.
 */
function composeTransform(props: Record<string, unknown>, isContainer: boolean): Affine | undefined {
  let m: Affine | null = null;
  const app = (n: Affine) => {
    m = m ? mulAffine(m, n) : n;
  };

  if (isContainer) {
    const x = num(props.x) ?? 0;
    const y = num(props.y) ?? 0;
    if (x || y) app(T(x, y));
  }
  const tr = parsePair(props.translate, 'zero');
  if (tr) app(T(tr[0], tr[1]));

  const rotation = num(props.rotation ?? props.rotate);
  const scale = parsePair(props.scale, 'copy');
  if (rotation || scale) {
    const origin = parsePair(props.origin, 'copy');
    const ox = num(props.originX) ?? origin?.[0] ?? 0;
    const oy = num(props.originY) ?? origin?.[1] ?? 0;
    if (ox || oy) app(T(ox, oy));
    if (rotation) app(R(rotation));
    if (scale) app(S(scale[0], scale[1]));
    if (ox || oy) app(T(-ox, -oy));
  }

  const t = props.transform;
  if (typeof t === 'string') {
    const parsed = parseTransformString(t);
    if (parsed) app(parsed);
  } else if (Array.isArray(t)) {
    const parsed = fromRNTransforms(t as Array<Record<string, unknown>>);
    if (parsed) app(parsed);
  } else if (t && typeof t === 'object') {
    const parsed = fromRNTransforms([t as Record<string, unknown>]);
    if (parsed) app(parsed);
  }

  return m ?? undefined;
}

// ---------------------------------------------------------------------------
// Compiler
// ---------------------------------------------------------------------------

const INHERITED = [
  'fill',
  'fillOpacity',
  'fillRule',
  'stroke',
  'strokeWidth',
  'strokeOpacity',
  'strokeLinecap',
  'strokeLinejoin',
  'strokeMiterlimit',
  'strokeDasharray',
  'strokeDashoffset',
  'color',
] as const;

type Inherited = Partial<Record<(typeof INHERITED)[number], unknown>>;

function mergeInherited(inh: Inherited, props: Record<string, unknown>): Inherited {
  let out: Inherited | null = null;
  for (const key of INHERITED) {
    const v = props[key];
    if (v != null) {
      out ??= { ...inh };
      out[key] = v;
    }
  }
  return out ?? inh;
}

function collectDefs(nodes: SNode[], defs: Map<string, SNode>): void {
  for (const n of nodes) {
    const id = n.props.id;
    if (typeof id === 'string' && id) defs.set(id, n);
    collectDefs(n.children, defs);
  }
}

function refId(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = v.match(/#([^)'"\s]+)/);
  return m ? m[1]! : null;
}

function gradientFromDef(def: SNode, env: Env): GradientSpec | null {
  const units: GradientUnits = def.props.gradientUnits === 'userSpaceOnUse' ? 'userSpaceOnUse' : 'objectBoundingBox';
  if (def.props.gradientTransform != null) {
    warnOnce('svg-gradient-transform', 'native-surface: gradientTransform is not supported; ignored');
  }
  const obb = units === 'objectBoundingBox';
  // objectBoundingBox: percentages and plain numbers are 0-1 fractions;
  // userSpaceOnUse: percentages resolve against the viewport.
  const coord = (v: unknown, dflt: string, axis: 'x' | 'y' | 'd'): number => {
    const raw = v ?? dflt;
    if (obb) return typeof raw === 'string' && raw.trim().endsWith('%') ? (parseFloat(raw) || 0) / 100 : (num(raw) ?? 0);
    return len(raw, env, axis) ?? 0;
  };

  const stops: GradientStop[] = [];
  for (const c of def.children) {
    if (c.kind !== 'stop') continue;
    const stop: GradientStop = {
      offset: parseOffset(c.props.offset),
      color: (c.props.stopColor as string | number | undefined) ?? '#000',
    };
    const so = num(c.props.stopOpacity);
    if (so != null) stop.opacity = so;
    stops.push(stop);
  }
  if (!stops.length) return null;

  if (def.kind === 'linearGradient') {
    return {
      type: 'linear',
      x1: coord(def.props.x1, '0%', 'x'),
      y1: coord(def.props.y1, '0%', 'y'),
      x2: coord(def.props.x2, '100%', 'x'),
      y2: coord(def.props.y2, '0%', 'y'),
      stops,
      units,
    };
  }
  const g: RadialGradientSpec = {
    type: 'radial',
    cx: coord(def.props.cx, '50%', 'x'),
    cy: coord(def.props.cy, '50%', 'y'),
    r: coord(def.props.r, '50%', 'd'),
    stops,
    units,
  };
  if (def.props.fx != null) g.fx = coord(def.props.fx, '50%', 'x');
  if (def.props.fy != null) g.fy = coord(def.props.fy, '50%', 'y');
  return g;
}

function resolvePaintRef(value: unknown, inh: Inherited, env: Env): PaintRef | undefined {
  if (value == null) return undefined;
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return undefined;
  if (value === 'none') return 'none';
  if (value === 'currentColor') return (inh.color as string | undefined) ?? '#000';
  if (value.startsWith('url(')) {
    const id = refId(value);
    const def = id ? env.defs.get(id) : undefined;
    if (!def || (def.kind !== 'linearGradient' && def.kind !== 'radialGradient')) {
      warnOnce(`svg-paint-ref-${id}`, `native-surface: fill/stroke reference "${value}" does not resolve to a gradient; painted as none`);
      return 'none';
    }
    return gradientFromDef(def, env) ?? 'none';
  }
  return value;
}

/** Flattened points list → path data; polygons close, polylines don't. */
function pointsToPathData(v: unknown, close: boolean): string | null {
  let flat: number[] = [];
  if (typeof v === 'string') {
    flat = v.trim().split(/[\s,]+/).map(parseFloat);
  } else if (Array.isArray(v)) {
    for (const entry of v as unknown[]) {
      if (Array.isArray(entry)) flat.push(num(entry[0]) ?? NaN, num(entry[1]) ?? NaN);
      else flat.push(num(entry) ?? NaN);
    }
  } else {
    return null;
  }
  if (flat.length < 4 || flat.length % 2 || flat.some((n) => !Number.isFinite(n))) return null;
  let d = `M${flat[0]} ${flat[1]}`;
  for (let i = 2; i < flat.length; i += 2) d += ` L${flat[i]} ${flat[i + 1]}`;
  return close ? d + ' Z' : d;
}

/**
 * Shape → SVG path data, for ClipPath geometry and Polygon/Polyline. Shape
 * transforms are ignored here (clip geometry limitation, documented above).
 */
function shapeToPathData(node: SNode, env: Env): string | null {
  const p = node.props;
  switch (node.kind) {
    case 'path':
      return typeof p.d === 'string' && p.d ? p.d : null;
    case 'rect': {
      const x = len(p.x, env, 'x') ?? 0;
      const y = len(p.y, env, 'y') ?? 0;
      const w = len(p.width, env, 'x') ?? 0;
      const h = len(p.height, env, 'y') ?? 0;
      if (w <= 0 || h <= 0) return null;
      const rx = Math.min(len(p.rx, env, 'x') ?? len(p.ry, env, 'y') ?? 0, w / 2);
      const ry = Math.min(len(p.ry, env, 'y') ?? len(p.rx, env, 'x') ?? 0, h / 2);
      if (rx > 0 && ry > 0) {
        return (
          `M${x + rx} ${y} H${x + w - rx} A${rx} ${ry} 0 0 1 ${x + w} ${y + ry} V${y + h - ry}` +
          ` A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h} H${x + rx} A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}` +
          ` V${y + ry} A${rx} ${ry} 0 0 1 ${x + rx} ${y} Z`
        );
      }
      return `M${x} ${y} H${x + w} V${y + h} H${x} Z`;
    }
    case 'circle':
    case 'ellipse': {
      const cx = len(p.cx, env, 'x') ?? 0;
      const cy = len(p.cy, env, 'y') ?? 0;
      const rx = node.kind === 'circle' ? (len(p.r, env, 'd') ?? 0) : (len(p.rx, env, 'x') ?? 0);
      const ry = node.kind === 'circle' ? rx : (len(p.ry, env, 'y') ?? 0);
      if (rx <= 0 || ry <= 0) return null;
      return `M${cx - rx} ${cy} A${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z`;
    }
    case 'line': {
      const x1 = len(p.x1, env, 'x') ?? 0;
      const y1 = len(p.y1, env, 'y') ?? 0;
      const x2 = len(p.x2, env, 'x') ?? 0;
      const y2 = len(p.y2, env, 'y') ?? 0;
      return `M${x1} ${y1} L${x2} ${y2}`;
    }
    case 'polygon':
      return pointsToPathData(p.points, true);
    case 'polyline':
      return pointsToPathData(p.points, false);
    default:
      return null;
  }
}

const CLIPPABLE: ReadonlySet<SvgKind> = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polygon', 'polyline']);

function resolveClip(value: unknown, env: Env): string | undefined {
  const id = refId(value);
  if (!id) return undefined;
  const def = env.defs.get(id);
  if (!def || def.kind !== 'clipPath') {
    warnOnce(`svg-clip-ref-${id}`, `native-surface: clipPath reference "#${id}" not found; clip ignored`);
    return undefined;
  }
  const parts: string[] = [];
  const walk = (nodes: SNode[]) => {
    for (const n of nodes) {
      if (CLIPPABLE.has(n.kind)) {
        const d = shapeToPathData(n, env);
        if (d) parts.push(d);
      } else if (n.kind === 'g' || n.kind === 'use') {
        walk(n.children);
      }
    }
  };
  walk(def.children);
  return parts.length ? parts.join(' ') : undefined;
}

/** Structure props shared by shapes and containers (never inherited). */
function applyStructure(op: DrawOp, props: Record<string, unknown>, env: Env, isContainer: boolean): void {
  const tf = composeTransform(props, isContainer);
  if (tf) op.transform = tf;
  const opacity = num(props.opacity);
  if (opacity != null) op.opacity = opacity;
  const clip = resolveClip(props.clipPath, env);
  if (clip) op.clipPath = clip;
  if (props.mask != null) {
    warnOnce('svg-mask', 'native-surface: SVG masks are not supported yet; content paints unmasked');
  }
}

function applyPaint(op: DrawOp, props: Record<string, unknown>, inh: Inherited, env: Env): void {
  const get = (key: (typeof INHERITED)[number]): unknown => props[key] ?? inh[key];
  const fill = resolvePaintRef(get('fill'), inh, env);
  if (fill != null) op.fill = fill;
  const stroke = resolvePaintRef(get('stroke'), inh, env);
  if (stroke != null) op.stroke = stroke;
  const fo = num(get('fillOpacity'));
  if (fo != null) op.fillOpacity = fo;
  const so = num(get('strokeOpacity'));
  if (so != null) op.strokeOpacity = so;
  const fr = get('fillRule');
  if (fr === 'evenodd' || fr === 'nonzero') op.fillRule = fr;
  const sw = len(get('strokeWidth'), env, 'd');
  if (sw != null) op.strokeWidth = sw;
  const cap = get('strokeLinecap');
  if (cap === 'butt' || cap === 'round' || cap === 'square') op.strokeLinecap = cap;
  const join = get('strokeLinejoin');
  if (join === 'miter' || join === 'round' || join === 'bevel') op.strokeLinejoin = join;
  const miter = num(get('strokeMiterlimit'));
  if (miter != null) op.strokeMiterlimit = miter;
  const dash = parseDashArray(get('strokeDasharray'));
  if (dash) op.strokeDasharray = dash;
  const dashOffset = num(get('strokeDashoffset'));
  if (dashOffset != null) op.strokeDashoffset = dashOffset;
}

function shapeOp(node: SNode, inh: Inherited, env: Env): DrawOp | null {
  const p = node.props;
  let op: DrawOp | null = null;
  switch (node.kind) {
    case 'path':
      op = typeof p.d === 'string' && p.d ? { op: 'path', d: p.d } : null;
      break;
    case 'rect':
      op = {
        op: 'rect',
        x: len(p.x, env, 'x') ?? 0,
        y: len(p.y, env, 'y') ?? 0,
        width: len(p.width, env, 'x') ?? 0,
        height: len(p.height, env, 'y') ?? 0,
      };
      {
        const rx = len(p.rx, env, 'x');
        const ry = len(p.ry, env, 'y');
        if (rx != null) op.rx = rx;
        if (ry != null) op.ry = ry;
      }
      break;
    case 'circle':
      op = { op: 'circle', cx: len(p.cx, env, 'x') ?? 0, cy: len(p.cy, env, 'y') ?? 0, r: len(p.r, env, 'd') ?? 0 };
      break;
    case 'ellipse':
      op = {
        op: 'ellipse',
        cx: len(p.cx, env, 'x') ?? 0,
        cy: len(p.cy, env, 'y') ?? 0,
        rx: len(p.rx, env, 'x') ?? 0,
        ry: len(p.ry, env, 'y') ?? 0,
      };
      break;
    case 'line':
      op = {
        op: 'line',
        x1: len(p.x1, env, 'x') ?? 0,
        y1: len(p.y1, env, 'y') ?? 0,
        x2: len(p.x2, env, 'x') ?? 0,
        y2: len(p.y2, env, 'y') ?? 0,
      };
      break;
    case 'polygon':
    case 'polyline': {
      const d = pointsToPathData(p.points, node.kind === 'polygon');
      op = d ? { op: 'path', d } : null;
      break;
    }
    default:
      return null;
  }
  if (!op) return null;
  applyPaint(op, p, inh, env);
  applyStructure(op, p, env, false);
  return op;
}

/** Wraps ops in a group only when the container carries structure. */
function containerOps(children: DrawOp[], props: Record<string, unknown>, env: Env): DrawOp[] {
  if (!children.length) return children;
  const group: DrawOp = { op: 'group', children };
  applyStructure(group, props, env, true);
  if (group.transform === undefined && group.clipPath === undefined && (group.opacity === undefined || group.opacity >= 1)) {
    return children;
  }
  return [group];
}

function compileNodes(nodes: SNode[], inh: Inherited, env: Env): DrawOp[] {
  const out: DrawOp[] = [];
  for (const node of nodes) {
    switch (node.kind) {
      case 'defs':
      case 'linearGradient':
      case 'radialGradient':
      case 'stop':
      case 'clipPath':
      case 'symbol':
      case 'mask':
      case 'meta':
        break; // definitions / metadata: referenced, never painted in place
      case 'text':
      case 'tspan':
        warnOnce('svg-text', 'native-surface: SVG <Text> is not supported yet; use a regular Text overlay');
        break;
      case 'image':
        warnOnce('svg-image', 'native-surface: SVG <Image> is not supported yet; nothing painted');
        break;
      case 'svg':
        if (node.props.viewBox != null) {
          warnOnce('svg-nested-viewbox', 'native-surface: nested <Svg> viewBox is ignored (painted as a plain group)');
        }
      // eslint-disable-next-line no-fallthrough -- nested svg paints as a group
      case 'g':
        out.push(...containerOps(compileNodes(node.children, mergeInherited(inh, node.props), env), node.props, env));
        break;
      case 'use': {
        const id = refId(node.props.href ?? node.props.xlinkHref);
        const def = id ? env.defs.get(id) : undefined;
        if (!id || !def) {
          warnOnce(`svg-use-${id ?? '?'}`, `native-surface: <Use> reference "#${id ?? '?'}" not found; skipped`);
          break;
        }
        if (env.refStack.includes(id)) {
          warnOnce('svg-use-cycle', `native-surface: <Use> cycle through "#${id}"; skipped`);
          break;
        }
        env.refStack.push(id);
        const target = def.kind === 'symbol' ? def.children : [def];
        const ops = compileNodes(target, mergeInherited(inh, node.props), env);
        env.refStack.pop();
        out.push(...containerOps(ops, node.props, env));
        break;
      }
      default: {
        const op = shapeOp(node, inh, env);
        if (op) out.push(op);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Host rendering
// ---------------------------------------------------------------------------

// The host view takes engine-channel props (__draw) that ViewProps doesn't type.
const HostView = View as unknown as React.FC<Record<string, unknown>>;

function makeEnv(nodes: SNode[], vb: [number, number, number, number] | undefined, w?: number, h?: number): Env {
  const defs = new Map<string, SNode>();
  collectDefs(nodes, defs);
  return { defs, vw: vb ? vb[2] : (w ?? 0), vh: vb ? vb[3] : (h ?? 0), refStack: [] };
}

/** Percent strings pass through to yoga; anything numeric-ish coerces. */
function sizeValue(v: unknown): number | string | undefined {
  if (typeof v === 'string' && v.trim().endsWith('%')) return v;
  return num(v);
}

function renderSvgHost(props: Record<string, unknown>, nodes: SNode[]): React.JSX.Element {
  const { width, height, viewBox, preserveAspectRatio, style, ...rest } = props;
  delete rest.children;

  const vb = parseViewBox(viewBox);
  const env = makeEnv(nodes, vb, num(width), num(height));
  // Presentation attrs on the <Svg> root seed inheritance; keep them off the View.
  const rootInh = mergeInherited({}, rest);
  for (const key of INHERITED) delete rest[key];
  delete rest.opacity; // style-side opacity below, not an unknown host prop

  const spec: DrawSpec = { ops: compileNodes(nodes, rootInh, env) };
  if (vb) {
    spec.viewBox = vb;
    spec.preserveAspectRatio = preserveAspectRatio === 'none' ? 'none' : 'meet';
  }
  if (preserveAspectRatio != null && preserveAspectRatio !== 'none' && !/^xMidYMid(\s+meet)?$/.test(String(preserveAspectRatio))) {
    warnOnce('svg-par', `native-surface: preserveAspectRatio "${String(preserveAspectRatio)}" is not supported; painted as xMidYMid meet`);
  }

  const dims: Record<string, unknown> = {};
  const w = sizeValue(width);
  const h = sizeValue(height);
  if (w != null) dims.width = w;
  if (h != null) dims.height = h;
  const opacity = num(props.opacity);
  if (opacity != null) dims.opacity = opacity;

  // overflow hidden first so the engine clips ops to the frame (SVG viewport
  // behavior); user style may still override it.
  return <HostView {...rest} style={[{ overflow: 'hidden' }, style as StyleProp<ViewStyle>, dims]} __draw={spec} />;
}

export function Svg(props: SvgProps): React.JSX.Element {
  const { children, ...rest } = props;
  const [, bump] = React.useReducer((n: number) => n + 1, 0);
  const handles: AnimatedPropsHandle[] = [];
  const nodes = normalizeReactList(children, handles);
  const n = handles.length;
  React.useEffect(() => {
    if (n === 0) return;
    const unsubs = handles.map((h) => h.subscribe(bump));
    return () => {
      for (const u of unsubs) u();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n]);
  return renderSvgHost(rest, nodes);
}

// ---------------------------------------------------------------------------
// SvgXml / SvgUri
// ---------------------------------------------------------------------------

function parseSvgXml(xml: string): { attrs: Record<string, unknown>; nodes: SNode[] } | null {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, 'image/svg+xml');
  } catch {
    warnOnce('svg-xml-parse', 'native-surface: SvgXml could not parse the given xml');
    return null;
  }
  if (doc.getElementsByTagName('parsererror').length || doc.documentElement.tagName.toLowerCase() !== 'svg') {
    warnOnce('svg-xml-parse', 'native-surface: SvgXml could not parse the given xml');
    return null;
  }
  const nodes: SNode[] = [];
  for (const c of Array.from(doc.documentElement.children)) addDom(c, nodes);
  return { attrs: attrsToProps(doc.documentElement), nodes };
}

export function SvgXml(props: SvgXmlProps): React.JSX.Element | null {
  const { xml, ...rest } = props;
  if (xml == null) return null;
  if (typeof DOMParser === 'undefined') {
    warnOnce('svg-xml-domparser', 'native-surface: SvgXml needs DOMParser, which this environment lacks; nothing rendered');
    return null;
  }
  const parsed = parseSvgXml(String(xml));
  if (!parsed) return null;
  // Component props (width/height/style/…) override the xml's root attributes.
  return renderSvgHost({ ...parsed.attrs, ...rest }, parsed.nodes);
}

export function SvgUri(props: SvgUriProps): React.JSX.Element | null {
  const { uri, ...rest } = props;
  const [xml, setXml] = React.useState<string | null>(null);
  React.useEffect(() => {
    let alive = true;
    setXml(null);
    if (!uri) return;
    fetch(uri)
      .then((r) => r.text())
      .then((text) => {
        if (alive) setXml(text);
      })
      .catch((err: unknown) => {
        console.warn(`native-surface: SvgUri failed to load ${uri}:`, err);
      });
    return () => {
      alive = false;
    };
  }, [uri]);
  if (xml == null) return null;
  return <SvgXml xml={xml} {...rest} />;
}

export default Svg;

// ---------------------------------------------------------------------------
// Test seams
// ---------------------------------------------------------------------------

/** Compiles an element tree the way an <Svg> root with these bounds would. */
export function __compile(
  children: React.ReactNode,
  opts?: { viewBox?: [number, number, number, number]; width?: number; height?: number }
): DrawOp[] {
  const nodes = normalizeReactList(children);
  return compileNodes(nodes, {}, makeEnv(nodes, opts?.viewBox, opts?.width, opts?.height));
}

/** Parses + compiles standalone xml; returns the root attrs alongside the ops. */
export function __compileXml(xml: string): { props: Record<string, unknown>; ops: DrawOp[] } | null {
  if (typeof DOMParser === 'undefined') return null;
  const parsed = parseSvgXml(xml);
  if (!parsed) return null;
  const vb = parseViewBox(parsed.attrs.viewBox);
  const env = makeEnv(parsed.nodes, vb, num(parsed.attrs.width), num(parsed.attrs.height));
  return { props: parsed.attrs, ops: compileNodes(parsed.nodes, mergeInherited({}, parsed.attrs), env) };
}
