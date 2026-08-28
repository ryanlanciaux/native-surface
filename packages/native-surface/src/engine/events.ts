import type { CNode } from './node';
import { applyToPoint, invert, transformMatrix } from './matrix';
import { inlineChildrenOf } from './text';
import { now } from '../env/index';
import type { Insets, PressEvent, ScrollEvent } from '../types';
import {
  maxOffset,
  getOffset,
  setOffset,
  rubberBand,
  scrollEventFor,
  specOf,
  startRelease,
  stopMotion,
} from './scrollPhysics';

const MOVE_CANCEL_SLOP = 10; // px of movement that turns a touch into a scroll
const LONG_PRESS_MS = 500;
// RN Pressability's default pressRetentionOffset: how far a touch may wander
// off the pressable before the press cancels.
const PRESS_RETENTION = { top: 20, left: 20, right: 20, bottom: 30 };

interface PathEntry {
  node: CNode;
  /** pointer position in the node's local (untransformed) coordinate space */
  localX: number;
  localY: number;
}

function slopFor(node: CNode): { t: number; r: number; b: number; l: number } {
  const raw = node.props.__hitSlop as number | Insets | undefined;
  if (raw == null) return { t: 0, r: 0, b: 0, l: 0 };
  if (typeof raw === 'number') return { t: raw, r: raw, b: raw, l: raw };
  return { t: raw.top ?? 0, r: raw.right ?? 0, b: raw.bottom ?? 0, l: raw.left ?? 0 };
}

function pointerEventsOf(node: CNode): string {
  // Precedence mirrors RN: an imperative setNativeProps write is the latest
  // word — reanimated web delivers useAnimatedProps as a top-level patch key
  // OR merged into the style patch (so it lands in nativeStyle) — then the
  // React prop, then the static style key (RN 0.71+ allows pointerEvents in
  // style; react-native-drawer-layout's overlay gates input entirely through
  // the animated channels, and its initial value arrives as a React prop
  // that must NOT outrank later animated writes).
  return (
    (node.nativeProps?.pointerEvents as string | undefined) ??
    ((node.nativeStyle as Record<string, unknown> | null)?.pointerEvents as string | undefined) ??
    (node.props.pointerEvents as string | undefined) ??
    ((node.flatStyle as Record<string, unknown>).pointerEvents as string | undefined) ??
    'auto'
  );
}

/**
 * Absolute rect of a node in root CSS px, accounting for ancestor scroll
 * offsets. Transforms are ignored (press retention is an approximation there).
 */
function absoluteRect(node: CNode): { x: number; y: number; w: number; h: number } {
  return node.absoluteRect();
}

/**
 * Builds the visual-topmost hit path from `node` down. `x`/`y` are in the
 * node's parent content space (already adjusted for the parent's scroll).
 */
