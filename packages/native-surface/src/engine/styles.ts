import {
  Align,
  Display,
  Edge,
  FlexDirection,
  Gutter,
  Justify,
  Overflow,
  PositionType,
  Wrap,
} from 'yoga-layout/load';
import type { Node as YogaNode } from 'yoga-layout/load';
import type { StyleProp, TransformStyle } from '../types';
import { parseColor, type RGBA } from './colors';

export type FlatStyle = Record<string, unknown>;

export function flattenStyle(style: StyleProp<unknown>): FlatStyle {
  const out: FlatStyle = {};
  const visit = (s: StyleProp<unknown>, depth: number): void => {
    if (!s || depth > 16) return;
    if (Array.isArray(s)) {
      for (const item of s) visit(item as StyleProp<unknown>, depth + 1);
      return;
    }
    if (typeof s === 'object') {
      // Reanimated animated-style handle (native mapper). Not a Yoga style.
      if ('viewDescriptors' in s) return;
      for (const [k, v] of Object.entries(s as Record<string, unknown>)) {
        // Assigning "__proto__" on a plain object swaps its prototype
        // (styles parsed from JSON can carry it as an own key) — never a
        // legitimate style key, so drop the polluting names outright.
        if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
        if (v !== undefined) out[k] = v;
      }
    }
  };
  visit(style, 0);
  return out;
}

// ---------------------------------------------------------------------------
// Yoga application
// ---------------------------------------------------------------------------

type Dim = number | 'auto' | `${number}%` | undefined;

const FLEX_DIRECTION: Record<string, number> = {
  column: FlexDirection.Column,
  'column-reverse': FlexDirection.ColumnReverse,
  row: FlexDirection.Row,
  'row-reverse': FlexDirection.RowReverse,
};
const JUSTIFY: Record<string, number> = {
  'flex-start': Justify.FlexStart,
  center: Justify.Center,
  'flex-end': Justify.FlexEnd,
  'space-between': Justify.SpaceBetween,
  'space-around': Justify.SpaceAround,
  'space-evenly': Justify.SpaceEvenly,
};
const ALIGN: Record<string, number> = {
  auto: Align.Auto,
  'flex-start': Align.FlexStart,
  center: Align.Center,
  'flex-end': Align.FlexEnd,
  stretch: Align.Stretch,
  baseline: Align.Baseline,
  'space-between': Align.SpaceBetween,
  'space-around': Align.SpaceAround,
  'space-evenly': Align.SpaceEvenly,
};
const WRAP: Record<string, number> = {
  nowrap: Wrap.NoWrap,
  wrap: Wrap.Wrap,
  'wrap-reverse': Wrap.WrapReverse,
};
const POSITION: Record<string, number> = {
  relative: PositionType.Relative,
  absolute: PositionType.Absolute,
  static: PositionType.Static,
};
const OVERFLOW: Record<string, number> = {
  visible: Overflow.Visible,
  hidden: Overflow.Hidden,
  scroll: Overflow.Scroll,
};
const DISPLAY: Record<string, number> = {
  flex: Display.Flex,
  none: Display.None,
};

type Applier = (node: YogaNode, value: unknown) => void;

/**
 * Yoga accepts a number, `${number}%`, or 'auto', and THROWS on anything else
 * ("Invalid value calc(400px * -1) for setPosition"). Web-flavored values
 * reach here whenever a library's web branch gets resolved — calc(), min(),
 * vh units — and a throw from inside layout takes down the entire tree for
 * one unsupported declaration. Drop what Yoga cannot express, warn once so
 * the gap is findable, and lay out the rest.
 */
const warnedDimValues = new Set<string>();
const dim = (v: unknown): Dim => {
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'number') return Number.isFinite(v) ? (v as Dim) : undefined;
  if (typeof v === 'string') {
    if (v === 'auto') return v as Dim;
    // Percent and plain numeric strings are the only other forms Yoga parses.
    if (/^-?\d*\.?\d+%$/.test(v)) return v as Dim;
    if (/^-?\d*\.?\d+$/.test(v)) return Number.parseFloat(v) as Dim;
    if (!warnedDimValues.has(v)) {
      warnedDimValues.add(v);
      console.warn(
        `native-surface: ignoring unsupported dimension value ${JSON.stringify(v)} — ` +
          `layout accepts a number, a "<n>%" string, or "auto".`
      );
    }
    return undefined;
  }
  return undefined;
};
const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);

/**
 * Every yoga-relevant style key. Each applier must handle `undefined` by
 * restoring the yoga default so style updates that REMOVE a key behave.
 */
