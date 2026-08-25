import type { Canvas, CanvasKit, Path, Shader } from 'canvaskit-wasm';
import { parseColor, type RGBA } from './colors';
import type { ColorValue } from '../types';
import type { PaintContext } from './paint';

/** parseColor accepts 0xAARRGGBB numbers at runtime; ColorValue's type doesn't say so. */
function colorOf(c: string | number): RGBA | null {
  return parseColor(c as ColorValue);
}

/**
 * Generic draw-op channel: a serializable vector-drawing spec any producer can
 * attach to a host view via the `__draw` prop (react-native-svg compat is the
 * first). Ops paint in the node's local coordinate space — paintNode has
 * already applied the node's frame translate, transform, opacity and clip.
 *
 * Contract with producers: inherited SVG paint state (fill/stroke/… cascading
 * from groups) is resolved at COMPILE time — every leaf op arrives with final
 * paint fields. Group ops carry only structure (transform, opacity, clipPath);
 * the painter never propagates paint fields downward.
 */

/** 2D affine in SVG matrix(a b c d e f) order: x' = a·x + c·y + e. */
export type Affine = [number, number, number, number, number, number];

export interface GradientStop {
  /** 0–1 along the gradient axis. */
  offset: number;
  color: string | number;
  opacity?: number;
}

/**
 * objectBoundingBox coordinates are 0–1 fractions of the op's geometry bounds
 * (path.getBounds()); radii resolve against the SVG-normalized diagonal
 * √((w²+h²)/2). userSpaceOnUse coordinates are in the op's user units.
 */
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
  /** Focal point; a focal offset from (cx, cy) paints as two-point conical. */
  fx?: number;
  fy?: number;
  stops: GradientStop[];
  units: GradientUnits;
}

export type GradientSpec = LinearGradientSpec | RadialGradientSpec;

/**
 * 'none' suppresses the pass; a missing fill defaults to black and a missing
 * stroke to none (SVG defaults). Numbers are 0xAARRGGBB (processColor output).
 */
export type PaintRef = string | number | GradientSpec;

interface DrawOpCommon {
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
  /** Composed as a layer: fill+stroke fade together, overlap does not darken. */
  opacity?: number;
  transform?: Affine;
  /** SVG path data, intersected via canvas.clipPath before painting. */
  clipPath?: string;
}

export interface PathOp extends DrawOpCommon {
  op: 'path';
  /** SVG path data (ck.Path.MakeFromSVGString); invalid data skips the op. */
  d: string;
}

export interface RectOp extends DrawOpCommon {
  op: 'rect';
  x: number;
  y: number;
  width: number;
  height: number;
  rx?: number;
  ry?: number;
}

export interface CircleOp extends DrawOpCommon {
  op: 'circle';
  cx: number;
  cy: number;
  r: number;
}