function hitPath(node: CNode, x: number, y: number, out: PathEntry[]): boolean {
  if (node.hidden || node.flatStyle.display === 'none') return false;
  const pe = pointerEventsOf(node);
  if (pe === 'none') return false;

  let lx = x - node.frame.x;
  let ly = y - node.frame.y;
  if (node.paint.transform?.length) {
    const m = transformMatrix(node.paint.transform, node.frame.width / 2, node.frame.height / 2);
    const inv = invert(m);
    if (!inv) return false;
    const p = applyToPoint(inv, lx, ly);
    lx = p.x;
    ly = p.y;
  }

  const slop = node.props.__pressable ? slopFor(node) : { t: 0, r: 0, b: 0, l: 0 };
  const inBounds =
    lx >= -slop.l && ly >= -slop.t && lx <= node.frame.width + slop.r && ly <= node.frame.height + slop.b;

  const clips = node.paint.overflowHidden || node.type === 'scroll';
  if (clips && !inBounds) return false;

  const entry: PathEntry = { node, localX: lx, localY: ly };

  // A text node's children are runs the paragraph drew, with nothing to hit —
  // except its inline views, which are real nodes with their own frames and
  // their own handlers (an interactive badge inside a display name). Those are
  // gathered from the whole text subtree, since a nested <Text> is folded into
  // the paragraph and its own children are positioned in THIS node's space.
  if (pe !== 'box-only' && (node.type !== 'text' || node.isTextRoot)) {
    const cx = lx + (node.type === 'scroll' ? node.scrollX : 0);
    const cy = ly + (node.type === 'scroll' ? node.scrollY : 0);
    const kids = node.type === 'text' ? inlineChildrenOf(node) : node.paintOrderedChildren();
    for (let i = kids.length - 1; i >= 0; i--) {
      const sub: PathEntry[] = [];
      if (hitPath(kids[i]!, cx, cy, sub)) {
        // A hit child keeps its non-clipping ancestors in the path even when
        // the point is outside their own bounds (overflow:visible children can
        // press/scroll through the parent, matching RN's responder bubbling).
        if (pe !== 'box-none') out.push(entry);
        out.push(...sub);
        return true;
      }
    }
  }

  if (pe === 'box-none') return false;
  if (!inBounds) return false;
  out.push(entry);
  return true;
}

/**
 * Internal seam for gesture libraries (see API.md "internal seams"): a View
 * carrying `__panHandler` receives the raw pointer stream for gestures that
 * start on it. The handler owns activation logic (offsets, velocity); the
 * engine only arbitrates against press (cancelled past slop, like scroll)
 * and scroll (a pan claim wins over an ancestor scroll).
 */
export interface PanStreamEvent {
  x: number;
  y: number;
  timestamp: number;
}
export interface PanHandler {
  onDown(e: PanStreamEvent): void;
  onMove(e: PanStreamEvent): void;
  onUp(e: PanStreamEvent): void;
  onCancel(): void;
  /** True while the RNGH gesture is ACTIVE (activation offsets met, fail
   *  offsets not exceeded). Absent on legacy handlers: engine falls back to
   *  claim-past-slop. */
  claimed?(): boolean;
}

interface ActiveGesture {
  path: PathEntry[];
  press: PathEntry | null;
  scroll: PathEntry | null;
  pan: PathEntry | null;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  scrolling: boolean;
  panning: boolean;
  cancelled: boolean;
  longPressFired: boolean;
  longPressTimer: ReturnType<typeof setTimeout> | null;
  /** recent pointer samples for release-velocity estimation */
  samples: Array<{ t: number; x: number; y: number }>;
  /** raw (un-rubber-banded) drag offset of the scrolled axis at gesture start */
  dragRawStart: number;
  /** cumulative raw pointer travel converted to content px along the scrolled axis */
  dragRaw: number;
  beganDragFired: boolean;
}

/** Preferred recency window for velocity estimation. */
const VELOCITY_WINDOW_MS = 100;
/** A velocity estimate needs at least this much time span to mean anything. */
const MIN_VELOCITY_SPAN_MS = 20;
/** Never reach further back than this for a baseline (protects hold-then-flick). */
const VELOCITY_MAX_SPAN_MS = 350;

export interface PointerHooks {
  requestRepaint(): void;
  onAction?: (name: string, payload?: unknown) => void;
}

export class PointerPipeline {
  private active: ActiveGesture | null = null;

  constructor(
    private readonly getRoot: () => CNode,
    private readonly hooks: PointerHooks
  ) {}

  private pressEvent(pageX: number, pageY: number, entry: PathEntry | null): PressEvent {
    return {
      nativeEvent: {
        locationX: entry?.localX ?? pageX,
        locationY: entry?.localY ?? pageY,
        pageX,
        pageY,
        timestamp: now(),
      },
    };
  }

  private call(node: CNode, prop: string, ev: unknown): void {
    const fn = node.props[prop] as ((e: unknown) => void) | undefined;
    if (fn) {
      this.hooks.onAction?.(prop.replace(/^__on/, 'on'), (ev as PressEvent).nativeEvent ?? ev);
      fn(ev);
    }
  }