const YOGA_APPLIERS: Record<string, Applier> = {
  flexDirection: (n, v) => n.setFlexDirection(FLEX_DIRECTION[v as string] ?? FlexDirection.Column),
  justifyContent: (n, v) => n.setJustifyContent(JUSTIFY[v as string] ?? Justify.FlexStart),
  alignItems: (n, v) => n.setAlignItems(ALIGN[v as string] ?? Align.Stretch),
  alignSelf: (n, v) => n.setAlignSelf(ALIGN[v as string] ?? Align.Auto),
  alignContent: (n, v) => n.setAlignContent(ALIGN[v as string] ?? Align.FlexStart),
  flexWrap: (n, v) => n.setFlexWrap(WRAP[v as string] ?? Wrap.NoWrap),
  position: (n, v) => n.setPositionType(POSITION[v as string] ?? PositionType.Relative),
  overflow: (n, v) => n.setOverflow(OVERFLOW[v as string] ?? Overflow.Visible),
  display: (n, v) => n.setDisplay(DISPLAY[v as string] ?? Display.Flex),
  flex: (n, v) => n.setFlex(num(v)),
  flexGrow: (n, v) => n.setFlexGrow(num(v)),
  flexShrink: (n, v) => n.setFlexShrink(num(v)),
  flexBasis: (n, v) => n.setFlexBasis(dim(v)),
  width: (n, v) => n.setWidth(dim(v)),
  height: (n, v) => n.setHeight(dim(v)),
  minWidth: (n, v) => n.setMinWidth(dim(v) as number | `${number}%` | undefined),
  minHeight: (n, v) => n.setMinHeight(dim(v) as number | `${number}%` | undefined),
  maxWidth: (n, v) => n.setMaxWidth(dim(v) as number | `${number}%` | undefined),
  maxHeight: (n, v) => n.setMaxHeight(dim(v) as number | `${number}%` | undefined),
  aspectRatio: (n, v) => {
    if (typeof v === 'string') {
      const parts = v.split('/').map((p) => parseFloat(p.trim()));
      const ratio = parts.length === 2 && parts[1] ? parts[0]! / parts[1] : parseFloat(v);
      n.setAspectRatio(Number.isFinite(ratio) ? ratio : undefined);
    } else {
      n.setAspectRatio(num(v));
    }
  },
  zIndex: () => {}, // paint-order only

  margin: (n, v) => n.setMargin(Edge.All, dim(v)),
  marginHorizontal: (n, v) => n.setMargin(Edge.Horizontal, dim(v)),
  marginVertical: (n, v) => n.setMargin(Edge.Vertical, dim(v)),
  marginTop: (n, v) => n.setMargin(Edge.Top, dim(v)),
  marginBottom: (n, v) => n.setMargin(Edge.Bottom, dim(v)),
  marginLeft: (n, v) => n.setMargin(Edge.Left, dim(v)),
  marginRight: (n, v) => n.setMargin(Edge.Right, dim(v)),
  marginStart: (n, v) => n.setMargin(Edge.Start, dim(v)),
  marginEnd: (n, v) => n.setMargin(Edge.End, dim(v)),

  padding: (n, v) => n.setPadding(Edge.All, dim(v) as number | `${number}%` | undefined),
  paddingHorizontal: (n, v) => n.setPadding(Edge.Horizontal, dim(v) as number | `${number}%` | undefined),
  paddingVertical: (n, v) => n.setPadding(Edge.Vertical, dim(v) as number | `${number}%` | undefined),
  paddingTop: (n, v) => n.setPadding(Edge.Top, dim(v) as number | `${number}%` | undefined),
  paddingBottom: (n, v) => n.setPadding(Edge.Bottom, dim(v) as number | `${number}%` | undefined),
  paddingLeft: (n, v) => n.setPadding(Edge.Left, dim(v) as number | `${number}%` | undefined),
  paddingRight: (n, v) => n.setPadding(Edge.Right, dim(v) as number | `${number}%` | undefined),
  paddingStart: (n, v) => n.setPadding(Edge.Start, dim(v) as number | `${number}%` | undefined),
  paddingEnd: (n, v) => n.setPadding(Edge.End, dim(v) as number | `${number}%` | undefined),

  top: (n, v) => n.setPosition(Edge.Top, dim(v) as number | `${number}%` | undefined),
  bottom: (n, v) => n.setPosition(Edge.Bottom, dim(v) as number | `${number}%` | undefined),
  left: (n, v) => n.setPosition(Edge.Left, dim(v) as number | `${number}%` | undefined),
  right: (n, v) => n.setPosition(Edge.Right, dim(v) as number | `${number}%` | undefined),

  gap: (n, v) => n.setGap(Gutter.All, dim(v) as number | `${number}%` | undefined),
  rowGap: (n, v) => n.setGap(Gutter.Row, dim(v) as number | `${number}%` | undefined),
  columnGap: (n, v) => n.setGap(Gutter.Column, dim(v) as number | `${number}%` | undefined),

  borderWidth: (n, v) => n.setBorder(Edge.All, num(v)),
  borderTopWidth: (n, v) => n.setBorder(Edge.Top, num(v)),
  borderBottomWidth: (n, v) => n.setBorder(Edge.Bottom, num(v)),
  borderLeftWidth: (n, v) => n.setBorder(Edge.Left, num(v)),
  borderRightWidth: (n, v) => n.setBorder(Edge.Right, num(v)),
};

