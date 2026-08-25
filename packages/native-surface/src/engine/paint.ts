import type { Canvas, CanvasKit } from 'canvaskit-wasm';
import { Edge } from 'yoga-layout/load';
import { parseColor, type RGBA } from './colors';
import type { CNode } from './node';
import { getParagraph, getInputParagraph } from './text';
import { hasDomOverlay } from './textInputState';
import { transformMatrix } from './matrix';
import { now } from '../env/index';

export interface PaintContext {
  ck: CanvasKit;
  canvas: Canvas;
  /** Root theme: gates android-only paint behavior (elevation shadows). */
  theme: 'ios' | 'android';
  /** Set true when something time-based was painted (spinners, scroll indicators). */
  needsAnimationFrame: boolean;
}

function ckColor(ck: CanvasKit, c: RGBA, opacityMul = 1): Float32Array {
  return ck.Color(c.r, c.g, c.b, c.a * opacityMul);
}

function rrectFor(node: CNode, inset: number): Float32Array {
  const { width, height } = node.frame;
  const maxR = Math.min(width, height) / 2;
  const { tl, tr, bl, br } = node.paint.radii;
  const cl = (r: number) => Math.max(0, Math.min(r, maxR) - inset);
  return Float32Array.of(
    inset, inset, width - inset, height - inset,
    cl(tl), cl(tl), cl(tr), cl(tr), cl(br), cl(br), cl(bl), cl(bl)
  );
}

function paintBox(ctx: PaintContext, node: CNode): void {
  const { ck, canvas } = ctx;
  const p = node.paint;
  const { width, height } = node.frame;
  if (width <= 0 || height <= 0) return;

  // elevation is an Android-only prop on-device; iOS RN ignores it entirely.
  const shadow = p.shadow ?? (ctx.theme === 'android' ? p.elevationShadow : null);
  if (shadow) {
    const paint = new ck.Paint();
    paint.setAntiAlias(true);
    paint.setColor(ckColor(ck, shadow.color, shadow.opacity));
    let mask = null;
    if (shadow.radius > 0) {
      mask = ck.MaskFilter.MakeBlur(ck.BlurStyle.Normal, shadow.radius * 0.5, true);
      paint.setMaskFilter(mask);
    }
    canvas.save();
    canvas.translate(shadow.dx, shadow.dy);
    canvas.drawRRect(rrectFor(node, 0), paint);
    canvas.restore();
    paint.delete();
    mask?.delete();
  }

  if (p.backgroundColor && p.backgroundColor.a > 0) {
    const paint = new ck.Paint();
    paint.setAntiAlias(true);
    paint.setColor(ckColor(ck, p.backgroundColor));
    canvas.drawRRect(rrectFor(node, 0), paint);
    paint.delete();
  }
}

function paintBorder(ctx: PaintContext, node: CNode): void {
  const { ck, canvas } = ctx;
  const p = node.paint;
  const bw = p.borderWidths;
  if (!p.borderColor || (bw.t <= 0 && bw.r <= 0 && bw.b <= 0 && bw.l <= 0)) return;
  const { width, height } = node.frame;
  if (width <= 0 || height <= 0) return;
  const outer = rrectFor(node, 0);
  const maxR = Math.min(width, height) / 2;
  const { tl, tr, bl, br } = p.radii;
  const cl = (r: number, a: number, b: number) => Math.max(0, Math.min(r, maxR) - Math.max(a, b));
  const inner = Float32Array.of(
    bw.l, bw.t, width - bw.r, height - bw.b,
    cl(tl, bw.l, bw.t), cl(tl, bw.l, bw.t),
    cl(tr, bw.r, bw.t), cl(tr, bw.r, bw.t),
    cl(br, bw.r, bw.b), cl(br, bw.r, bw.b),
    cl(bl, bw.l, bw.b), cl(bl, bw.l, bw.b)
  );
  const paint = new ck.Paint();
  paint.setAntiAlias(true);
  paint.setColor(ckColor(ck, p.borderColor));
  canvas.drawDRRect(outer, inner, paint);
  paint.delete();
}