  private cancelPress(pageX: number, pageY: number): void {
    const a = this.active;
    if (!a || !a.press || a.cancelled) return;
    if (a.longPressTimer) clearTimeout(a.longPressTimer);
    a.longPressTimer = null;
    a.cancelled = true;
    this.call(a.press.node, '__onPressOut', this.pressEvent(pageX, pageY, a.press));
  }

  /** Wheel scrolling: clamped, no momentum (trackpads bring their own inertia). */
  private wheelScrollBy(entry: PathEntry, dx: number, dy: number): void {
    const node = entry.node;
    stopMotion(node, true);
    const spec = specOf(node);
    const horizontal = !!spec.horizontal;
    // wheel vertical delta drives horizontal scroll when the view only scrolls horizontally
    const delta = horizontal ? (dx !== 0 ? dx : dy) : dy;
    const next = Math.min(maxOffset(node, horizontal), Math.max(0, getOffset(node, horizontal) + delta));
    if (next !== getOffset(node, horizontal)) {
      setOffset(node, horizontal, next, true);
      this.hooks.requestRepaint();
    }
  }

  /** Finger drag: content follows the pointer, rubber-banding past the edges. */
  private dragScrollTo(a: ActiveGesture, entry: PathEntry): void {
    const node = entry.node;
    const spec = specOf(node);
    const horizontal = !!spec.horizontal;
    const bounces = spec.bounces !== false;
    const raw = a.dragRawStart + a.dragRaw;
    const max = maxOffset(node, horizontal);
    const dim = horizontal ? node.frame.width : node.frame.height;
    let eff: number;
    if (raw < 0) {
      eff = bounces ? -rubberBand(-raw, dim) : 0;
    } else if (raw > max) {
      eff = bounces ? max + rubberBand(raw - max, dim) : max;
    } else {
      eff = raw;
    }
    if (eff !== getOffset(node, horizontal)) {
      setOffset(node, horizontal, eff, true);
      this.hooks.requestRepaint();
    }
  }

  /**
   * Release velocity of the CONTENT (px/ms) along the scrolled axis.
   *
   * Prefers the samples inside the recency window, but when they span too
   * little time to be meaningful (browsers coalesce pointermoves — a fast
   * swipe can arrive as ONE move right before the up), extends the baseline
   * to older samples until the span reaches MIN_VELOCITY_SPAN_MS. A
   * drag-hold-release still yields ~0: the displacement since the last move
   * is zero and older samples only grow the denominator.
   */
  private releaseVelocity(a: ActiveGesture, horizontal: boolean): number {
    const s = a.samples;
    if (s.length < 2) return 0;
    const newest = s[s.length - 1]!;
    let oldest = newest;
    for (let i = s.length - 2; i >= 0; i--) {
      const cand = s[i]!;
      const span = newest.t - cand.t;
      if (span > VELOCITY_MAX_SPAN_MS) break;
      oldest = cand;
      if (span >= MIN_VELOCITY_SPAN_MS && span >= VELOCITY_WINDOW_MS) break;
    }
    const dt = newest.t - oldest.t;
    if (dt < MIN_VELOCITY_SPAN_MS) {
      // still too thin (all samples bunched at the release instant)
      return 0;
    }
    const dPointer = horizontal ? newest.x - oldest.x : newest.y - oldest.y;
    return -dPointer / dt; // content moves opposite the finger
  }

  private beginDragIfNeeded(a: ActiveGesture): void {
    if (a.beganDragFired || !a.scroll) return;
    a.beganDragFired = true;
    a.scroll.node.scrollHold = true;
    specOf(a.scroll.node).onScrollBeginDrag?.(scrollEventFor(a.scroll.node));
  }