/** Resolve an alignSelf style value to the yoga enum (Auto when unset). */
export function alignSelfValue(v: unknown): number {
  return ALIGN[v as string] ?? Align.Auto;
}

/**
 * Applies `next` to the yoga node, resetting keys present in `prev` but
 * absent in `next` back to yoga defaults.
 */
export function applyYogaStyle(node: YogaNode, next: FlatStyle, prev: FlatStyle | null): void {
  if (prev) {
    for (const key of Object.keys(prev)) {
      if (!(key in next) && key in YOGA_APPLIERS) YOGA_APPLIERS[key]!(node, undefined);
    }
  }
  for (const [key, value] of Object.entries(next)) {
    const applier = YOGA_APPLIERS[key];
    if (applier && (!prev || prev[key] !== value)) applier(node, value);
  }
}

// ---------------------------------------------------------------------------
// Paint style resolution
// ---------------------------------------------------------------------------

export interface PaintStyle {
  backgroundColor: RGBA | null;
  opacity: number;
  radii: { tl: number; tr: number; bl: number; br: number };
  borderWidths: { t: number; r: number; b: number; l: number };
  borderColor: RGBA | null;
  shadow: { color: RGBA; dx: number; dy: number; radius: number; opacity: number } | null;
  /** Derived from `elevation`; painted only under the android theme. */
  elevationShadow: { color: RGBA; dx: number; dy: number; radius: number; opacity: number } | null;
  transform: TransformStyle[] | null;
  overflowHidden: boolean;
  zIndex: number;
}

export function resolvePaintStyle(flat: FlatStyle): PaintStyle {
  const radius = typeof flat.borderRadius === 'number' ? flat.borderRadius : 0;
  const bw = typeof flat.borderWidth === 'number' ? flat.borderWidth : 0;
  const shadowColor = parseColor(flat.shadowColor as string | undefined);
  const shadowOpacity = typeof flat.shadowOpacity === 'number' ? flat.shadowOpacity : shadowColor ? 1 : 0;
  const shadowRadius = typeof flat.shadowRadius === 'number' ? flat.shadowRadius : 0;
  const offset = (flat.shadowOffset as { width?: number; height?: number } | undefined) ?? {};
  const elevation = typeof flat.elevation === 'number' ? flat.elevation : 0;

  let shadow: PaintStyle['shadow'] = null;
  if (shadowColor && shadowOpacity > 0 && (shadowRadius > 0 || offset.width || offset.height)) {
    shadow = {
      color: shadowColor,
      dx: offset.width ?? 0,
      dy: offset.height ?? 0,
      radius: shadowRadius,
      opacity: shadowOpacity,
    };
  }
  let elevationShadow: PaintStyle['elevationShadow'] = null;
  if (elevation > 0) {
    elevationShadow = {
      color: { r: 0, g: 0, b: 0, a: 1 },
      dx: 0,
      dy: Math.max(1, elevation * 0.5),
      radius: Math.max(1, elevation * 0.9),
      opacity: 0.2,
    };
  }

  const overflow = flat.overflow as string | undefined;
  return {
    backgroundColor: parseColor(flat.backgroundColor as string | undefined),
    opacity: typeof flat.opacity === 'number' ? Math.min(Math.max(flat.opacity, 0), 1) : 1,
    radii: {
      tl: (flat.borderTopLeftRadius as number | undefined) ?? radius,
      tr: (flat.borderTopRightRadius as number | undefined) ?? radius,
      bl: (flat.borderBottomLeftRadius as number | undefined) ?? radius,
      br: (flat.borderBottomRightRadius as number | undefined) ?? radius,
    },
    borderWidths: {
      t: (flat.borderTopWidth as number | undefined) ?? bw,
      r: (flat.borderRightWidth as number | undefined) ?? bw,
      b: (flat.borderBottomWidth as number | undefined) ?? bw,
      l: (flat.borderLeftWidth as number | undefined) ?? bw,
    },
    borderColor: parseColor(flat.borderColor as string | undefined),
    shadow,
    elevationShadow,
    transform: (flat.transform as TransformStyle[] | undefined) ?? null,
    overflowHidden: overflow === 'hidden' || overflow === 'scroll',
    zIndex: typeof flat.zIndex === 'number' ? flat.zIndex : 0,
  };
}