function contentInsets(node: CNode): { l: number; t: number; r: number; b: number } {
  const y = node.yoga;
  if (!y) return { l: 0, t: 0, r: 0, b: 0 };
  return {
    l: y.getComputedPadding(Edge.Left) + y.getComputedBorder(Edge.Left),
    t: y.getComputedPadding(Edge.Top) + y.getComputedBorder(Edge.Top),
    r: y.getComputedPadding(Edge.Right) + y.getComputedBorder(Edge.Right),
    b: y.getComputedPadding(Edge.Bottom) + y.getComputedBorder(Edge.Bottom),
  };
}

function paintText(ctx: PaintContext, node: CNode): void {
  const insets = contentInsets(node);
  const contentWidth = Math.max(0, node.frame.width - insets.l - insets.r);
  const para = getParagraph(node, contentWidth);
  ctx.canvas.drawParagraph(para, insets.l, insets.t);
}

function paintTextInput(ctx: PaintContext, node: CNode): void {
  // While a DOM overlay is live on this node, the DOM shows the text (and
  // caret); painting it again would double-render. Box/border still paint.
  if (hasDomOverlay(node)) return;
  const insets = contentInsets(node);
  const contentWidth = Math.max(0, node.frame.width - insets.l - insets.r);
  const contentHeight = Math.max(0, node.frame.height - insets.t - insets.b);
  const para = getInputParagraph(node, contentWidth);
  const multiline = !!(node.props.__input as { multiline?: boolean } | undefined)?.multiline;
  // RN vertically centers single-line input text inside a taller box.
  const y = multiline ? insets.t : insets.t + Math.max(0, (contentHeight - para.getHeight()) / 2);
  ctx.canvas.drawParagraph(para, insets.l, y);
}