  private endDrag(a: ActiveGesture): void {
    if (!a.scroll) return;
    const node = a.scroll.node;
    node.scrollHold = false;
    if (!a.beganDragFired) return;
    const horizontal = !!specOf(node).horizontal;
    const v = this.releaseVelocity(a, horizontal);
    const ev = scrollEventFor(node);
    (ev.nativeEvent as { velocity?: { x: number; y: number } }).velocity = {
      x: horizontal ? v : 0,
      y: horizontal ? 0 : v,
    };
    specOf(node).onScrollEndDrag?.(ev);
    startRelease(node, v);
  }

  private panHandlerOf(entry: PathEntry | null): PanHandler | null {
    return (entry?.node.props.__panHandler as PanHandler | undefined) ?? null;
  }

  /** Cancels any in-flight gesture (pointercancel, or the root unmounting). */
  cancelActive(): void {
    const a = this.active;
    if (!a) return;
    this.cancelPress(a.lastX, a.lastY);
    this.panHandlerOf(a.pan)?.onCancel();
    if (a.scrolling && a.scroll) {
      // a cancelled drag still settles: spring back if rubber-banded
      a.scroll.node.scrollHold = false;
      if (a.beganDragFired) startRelease(a.scroll.node, 0);
    }
    if (a.longPressTimer) clearTimeout(a.longPressTimer);
    a.longPressTimer = null;
    this.active = null;
  }

