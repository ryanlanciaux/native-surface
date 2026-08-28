/**
 * Inertial scrolling physics for ScrollView: momentum decay, rubber-band
 * overscroll, bounce-back, and animated scrollTo.
 *
 * Momentum matches React Native's DecayAnimation closed form exactly
 * (reference: Libraries/Animated/animations/DecayAnimation.js):
 *   x(t) = x0 + (v0 / (1 - d)) * (1 - e^(-(1 - d) * t))
 *   v(t) = v0 * e^(-(1 - d) * t)
 * with t in ms, v in px/ms, and d the per-ms deceleration —
 * 'normal' = 0.998, 'fast' = 0.99, same constants as UIScrollView. Rest when
 * the per-frame displacement falls under 0.1 px (RN's threshold).
 *
 * Rubber-band uses the iOS resistance form with c = 0.55:
 *   offset(raw) = (1 - 1 / (raw * c / dim + 1)) * dim
 * Bounce-back is a critically damped spring (ω below) — an approximation
 * tuned to UIScrollView feel (~350 ms settle), not a ported constant.
 *
 * pagingEnabled replaces free deceleration on release: the view animates
 * straight to a page boundary (page size = the viewport extent on the
 * scrolled axis). A flick past PAGING_FLICK_VELOCITY advances exactly one
 * page in the flick direction; a slower release settles on the nearest
 * boundary (UIScrollView paging never skips pages on a swipe).
 */
import type { CNode } from './node';
import { now } from '../env/index';
import { ticker, type TickFn } from './ticker';
import type { ScrollEvent } from '../types';

export const DECELERATION_NORMAL = 0.998;
export const DECELERATION_FAST = 0.99;
export const RUBBER_BAND_COEFF = 0.55;
/** Critically damped bounce-back rate, 1/ms (≈12/s → ~350 ms visible settle). */
export const BOUNCE_OMEGA = 0.012;
/** Below this release speed (px/ms) a drag ends without momentum. */
export const MIN_FLING_VELOCITY = 0.05;
/** Release speed (px/ms) past which a paging release advances one page. */
export const PAGING_FLICK_VELOCITY = 0.5;
/** RN DecayAnimation's rest threshold: per-frame displacement in px. */
const DECAY_REST_DELTA = 0.1;
const INDICATOR_MS = 900;
const SCROLL_TO_MS = 300;

export interface ScrollSpec {
  horizontal?: boolean;
  enabled?: boolean;
  bounces?: boolean;
  pagingEnabled?: boolean;
  decelerationRate?: 'normal' | 'fast' | number;
  showsIndicator?: boolean;
  onScroll?: (e: ScrollEvent) => void;
  onScrollBeginDrag?: (e: ScrollEvent) => void;
  onScrollEndDrag?: (e: ScrollEvent) => void;
  onMomentumScrollBegin?: (e: ScrollEvent) => void;
  onMomentumScrollEnd?: (e: ScrollEvent) => void;
}

export function specOf(node: CNode): ScrollSpec {
  return (node.props.__scroll as ScrollSpec | undefined) ?? {};
}

export function decelerationOf(spec: ScrollSpec): number {
  const r = spec.decelerationRate;
  if (typeof r === 'number' && r > 0 && r < 1) return r;
  return r === 'fast' ? DECELERATION_FAST : DECELERATION_NORMAL;
}

// --- closed forms (exported for tests) -------------------------------------

export function decayAt(from: number, v0: number, d: number, tMs: number): { x: number; v: number } {
  const k = 1 - d;
  return {
    x: from + (v0 / k) * (1 - Math.exp(-k * tMs)),
    v: v0 * Math.exp(-k * tMs),
  };
}

/** Where an unobstructed decay from `from` at `v0` comes to rest. */
export function decaySettleTarget(from: number, v0: number, d: number): number {
  return from + v0 / (1 - d);
}

/** iOS rubber-band: raw overshoot distance → displayed overshoot. */
export function rubberBand(raw: number, dim: number, c: number = RUBBER_BAND_COEFF): number {
  if (raw <= 0 || dim <= 0) return 0;
  return (1 - 1 / ((raw * c) / dim + 1)) * dim;
}

/**
 * Rest offset for a paging release: the nearest page boundary, except a flick
 * past PAGING_FLICK_VELOCITY advances exactly one page in the flick direction.
 * `dim` is the viewport extent on the scrolled axis (= the page size).
 */