function paintImage(ctx: PaintContext, node: CNode): void {
  const { ck, canvas } = ctx;
  const entry = node.imageEntry;
  if (!entry || entry.status !== 'loaded') return;
  const img = entry.image;
  const { width, height } = node.frame;
  if (width <= 0 || height <= 0) return;
  const iw = img.width();
  const ih = img.height();
  if (iw <= 0 || ih <= 0) return;

  const mode = (node.props.resizeMode as string | undefined) ?? (node.flatStyle.resizeMode as string | undefined) ?? 'cover';
  let src = ck.LTRBRect(0, 0, iw, ih);
  let dst = ck.LTRBRect(0, 0, width, height);
  if (mode === 'contain' || mode === 'cover') {
    const scale = mode === 'contain' ? Math.min(width / iw, height / ih) : Math.max(width / iw, height / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    dst = ck.LTRBRect((width - dw) / 2, (height - dh) / 2, (width + dw) / 2, (height + dh) / 2);
  } else if (mode === 'center') {
    dst = ck.LTRBRect((width - iw) / 2, (height - ih) / 2, (width + iw) / 2, (height + ih) / 2);
  }
  const paint = new ck.Paint();
  paint.setAntiAlias(true);
  // RN ImageStyle.tintColor: recolor every non-transparent pixel (SrcIn blend)
  // — how RN tints template icons; Skia does it as a color filter on the draw.
  const tint = parseColor((node.flatStyle as Record<string, unknown>).tintColor as string | undefined);
  let tintFilter: ReturnType<CanvasKit['ColorFilter']['MakeBlend']> | null = null;
  if (tint) {
    tintFilter = ck.ColorFilter.MakeBlend(ckColor(ck, tint), ck.BlendMode.SrcIn);
    paint.setColorFilter(tintFilter);
  }
  canvas.save();
  canvas.clipRRect(rrectFor(node, 0), ck.ClipOp.Intersect, true);
  // Linear + mipmap sampling: default/nearest looks jagged on any scaled draw.
  canvas.drawImageRectOptions(img, src, dst, ck.FilterMode.Linear, ck.MipmapMode.Linear, paint);
  canvas.restore();
  paint.delete();
  tintFilter?.delete();
}

function paintSpinner(ctx: PaintContext, node: CNode): void {
  const { ck, canvas } = ctx;
  const spec = node.props.__spinner as { size: number; color: RGBA } | undefined;
  if (!spec) return;
  const { width, height } = node.frame;
  const r = spec.size / 2 - 2;
  const cx = width / 2;
  const cy = height / 2;
  const paint = new ck.Paint();
  paint.setAntiAlias(true);
  paint.setStyle(ck.PaintStyle.Stroke);
  paint.setStrokeWidth(2.5);
  paint.setStrokeCap(ck.StrokeCap.Round);
  paint.setColor(ckColor(ck, spec.color));
  const start = ((now() / 4) % 360);
  canvas.drawArc(ck.LTRBRect(cx - r, cy - r, cx + r, cy + r), start, 270, false, paint);
  paint.delete();
  ctx.needsAnimationFrame = true;
}

function paintScrollIndicator(ctx: PaintContext, node: CNode): void {
  if ((node.props.__scroll as { showsIndicator?: boolean } | undefined)?.showsIndicator === false) return;
  if (now() >= node.scrollIndicatorUntil) return;
  const { ck, canvas } = ctx;
  const { width, height } = node.frame;
  const paint = new ck.Paint();
  paint.setAntiAlias(true);
  paint.setColor(ck.Color(0, 0, 0, 0.35));
  const horizontal = !!(node.props.__scroll as { horizontal?: boolean } | undefined)?.horizontal;
  if (horizontal && node.contentWidth > width) {
    const barW = Math.max(20, (width / node.contentWidth) * width);
    const barX = (node.scrollX / (node.contentWidth - width)) * (width - barW);
    canvas.drawRRect(ck.RRectXY(ck.LTRBRect(barX, height - 5, barX + barW, height - 2), 1.5, 1.5), paint);
  } else if (!horizontal && node.contentHeight > height) {
    const barH = Math.max(20, (height / node.contentHeight) * height);
    const barY = (node.scrollY / (node.contentHeight - height)) * (height - barH);
    canvas.drawRRect(ck.RRectXY(ck.LTRBRect(width - 5, barY, width - 2, barY + barH), 1.5, 1.5), paint);
  }
  paint.delete();
  ctx.needsAnimationFrame = true;
}

export function paintNode(ctx: PaintContext, node: CNode): void {
  if (node.hidden || node.flatStyle.display === 'none') return;
  const { ck, canvas } = ctx;
  const p = node.paint;
  const f = node.frame;

  canvas.save();
  canvas.translate(f.x, f.y);
  if (p.transform && p.transform.length) {
    const m = transformMatrix(p.transform, f.width / 2, f.height / 2);
    canvas.concat(Float32Array.from(m));
  }

  let didLayer = false;
  if (p.opacity < 1) {
    if (p.opacity <= 0) {
      canvas.restore();
      return;
    }
    const layerPaint = new ck.Paint();
    layerPaint.setAlphaf(p.opacity);
    canvas.saveLayer(layerPaint);
    layerPaint.delete();
    didLayer = true;
  }

  paintBox(ctx, node);

  const isScroll = node.type === 'scroll';
  const clips = p.overflowHidden || isScroll;
  if (clips) {
    canvas.save();
    canvas.clipRRect(rrectFor(node, 0), ck.ClipOp.Intersect, true);
  }
  if (isScroll) {
    canvas.save();
    canvas.translate(-node.scrollX, -node.scrollY);
  }

  if (node.type === 'text') paintText(ctx, node);
  else if (node.type === 'image') paintImage(ctx, node);
  else if (node.type === 'textinput') paintTextInput(ctx, node);

  if (node.type !== 'text' && node.type !== 'textinput') {
    for (const child of node.paintOrderedChildren()) paintNode(ctx, child);
  }

  if (isScroll) canvas.restore();
  if (clips) canvas.restore();

  paintBorder(ctx, node);
  paintSpinner(ctx, node);
  if (isScroll) paintScrollIndicator(ctx, node);

  if (didLayer) canvas.restore();
  canvas.restore();
}
