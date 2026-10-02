import type { CNode } from '../engine/node';
import { IDENTITY, multiply, translation, transformMatrix, type Mat3 } from '../engine/matrix';
import { pointerEventsOf } from '../engine/events';
import { contentInsetsOf, displayTextOf, getInputParagraph, getParagraph, inlineChildrenOf, paragraphRunsOf } from '../engine/text';
import { hasDomOverlay, inputValueOf, specOfInput } from '../engine/textInputState';
import { specOf } from '../engine/scrollPhysics';
import { DEFAULT_TEXT_STYLE, resolveTextStyle } from '../engine/styles';
import { parseColor } from '../engine/colors';
import { area, envelope, intersect, overlaps, rectPolygon, subtract, transformRect } from './geometry';
import type { Point, Rect, ScrollRegion, Snapshot, SnapshotNode, TextFragment, Viewport } from './types';

interface Glyph { text: string; polygon: Point[]; approximate: boolean }
interface Entry {
  node: SnapshotNode;
  clip: Point[];
  glyphs: Glyph[];
  pieces: Point[][];
  opaque: boolean;
  paints: boolean;
}
const string = (v: unknown): string | undefined => typeof v === 'string' ? v : undefined;

function glyphsOf(node: CNode, m: Mat3, approximate: boolean): Glyph[] {
  const insets = contentInsetsOf(node);
  const input = node.type === 'textinput';
  const displayed = input ? displayTextOf(node) : null;
  const color = displayed?.isPlaceholder ? parseColor(specOfInput(node).placeholderTextColor ?? '#9BA1AB')
    : resolveTextStyle(node.flatStyle, DEFAULT_TEXT_STYLE).color;
  const runs = input ? [{ text: displayed!.text, alpha: color?.a ?? 1 }] : paragraphRunsOf(node);
  const text = runs.map(r => r.text).join('');
  const width = Math.max(0, node.frame.width - insets.left - insets.right);
  const para = input ? getInputParagraph(node, width) : getParagraph(node, width);
  const height = Math.max(0, node.frame.height - insets.top - insets.bottom);
  const y = input && !specOfInput(node).multiline
    ? insets.top + Math.max(0, (height - para.getHeight()) / 2) : insets.top;
  const tm = multiply(m, translation(insets.left, y));
  const glyphs: Glyph[] = [];
  let offset = 0;
  let lastEnd = -1;
  let ellipsis = false;
  for (const run of runs) {
    for (let i = offset; i < offset + run.text.length; i++) {
      if (i < lastEnd) continue;
      const info = para.getGlyphInfoAt(i);
      if (!info) continue;
      const { start, end } = info.graphemeClusterTextRange;
      lastEnd = Math.max(i + 1, end);
      if (run.alpha <= 0) continue;
      if (info.isEllipsis && ellipsis) continue;
      if (info.isEllipsis) ellipsis = true;
      const r = info.graphemeLayoutBounds;
      const value = info.isEllipsis ? '…' : text.slice(start, end);
      if (!value || value === '\uFFFC' || value === '\u200b') continue;
      glyphs.push({ text: value, approximate,
        polygon: transformRect(tm, { x: r[0]!, y: r[1]!, width: r[2]! - r[0]!, height: r[3]! - r[1]! }) });
    }
    offset += run.text.length;
  }
  // CanvasKit 0.40's UTF-16 lookup omits generated ellipses (and merges
  // their advance into the last source cluster). Read the actual shaped run,
  // identify the ellipsis by its font's glyph id, and retain its real position.
  if (!ellipsis && para.didExceedMaxLines() && node.props.ellipsizeMode !== 'clip') {
    const lines = para.getShapedLines();
    try {
      const last = lines.at(-1), run = last?.runs.at(-1);
      const metrics = para.getLineMetricsAt(para.getNumberOfLines() - 1);
      if (last && run && metrics && run.glyphs.length === 1 && run.typeface &&
        run.glyphs[0] === run.typeface.getGlyphIDs('…')[0]) {
        const x1 = run.positions[0]!, x2 = run.positions[2]!;
        const clip = transformRect(tm, { x: metrics.left, y: last.top,
          width: metrics.width, height: last.bottom - last.top });
        const previous = glyphs.at(-1);
        if (previous) previous.polygon = intersect(previous.polygon, clip);
        let at = 0, alpha = 1;
        for (const source of runs) {
          if (metrics.endIndex - 1 < at + source.text.length) { alpha = source.alpha; break; }
          at += source.text.length;
        }
        if (alpha > 0) glyphs.push({ text: '…', approximate,
          polygon: transformRect(tm, { x: Math.min(x1, x2), y: last.top,
            width: Math.abs(x2 - x1), height: last.bottom - last.top }) });
      }
    } finally {
      // getShapedLines returns retained Typeface handles, not JS-only data.
      const faces = new Set(lines.flatMap(line => line.runs.map(run => run.typeface)).filter(Boolean));
      for (const face of faces) face.delete();
    }
  }
  return glyphs;
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

/** Traverses existing paint participants; no parallel live tree or Yoga exposure. */
export function buildSnapshot(root: CNode, viewport: Viewport, revision: number, timestamp: number, focusedNode: number | null): Snapshot {
  const entries: Entry[] = [], scrollRegions: ScrollRegion[] = [];
  const visit = (node: CNode, parentId: number | null, parentM: Mat3, x: number, y: number,
    clip: Point[], opacity: number, hidden: boolean, blocked: boolean, approximate: boolean, parentScrollId: number | null) => {
    const f = node.frame;
    let m = multiply(parentM, translation(f.x, f.y));
    if (node.paint.transform?.length) m = multiply(m, transformMatrix(node.paint.transform, f.width / 2, f.height / 2));
    const polygon = transformRect(m, { x: 0, y: 0, width: f.width, height: f.height });
    const bounds = envelope(polygon) ?? { x: m[2], y: m[5], width: 0, height: 0 };
    opacity *= node.paint.opacity;
    hidden ||= node.hidden || node.flatStyle.display === 'none' || opacity <= 0;
    const clips = node.type === 'scroll' || node.paint.overflowHidden;
    const radii = Object.values(node.paint.radii).some(r => r > 0);
    approximate ||= (clips && radii) || node.props.__maskedView === true;
    const childClip = clips ? intersect(clip, polygon) : clip;
    const visiblePoly = hidden ? [] : intersect(polygon, clip);
    const pe = pointerEventsOf(node);
    blocked ||= node.hidden || node.flatStyle.display === 'none';
    const disabled = !!(node.props.__disabled || node.props.disabled ||
      (node.props.accessibilityState as { disabled?: boolean } | undefined)?.disabled ||
      (node.type === 'textinput' && specOfInput(node).editable === false));
    const dom = hasDomOverlay(node) || !!node.props.__portal;
    const out: SnapshotNode = {
      id: node.id, parentId, type: node.type,
      role: string(node.props.accessibilityRole ?? node.props.role) ??
        (node.props.__pressable && node.type !== 'textinput' ? 'button' : undefined),
      label: string(node.props.accessibilityLabel ?? node.props['aria-label']),
      testID: string(node.props.testID),
      layoutBounds: { x: x + f.x, y: y + f.y, width: f.width, height: f.height },
      bounds, polygon, visibleBounds: envelope(visiblePoly), visible: visiblePoly.length > 0,
      approximate: approximate || dom, occlusion: 'none',
      interactive: !blocked && pe !== 'none' && pe !== 'box-none' && !disabled &&
        !!(node.props.__pressable || node.props.__panHandler || node.type === 'scroll'),
      disabled, focused: node.id === focusedNode, opacity, rendering: dom ? 'dom' : 'canvas',
    };
    const textNode = node.type === 'text' || node.type === 'textinput';
    const state = node.props.accessibilityState as Record<string, unknown> | undefined;
    for (const key of ['checked', 'selected', 'expanded'] as const) {
      if (typeof state?.[key] === 'boolean') out[key] = state[key];
    }
    if (node.type === 'textinput') {
      const spec = specOfInput(node);
      out.secure = !!spec.secureTextEntry;
      out.editable = spec.editable !== false;
      out.placeholder = spec.placeholder;
      out.inputPurpose = out.secure ? 'password' : spec.autoComplete === 'username' ? 'username'
        : spec.autoComplete === 'one-time-code' ? 'one-time-code' : 'none';
      if (!out.secure) out.value = inputValueOf(node);
    }
    const glyphs = textNode && !hidden && !dom ? glyphsOf(node, m, out.approximate) : [];
    if (textNode) out.text = glyphs.map(g => g.text).join('');
    const visibleBox = envelope(visiblePoly);
    const rectangularClip = visibleBox && Math.abs(area(visiblePoly) - visibleBox.width * visibleBox.height) < 1e-4;
    const opaque = !!rectangularClip && !hidden && !approximate && !radii && opacity === 1 &&
      node.paint.backgroundColor?.a === 1 && Math.abs(m[1]) < 1e-6 && Math.abs(m[3]) < 1e-6;
    const paints = !!(node.paint.backgroundColor?.a || node.imageEntry || node.props.__draw ||
      node.props.__gradient || node.props.__backdropBlur || dom || glyphs.length);
    entries.push({ node: out, clip: childClip, glyphs, pieces: visiblePoly.length ? [visiblePoly] : [], opaque, paints });
    if (node.type === 'scroll') {
      const spec = specOf(node), horizontal = !!spec.horizontal;
      const offset = horizontal ? node.scrollX : node.scrollY;
      const extent = horizontal ? node.contentWidth : node.contentHeight;
      const size = horizontal ? f.width : f.height;
      scrollRegions.push({ id: node.id, parentScrollId, bounds, visibleBounds: out.visibleBounds,
        axis: horizontal ? 'horizontal' : 'vertical', enabled: spec.enabled !== false,
        offset: { x: node.scrollX, y: node.scrollY }, extent: { width: node.contentWidth, height: node.contentHeight },
        viewportExtent: { width: f.width, height: f.height },
        canScrollForward: spec.enabled !== false && offset < Math.max(0, extent - size),
        canScrollBackward: spec.enabled !== false && offset > 0 });
      parentScrollId = node.id;
    }
    const sx = node.type === 'scroll' ? node.scrollX : 0, sy = node.type === 'scroll' ? node.scrollY : 0;
    const childM = multiply(m, translation(-sx, -sy));
    const kids = node.type === 'text' ? inlineChildrenOf(node) : node.type === 'textinput' ? [] : node.paintOrderedChildren();
    for (const child of kids) {
      visit(child, node.id, childM, x + f.x - sx, y + f.y - sy, childClip, opacity, hidden,
        blocked || pe === 'none' || pe === 'box-only', approximate, parentScrollId);
    }
  };
  visit(root, null, IDENTITY, 0, 0, rectPolygon(viewport), 1, false, false, false, null);

  // Opaque rectangular later siblings can be subtracted exactly. For arbitrary
  // painted content report uncertainty instead of claiming pixel-level visibility.
  const byId = new Map(entries.map(e => [e.node.id, e.node]));
  const isDescendant = (node: SnapshotNode, id: number): boolean => {
    for (let p = node.parentId; p != null; p = byId.get(p)?.parentId ?? null) if (p === id) return true;
    return false;
  };
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!, node = entry.node;
    const occluders: Rect[] = [];
    const glyphOccluders: Rect[] = [];
    const uncertainGlyphBoxes: Rect[] = [];
    let uncertain = false;
    for (let j = i + 1; j < entries.length; j++) {
      const top = entries[j]!;
      if (!top.node.visible || !top.paints || !overlaps(node.bounds, top.node.bounds)) continue;
      const descendant = isDescendant(top.node, node.id);
      if (top.opaque && top.node.visibleBounds) {
        if (!descendant) occluders.push(top.node.visibleBounds);
        glyphOccluders.push(top.node.visibleBounds);
      } else {
        if (!descendant) uncertain = true;
        uncertainGlyphBoxes.push(top.node.bounds);
      }
    }
    let pieces = entry.pieces;
    const originalArea = pieces.reduce((sum, p) => sum + area(p), 0);
    for (const box of occluders) pieces = pieces.flatMap(p => subtract(p, box));
    const visibleArea = pieces.reduce((sum, p) => sum + area(p), 0);
    node.visibleBounds = envelope(pieces.flat());
    node.visible = visibleArea > 1e-6;
    node.occlusion = originalArea > 0 && !node.visible ? 'full' : uncertain ? 'unknown'
      : visibleArea < originalArea - 1e-5 ? 'partial' : 'none';
    node.approximate ||= uncertain;
    if (entry.glyphs.length) {
      const fragments: TextFragment[] = [];
      for (const glyph of entry.glyphs) {
        const bounds = envelope(glyph.polygon);
        if (!bounds) continue;
        let visible = [intersect(glyph.polygon, entry.clip)].filter(p => p.length);
        for (const box of glyphOccluders) visible = visible.flatMap(p => subtract(p, box));
        const remaining = visible.reduce((sum, p) => sum + area(p), 0);
        fragments.push({ text: glyph.text, bounds, visibleBounds: envelope(visible.flat()),
          clipped: remaining < area(glyph.polygon) - 1e-5,
          approximate: glyph.approximate || uncertainGlyphBoxes.some(box => overlaps(bounds, box)) });
      }
      node.textFragments = fragments;
    }
  }
  for (const scroll of scrollRegions) scroll.visibleBounds = byId.get(scroll.id)!.visibleBounds;
  return freeze({ viewport, revision, timestamp, nodes: entries.map(e => e.node), scrollRegions, focusedNode });
}