export function pageSnapTarget(off: number, velocity: number, dim: number, max: number): number {
  const clamp = (v: number) => Math.min(max, Math.max(0, v));
  if (dim <= 0) return clamp(off);
  let page: number;
  if (velocity > PAGING_FLICK_VELOCITY) page = Math.floor(off / dim) + 1;
  else if (velocity < -PAGING_FLICK_VELOCITY) page = Math.ceil(off / dim) - 1;
  else page = Math.round(off / dim);
  return clamp(page * dim);
}

/** Critically damped spring displacement/velocity around 0. t in ms. */
export function bounceAt(x0: number, v0: number, omega: number, tMs: number): { x: number; v: number } {
  const e = Math.exp(-omega * tMs);
  const x = (x0 + (v0 + omega * x0) * tMs) * e;
  const v = (v0 - omega * (v0 + omega * x0) * tMs) * e;
  return { x, v };
}

// --- shared helpers ---------------------------------------------------------

export function maxOffset(node: CNode, horizontal: boolean): number {
  return horizontal
    ? Math.max(0, node.contentWidth - node.frame.width)
    : Math.max(0, node.contentHeight - node.frame.height);
}

export function getOffset(node: CNode, horizontal: boolean): number {
  return horizontal ? node.scrollX : node.scrollY;
}

export function scrollEventFor(node: CNode): ScrollEvent {
  return {
    nativeEvent: {
      contentOffset: { x: node.scrollX, y: node.scrollY },
      contentSize: { width: node.contentWidth, height: node.contentHeight },
      layoutMeasurement: { width: node.frame.width, height: node.frame.height },
    },
  };
}

/** Writes the scrolled-axis offset (unclamped — callers own clamping). */
export function setOffset(node: CNode, horizontal: boolean, value: number, emit: boolean): void {
  if (horizontal) node.scrollX = value;
  else node.scrollY = value;
  node.scrollIndicatorUntil = now() + INDICATOR_MS;
  if (emit) specOf(node).onScroll?.(scrollEventFor(node));
  node.markDirty();
}

// --- motion driver ----------------------------------------------------------

type Phase = 'momentum' | 'bounce' | 'scrollTo';

export interface ScrollMotionHandle {
  stop(fireMomentumEnd: boolean): void;
  readonly phase: Phase;
}

class Motion implements ScrollMotionHandle {
  phase: Phase;
  private startT: number;
  private from: number;
  private v0: number;
  private readonly d: number;
  private readonly horizontal: boolean;
  private readonly bounces: boolean;
  /** bounce anchor (the edge being sprung back to) */
  private edge = 0;
  /** scrollTo target */
  private target = 0;
  private readonly momentumCallbacks: boolean;
  private stopped = false;
  private readonly tick: TickFn;

  constructor(
    private readonly node: CNode,
    opts:
      | { kind: 'release'; velocity: number }
      | { kind: 'scrollTo'; target: number }
      | { kind: 'pageSnap'; target: number }
  ) {
    const spec = specOf(node);
    this.horizontal = !!spec.horizontal;
    this.bounces = spec.bounces !== false;
    this.d = decelerationOf(spec);
    this.startT = now();
    this.from = getOffset(node, this.horizontal);

    if (opts.kind === 'scrollTo' || opts.kind === 'pageSnap') {
      this.phase = 'scrollTo';
      this.v0 = 0;
      // A page snap announces itself as momentum: it replaces the deceleration
      // a release would have had, and pagers detect settle via momentum-end
      // (matching RN iOS, where an animated offset change ends in
      // onMomentumScrollEnd).
      this.momentumCallbacks = opts.kind === 'pageSnap';
      this.target = Math.min(maxOffset(node, this.horizontal), Math.max(0, opts.target));
      if (this.momentumCallbacks) spec.onMomentumScrollBegin?.(scrollEventFor(node));
    } else {
      this.momentumCallbacks = true;
      const max = maxOffset(node, this.horizontal);
      if (this.from < 0 || this.from > max) {
        // released while rubber-banded: spring straight back
        this.phase = 'bounce';
        this.edge = this.from < 0 ? 0 : max;
        this.v0 = opts.velocity;
      } else {
        this.phase = 'momentum';
        this.v0 = opts.velocity;
      }
      spec.onMomentumScrollBegin?.(scrollEventFor(node));
    }

    this.tick = (t) => this.onTick(t);
    node.scrollMotion = this;
    ticker.add(this.tick);
  }

  stop(fireMomentumEnd: boolean): void {
    if (this.stopped) return;
    this.stopped = true;
    ticker.remove(this.tick);
    if (this.node.scrollMotion === this) this.node.scrollMotion = null;
    if (fireMomentumEnd && this.momentumCallbacks) {
      specOf(this.node).onMomentumScrollEnd?.(scrollEventFor(this.node));
    }
  }