// ---------------------------------------------------------------------------
// Text style resolution
// ---------------------------------------------------------------------------

export interface ResolvedTextStyle {
  color: RGBA;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  lineHeight: number | null;
  letterSpacing: number;
  textAlign: 'left' | 'right' | 'center' | 'justify';
  underline: boolean;
  lineThrough: boolean;
}

export const DEFAULT_TEXT_STYLE: ResolvedTextStyle = {
  color: { r: 0, g: 0, b: 0, a: 1 },
  fontFamily: 'Inter',
  fontSize: 14,
  fontWeight: 400,
  italic: false,
  lineHeight: null,
  letterSpacing: 0,
  textAlign: 'left',
  underline: false,
  lineThrough: false,
};

export function resolveFontWeight(w: unknown): number | null {
  if (w == null) return null;
  if (typeof w === 'number') return w;
  if (w === 'bold') return 700;
  if (w === 'normal') return 400;
  const n = parseInt(String(w), 10);
  return Number.isFinite(n) ? n : null;
}

/** Merges a flat style onto an inherited resolved text style. */
export function resolveTextStyle(flat: FlatStyle, inherited: ResolvedTextStyle): ResolvedTextStyle {
  const color = parseColor(flat.color as string | undefined);
  const weight = resolveFontWeight(flat.fontWeight);
  const decoration = flat.textDecorationLine as string | undefined;
  const align = flat.textAlign as string | undefined;
  return {
    color: color ?? inherited.color,
    fontFamily:
      typeof flat.fontFamily !== 'string'
        ? inherited.fontFamily
        : flat.fontFamily === '' || flat.fontFamily === 'System'
          ? DEFAULT_TEXT_STYLE.fontFamily // explicit ''/'System' resets to the default, not the inherited family
          : flat.fontFamily,
    fontSize: typeof flat.fontSize === 'number' ? flat.fontSize : inherited.fontSize,
    fontWeight: weight ?? inherited.fontWeight,
    italic: flat.fontStyle != null ? flat.fontStyle === 'italic' : inherited.italic,
    lineHeight: typeof flat.lineHeight === 'number' ? flat.lineHeight : inherited.lineHeight,
    letterSpacing: typeof flat.letterSpacing === 'number' ? flat.letterSpacing : inherited.letterSpacing,
    textAlign:
      align === 'left' || align === 'right' || align === 'center' || align === 'justify' ? align : inherited.textAlign,
    underline: decoration != null ? decoration.includes('underline') : inherited.underline,
    lineThrough: decoration != null ? decoration.includes('line-through') : inherited.lineThrough,
  };
}

export type LayoutEdges = { top: number; right: number; bottom: number; left: number };
export type LayoutFont = { size?: number; family?: string; weight?: string; lineHeight?: number; color?: string };

/** Own padding or margin from a flattened RN style. Omitted when nothing was set. */
export function layoutEdges(flat: FlatStyle, kind: 'padding' | 'margin'): LayoutEdges | undefined {
  const all = num(flat[kind]);
  const h = num(flat[`${kind}Horizontal`]) ?? all;
  const v = num(flat[`${kind}Vertical`]) ?? all;
  const top = num(flat[`${kind}Top`]) ?? v;
  const right = num(flat[`${kind}Right`]) ?? h;
  const bottom = num(flat[`${kind}Bottom`]) ?? v;
  const left = num(flat[`${kind}Left`]) ?? h;
  if (top == null && right == null && bottom == null && left == null) return undefined;
  return { top: top ?? 0, right: right ?? 0, bottom: bottom ?? 0, left: left ?? 0 };
}

/** Own font keys from a flattened RN style. Omitted when none were set. */
export function layoutFont(flat: FlatStyle): LayoutFont | undefined {
  const font: LayoutFont = {};
  if (typeof flat.fontSize === 'number') font.size = flat.fontSize;
  if (typeof flat.fontFamily === 'string') font.family = flat.fontFamily;
  if (flat.fontWeight != null) font.weight = String(flat.fontWeight);
  if (typeof flat.lineHeight === 'number') font.lineHeight = flat.lineHeight;
  if (typeof flat.color === 'string') font.color = flat.color;
  return Object.keys(font).length > 0 ? font : undefined;
}