export interface EllipseOp extends DrawOpCommon {
  op: 'ellipse';
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

export interface LineOp extends DrawOpCommon {
  op: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface GroupOp extends DrawOpCommon {
  op: 'group';
  children: DrawOp[];
}

export type DrawOp = PathOp | RectOp | CircleOp | EllipseOp | LineOp | GroupOp;

export interface DrawSpec {
  ops: DrawOp[];
  /** [minX, minY, width, height]; ops are in viewBox units when set. */
  viewBox?: [number, number, number, number];
  /** 'meet' (default): uniform scale to fit the frame, centered (xMidYMid meet). 'none': stretch. */
  preserveAspectRatio?: 'meet' | 'none';
}

function clamp01(v: number): number {
  return Math.min(Math.max(v, 0), 1);
}

function geometryPath(ck: CanvasKit, op: Exclude<DrawOp, GroupOp>): Path | null {
  switch (op.op) {
    case 'path':
      return ck.Path.MakeFromSVGString(op.d);
    case 'rect': {
      if (op.width <= 0 || op.height <= 0) return null;
      const p = new ck.Path();
      const rx = op.rx ?? op.ry ?? 0;
      const ry = op.ry ?? op.rx ?? 0;
      if (rx > 0 || ry > 0) p.addRRect(ck.RRectXY(ck.XYWHRect(op.x, op.y, op.width, op.height), rx, ry));
      else p.addRect(ck.XYWHRect(op.x, op.y, op.width, op.height));
      return p;
    }
    case 'circle': {
      if (op.r <= 0) return null;
      const p = new ck.Path();
      p.addCircle(op.cx, op.cy, op.r);
      return p;
    }
    case 'ellipse': {
      if (op.rx <= 0 || op.ry <= 0) return null;
      const p = new ck.Path();
      p.addOval(ck.LTRBRect(op.cx - op.rx, op.cy - op.ry, op.cx + op.rx, op.cy + op.ry));
      return p;
    }
    case 'line': {
      const p = new ck.Path();
      p.moveTo(op.x1, op.y1);
      p.lineTo(op.x2, op.y2);
      return p;
    }
  }
}

/** bounds is the geometry's fill bounds (stroke gradients reuse them too). */
function makeGradientShader(ck: CanvasKit, g: GradientSpec, bounds: Float32Array): Shader | null {
  const colors: Float32Array[] = [];
  const positions: number[] = [];
  for (const s of g.stops) {
    const c = colorOf(s.color);
    if (!c) continue;
    colors.push(ck.Color(c.r, c.g, c.b, c.a * clamp01(s.opacity ?? 1)));
    positions.push(clamp01(s.offset));
  }
  if (colors.length === 0) return null;
  if (colors.length === 1) {
    colors.push(colors[0]!);
    positions.push(1);
  }

  const obb = g.units === 'objectBoundingBox';
  const l = bounds[0]!;
  const t = bounds[1]!;
  const bw = bounds[2]! - l;
  const bh = bounds[3]! - t;
  const X = (v: number) => (obb ? l + v * bw : v);
  const Y = (v: number) => (obb ? t + v * bh : v);
  const R = (v: number) => (obb ? v * Math.sqrt((bw * bw + bh * bh) / 2) : v);

  if (g.type === 'linear') {
    return ck.Shader.MakeLinearGradient([X(g.x1), Y(g.y1)], [X(g.x2), Y(g.y2)], colors, positions, ck.TileMode.Clamp);
  }
  const cx = X(g.cx);
  const cy = Y(g.cy);
  const r = R(g.r);
  if (r <= 0) return null;
  const fx = g.fx != null ? X(g.fx) : cx;
  const fy = g.fy != null ? Y(g.fy) : cy;
  if (fx !== cx || fy !== cy) {
    return ck.Shader.MakeTwoPointConicalGradient([fx, fy], 0, [cx, cy], r, colors, positions, ck.TileMode.Clamp);
  }
  return ck.Shader.MakeRadialGradient([cx, cy], r, colors, positions, ck.TileMode.Clamp);
}

/** strokeOf non-null runs a stroke pass with that op's stroke geometry fields. */
function drawGeometry(
  ck: CanvasKit,
  canvas: Canvas,
  geom: Path,
  ref: Exclude<PaintRef, 'none'>,
  alpha: number,
  strokeOf: DrawOpCommon | null
): void {
  const paint = new ck.Paint();
  paint.setAntiAlias(true);
  let shader: Shader | null = null;
  if (typeof ref === 'object') {
    shader = makeGradientShader(ck, ref, geom.getBounds());
    if (!shader) {
      paint.delete();
      return;
    }
    paint.setShader(shader);
    paint.setAlphaf(alpha);
  } else {
    const c = colorOf(ref);
    if (!c) {
      paint.delete();
      return;
    }
    paint.setColor(ck.Color(c.r, c.g, c.b, c.a * alpha));
  }

  let dash: ReturnType<CanvasKit['PathEffect']['MakeDash']> | null = null;
  if (strokeOf) {
    paint.setStyle(ck.PaintStyle.Stroke);
    paint.setStrokeWidth(strokeOf.strokeWidth ?? 1);
    if (strokeOf.strokeLinecap === 'round') paint.setStrokeCap(ck.StrokeCap.Round);
    else if (strokeOf.strokeLinecap === 'square') paint.setStrokeCap(ck.StrokeCap.Square);
    if (strokeOf.strokeLinejoin === 'round') paint.setStrokeJoin(ck.StrokeJoin.Round);
    else if (strokeOf.strokeLinejoin === 'bevel') paint.setStrokeJoin(ck.StrokeJoin.Bevel);
    if (strokeOf.strokeMiterlimit != null) paint.setStrokeMiter(strokeOf.strokeMiterlimit);
    const da = strokeOf.strokeDasharray;
    if (da && da.length) {
      // SVG repeats an odd-length dash list doubled to make it even.
      const intervals = da.length % 2 ? da.concat(da) : da;
      dash = ck.PathEffect.MakeDash(intervals, strokeOf.strokeDashoffset ?? 0);
      paint.setPathEffect(dash);
    }
  }

  canvas.drawPath(geom, paint);
  paint.delete();
  shader?.delete();
  dash?.delete();
}

function paintOp(ck: CanvasKit, canvas: Canvas, op: DrawOp): void {
  const opacity = clamp01(op.opacity ?? 1);
  if (opacity <= 0) return;

  canvas.save();
  if (op.transform) {
    const [a, b, c, d, e, f] = op.transform;
    canvas.concat(Float32Array.of(a, c, e, b, d, f, 0, 0, 1));
  }
  let didLayer = false;
  if (opacity < 1) {
    const layerPaint = new ck.Paint();
    layerPaint.setAlphaf(opacity);
    canvas.saveLayer(layerPaint);
    layerPaint.delete();
    didLayer = true;
  }
  if (op.clipPath) {
    const clip = ck.Path.MakeFromSVGString(op.clipPath);
    if (clip) {
      canvas.clipPath(clip, ck.ClipOp.Intersect, true);
      clip.delete();
    }
  }

  if (op.op === 'group') {
    for (const child of op.children) paintOp(ck, canvas, child);
  } else {
    const geom = geometryPath(ck, op);
    if (geom) {
      // Fill under stroke, per SVG; a line has no fill geometry.
      const fill = op.fill ?? 'black';
      if (op.op !== 'line' && fill !== 'none') {
        geom.setFillType(op.fillRule === 'evenodd' ? ck.FillType.EvenOdd : ck.FillType.Winding);
        drawGeometry(ck, canvas, geom, fill, clamp01(op.fillOpacity ?? 1), null);
      }
      const stroke = op.stroke ?? 'none';
      if (stroke !== 'none' && (op.strokeWidth ?? 1) > 0) {
        drawGeometry(ck, canvas, geom, stroke, clamp01(op.strokeOpacity ?? 1), op);
      }
      geom.delete();
    }
  }

  if (didLayer) canvas.restore();
  canvas.restore();
}

/** width/height: the node's frame, the target box for viewBox mapping. */
export function paintDrawOps(ctx: PaintContext, spec: DrawSpec, width: number, height: number): void {
  const { ck, canvas } = ctx;
  canvas.save();
  const vb = spec.viewBox;
  if (vb && vb[2] > 0 && vb[3] > 0 && width > 0 && height > 0) {
    if (spec.preserveAspectRatio === 'none') {
      canvas.scale(width / vb[2], height / vb[3]);
    } else {
      const s = Math.min(width / vb[2], height / vb[3]);
      canvas.translate((width - vb[2] * s) / 2, (height - vb[3] * s) / 2);
      canvas.scale(s, s);
    }
    canvas.translate(-vb[0], -vb[1]);
  }
  for (const op of spec.ops) paintOp(ck, canvas, op);
  canvas.restore();
}