  private finish(): void {
    this.stop(true);
    this.node.markDirty();
  }

  private onTick(tNow: number): void {
    const node = this.node;
    // Node detached from a root: nothing to paint, stop silently.
    if (node.rootHooks == null) {
      this.stop(false);
      return;
    }
    const t = Math.max(0, tNow - this.startT);
    const max = maxOffset(node, this.horizontal);
    const prev = getOffset(node, this.horizontal);

    if (this.phase === 'scrollTo') {
      const p = Math.min(1, t / SCROLL_TO_MS);
      // ease-in-out cubic
      const eased = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      setOffset(node, this.horizontal, this.from + (this.target - this.from) * eased, true);
      if (p >= 1) this.finish();
      return;
    }

    if (this.phase === 'momentum') {
      const { x, v } = decayAt(this.from, this.v0, this.d, t);
      if (x < 0 || x > max) {
        const edge = x < 0 ? 0 : max;
        if (this.bounces) {
          // hand the remaining velocity to the bounce spring
          this.phase = 'bounce';
          this.edge = edge;
          this.startT = tNow;
          this.from = edge;
          this.v0 = v; // velocity at the crossing, sign preserved into the overshoot
          setOffset(node, this.horizontal, edge, true);
          return;
        }
        setOffset(node, this.horizontal, edge, true);
        this.finish();
        return;
      }
      setOffset(node, this.horizontal, x, true);
      if (Math.abs(x - prev) < DECAY_REST_DELTA && t > 32) this.finish();
      return;
    }

    // bounce: spring displacement around this.edge
    const x0 = this.from - this.edge;
    const { x, v } = bounceAt(x0, this.v0, BOUNCE_OMEGA, t);
    const value = this.edge + x;
    setOffset(node, this.horizontal, value, true);
    if (Math.abs(x) < 0.3 && Math.abs(v) < 0.005) {
      setOffset(node, this.horizontal, this.edge, true);
      this.finish();
    }
  }
}

/** Momentum/bounce after a drag release. Returns null when no motion starts. */
export function startRelease(node: CNode, velocity: number): ScrollMotionHandle | null {
  stopMotion(node, false);
  const spec = specOf(node);
  const horizontal = !!spec.horizontal;
  const max = maxOffset(node, horizontal);
  const off = getOffset(node, horizontal);
  const overscrolled = off < 0 || off > max;
  if (spec.pagingEnabled && !overscrolled) {
    // Paging replaces free deceleration. Rubber-banded releases fall through
    // to the bounce path below — its edges are page rest positions.
    const dim = horizontal ? node.frame.width : node.frame.height;
    const target = pageSnapTarget(off, velocity, dim, max);
    if (Math.abs(target - off) < 0.5) {
      // released resting on a boundary: no motion (and no momentum events)
      if (target !== off) setOffset(node, horizontal, target, true);
      return null;
    }
    return new Motion(node, { kind: 'pageSnap', target });
  }
  if (!overscrolled && Math.abs(velocity) < MIN_FLING_VELOCITY) return null;
  if (overscrolled && spec.bounces === false) {
    setOffset(node, horizontal, Math.min(max, Math.max(0, off)), true);
    return null;
  }
  return new Motion(node, { kind: 'release', velocity });
}

export function stopMotion(node: CNode, fireMomentumEnd: boolean): void {
  (node.scrollMotion as ScrollMotionHandle | null)?.stop(fireMomentumEnd);
}

export function scrollNodeTo(node: CNode, x: number, y: number, animated: boolean): void {
  stopMotion(node, true);
  const spec = specOf(node);
  const horizontal = !!spec.horizontal;
  const target = horizontal ? x : y;
  if (!animated) {
    const clamped = Math.min(maxOffset(node, horizontal), Math.max(0, target));
    // keep the non-scrolled axis stable; setOffset only writes the scrolled axis
    setOffset(node, horizontal, clamped, true);
    return;
  }
  // On a paging node an animated programmatic glide runs as a page snap so it
  // announces momentum begin/end (how pagers detect a setPage settling); free
  // scroll views keep the momentum channel gesture-only.
  new Motion(node, { kind: spec.pagingEnabled ? 'pageSnap' : 'scrollTo', target });
}

export function scrollNodeToEnd(node: CNode, animated: boolean): void {
  const spec = specOf(node);
  const horizontal = !!spec.horizontal;
  const end = maxOffset(node, horizontal);
  scrollNodeTo(node, horizontal ? end : 0, horizontal ? 0 : end, animated);
}