  dispatch(
    type: 'down' | 'move' | 'up' | 'cancel' | 'wheel',
    e: { x: number; y: number; deltaX?: number; deltaY?: number; t?: number }
  ): void {
    const root = this.getRoot();
    if (type === 'cancel') {
      this.cancelActive();
      return;
    }
    if (type === 'wheel') {
      const path: PathEntry[] = [];
      hitPath(root, e.x, e.y, path);
      for (let i = path.length - 1; i >= 0; i--) {
        const entry = path[i]!;
        if (entry.node.type === 'scroll' && (entry.node.props.__scroll as { enabled?: boolean } | undefined)?.enabled !== false) {
          this.wheelScrollBy(entry, e.deltaX ?? 0, e.deltaY ?? 0);
          return;
        }
      }
      return;
    }

    if (type === 'down') {
      const path: PathEntry[] = [];
      hitPath(root, e.x, e.y, path);
      let press: PathEntry | null = null;
      let scroll: PathEntry | null = null;
      let pan: PathEntry | null = null;
      for (let i = path.length - 1; i >= 0; i--) {
        const entry = path[i]!;
        if (!press && entry.node.props.__pressable && !entry.node.props.__disabled) press = entry;
        if (!scroll && entry.node.type === 'scroll' && (entry.node.props.__scroll as { enabled?: boolean } | undefined)?.enabled !== false)
          scroll = entry;
        if (!pan && entry.node.props.__panHandler) pan = entry;
      }
      // Catching a decelerating/bouncing scroll view: the touch stops the
      // motion, immediately owns dragging (no slop), and never presses (iOS).
      const caught = !!(scroll && scroll.node.scrollMotion);
      if (caught) {
        stopMotion(scroll!.node, true);
        press = null;
      }
      const ts = e.t ?? now();
      const gesture: ActiveGesture = {
        path,
        press,
        scroll,
        pan,
        startX: e.x,
        startY: e.y,
        lastX: e.x,
        lastY: e.y,
        scrolling: caught,
        panning: false,
        cancelled: false,
        longPressFired: false,
        longPressTimer: null,
        samples: [{ t: ts, x: e.x, y: e.y }],
        dragRawStart: scroll ? getOffset(scroll.node, !!specOf(scroll.node).horizontal) : 0,
        dragRaw: 0,
        beganDragFired: false,
      };
      this.active = gesture;
      if (caught) this.beginDragIfNeeded(gesture);
      this.panHandlerOf(pan)?.onDown({ x: e.x, y: e.y, timestamp: now() });
      if (press) {
        this.call(press.node, '__onPressIn', this.pressEvent(e.x, e.y, press));
        if (press.node.props.__onLongPress) {
          gesture.longPressTimer = setTimeout(() => {
            if (this.active === gesture && !gesture.cancelled && !gesture.scrolling) {
              gesture.longPressFired = true;
              this.call(press.node, '__onLongPress', this.pressEvent(gesture.lastX, gesture.lastY, press));
            }
          }, LONG_PRESS_MS);
        }
      }
      return;
    }

    const a = this.active;
    if (!a) return;

    if (type === 'move') {
      const dx = e.x - a.lastX;
      const dy = e.y - a.lastY;
      a.lastX = e.x;
      a.lastY = e.y;
      const ts = e.t ?? now();
      a.samples.push({ t: ts, x: e.x, y: e.y });
      // keep enough history for the extended baseline (coalesced-move safety)
      while (a.samples.length > 2 && ts - a.samples[0]!.t > VELOCITY_MAX_SPAN_MS) a.samples.shift();
      const dist = Math.hypot(e.x - a.startX, e.y - a.startY);

      // A pan claim wins over scroll and (past slop) over press — but only an
      // ACTIVATED pan claims. A constrained pan that fails (e.g. a drawer's
      // x-axis edge-swipe under a vertical list) must release the drag so the
      // scroll view underneath can take it, matching RNGH arbitration.
      if (a.pan) {
        const h = this.panHandlerOf(a.pan);
        h?.onMove({ x: e.x, y: e.y, timestamp: now() });
        const claimed = h?.claimed ? h.claimed() : dist > MOVE_CANCEL_SLOP;
        if (!a.panning && claimed) {
          a.panning = true;
          this.cancelPress(e.x, e.y);
        }
        if (a.panning) return;
      }

      if (!a.scrolling && a.scroll && dist > MOVE_CANCEL_SLOP) {
        // Scroll takes an unclaimed drag; an undecided pan is cancelled
        // (RNGH: a beginning scroll cancels pans that never activated).
        if (a.pan) {
          this.panHandlerOf(a.pan)?.onCancel();
          a.pan = null;
        }
        a.scrolling = true;
        this.cancelPress(e.x, e.y);
        this.beginDragIfNeeded(a);
      }
      if (a.scrolling && a.scroll) {
        // content follows the pointer (rubber-banding past the edges)
        const horizontal = !!specOf(a.scroll.node).horizontal;
        a.dragRaw += horizontal ? -dx : -dy;
        this.dragScrollTo(a, a.scroll);
        return;
      }
      if (a.press && !a.cancelled) {
        // Cancel when the pointer leaves the captured pressable's own rect
        // (+hitSlop +RN press retention). Deliberately NOT a topmost re-hit:
        // sliding over a higher-zIndex sibling must not cancel the press.
        const rect = absoluteRect(a.press.node);
        const slop = slopFor(a.press.node);
        const within =
          e.x >= rect.x - slop.l - PRESS_RETENTION.left &&
          e.y >= rect.y - slop.t - PRESS_RETENTION.top &&
          e.x <= rect.x + rect.w + slop.r + PRESS_RETENTION.right &&
          e.y <= rect.y + rect.h + slop.b + PRESS_RETENTION.bottom;
        if (!within) this.cancelPress(e.x, e.y);
      }
      return;
    }

    // up
    this.active = null;
    if (a.longPressTimer) clearTimeout(a.longPressTimer);
    this.panHandlerOf(a.pan)?.onUp({ x: e.x, y: e.y, timestamp: now() });
    if (a.scrolling) {
      const ts = e.t ?? now();
      a.samples.push({ t: ts, x: e.x, y: e.y });
      this.endDrag(a);
    }
    if (a.scrolling || a.panning || !a.press || a.cancelled) return;
    this.call(a.press.node, '__onPressOut', this.pressEvent(e.x, e.y, a.press));
    if (!a.longPressFired) {
      this.call(a.press.node, '__onPress', this.pressEvent(e.x, e.y, a.press));
    }
  }
}
