/**
 * IntersectionObserver over canvas nodes.
 *
 * Libraries and apps branch on `typeof IntersectionObserver !== 'undefined'`
 * to decide whether they can measure visibility. That is a BROWSER check, and
 * this host is a browser — so the branch is taken — but the thing they then
 * hand to `observe()` is an engine node, not an `Element`, and the real
 * observer rejects it outright:
 *
 *   TypeError: Failed to execute 'observe' on 'IntersectionObserver':
 *   parameter 1 is not of type 'Element'.
 *
 * There is no way to make a `CNode` pass that check — the platform brands it.
 * So this replaces the global with a wrapper that DELEGATES: a real `Element`
 * goes to the native observer with its behavior completely unchanged, and an
 * engine node is measured by the engine instead. Nothing an embedding page
 * does is affected, which is what makes replacing a standard global
 * acceptable here.
 *
 * The node path is a real viewport test, not a stub: the node's page rect
 * (`getBoundingClientRect`, the same geometry the DOM portal host places real
 * elements with) intersected against the root's rect. So a node scrolled out
 * of a list genuinely reports not-intersecting, which is the signal
 * scroll-driven features — visibility tracking, video autoplay arbitration —
 * actually need.
 *
 * Ceilings, both inherited from `CNode.absoluteRect()`:
 * - **Transforms are ignored**, so a node moved by a transform is measured at
 *   its untransformed frame.
 * - **Scroll-ancestor clipping is not modeled.** A node inside a ScrollView is
 *   measured at its own frame, which tracks with scrolling correctly, but the
 *   clip imposed by the ScrollView's own bounds is not subtracted. A node
 *   scrolled past the list's edge reports the visibility of where it is, not
 *   of the clipped remainder.
 *
 * Node-import-safe: installing is a no-op without a DOM.
 */
import { CNode } from './node';

/**
 * The subset of the entry a caller plausibly reads. `target` is widened to
 * cover both halves deliberately: ONE user callback receives entries from both
 * the delegated native observer and the engine-node path, so narrowing it to
 * `CNode` would misdescribe what a caller actually gets.
 */
export interface CanvasIntersectionEntry {
  readonly target: CNode | Element;
  readonly isIntersecting: boolean;
  readonly intersectionRatio: number;
  readonly boundingClientRect: DOMRectReadOnly;
  readonly intersectionRect: DOMRectReadOnly;
  readonly rootBounds: DOMRectReadOnly | null;
  readonly time: number;
}

type ObserverCallback = (entries: CanvasIntersectionEntry[], observer: unknown) => void;

interface Tracked {
  node: CNode;
  /** Last reported state, so the callback fires on CHANGE, as the real one does. */
  wasIntersecting: boolean | null;
  lastRatio: number;
}

function rect(x: number, y: number, width: number, height: number): DOMRectReadOnly {
  const r = { x, y, width, height, top: y, left: x, right: x + width, bottom: y + height };
  return { ...r, toJSON: () => r } as unknown as DOMRectReadOnly;
}

/** The viewport, or an explicit Element root's box. */
function rootRect(root: unknown): DOMRectReadOnly {
  if (root && typeof (root as Element).getBoundingClientRect === 'function' && root instanceof Element) {
    return (root as Element).getBoundingClientRect();
  }
  return rect(0, 0, window.innerWidth, window.innerHeight);
}

/** Normalized threshold list, ascending — matching the spec's handling. */
function thresholdsOf(options: IntersectionObserverInit | undefined): number[] {
  const t = options?.threshold;
  const list = t === undefined ? [0] : Array.isArray(t) ? [...t] : [t];
  return list.map((n) => Math.min(Math.max(Number(n) || 0, 0), 1)).sort((a, b) => a - b);
}

/**
 * Fraction of the node's box that lies inside the root's box. Zero-area nodes
 * report 0 rather than dividing by zero — a collapsed node is not visible.
 */
function intersectionOf(
  nodeRect: DOMRectReadOnly,
  root: DOMRectReadOnly
): { ratio: number; intersection: DOMRectReadOnly } {
  const left = Math.max(nodeRect.left, root.left);
  const top = Math.max(nodeRect.top, root.top);
  const right = Math.min(nodeRect.right, root.right);
  const bottom = Math.min(nodeRect.bottom, root.bottom);
  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);
  const area = nodeRect.width * nodeRect.height;
  return {
    ratio: area > 0 ? (width * height) / area : 0,
    intersection: rect(left, top, width, height),
  };
}

/**
 * Whether a ratio change crosses any threshold — the real observer's firing
 * rule. Crossing 0 is special-cased as "became (un)intersecting", because a
 * threshold of 0 means "any pixel at all" rather than "ratio > 0 exactly".
 */
function crossesThreshold(prev: number | null, next: number, thresholds: number[]): boolean {
  if (prev === null) return true; // first observation always reports
  for (const t of thresholds) {
    const was = t === 0 ? prev > 0 : prev >= t;
    const is = t === 0 ? next > 0 : next >= t;
    if (was !== is) return true;
  }
  return false;
}

/** Live observers with at least one engine-node target, driven by one loop. */
const active = new Set<{ check(): void }>();
let frame: number | null = null;

function pump(): void {
  frame = null;
  for (const o of [...active]) o.check();
  if (active.size > 0) frame = requestAnimationFrame(pump);
}

function ensurePumping(): void {
  if (frame === null && active.size > 0) frame = requestAnimationFrame(pump);
}

export function createCanvasIntersectionObserver(Native: typeof IntersectionObserver): typeof IntersectionObserver {
  class CanvasIntersectionObserver {
    private readonly callback: ObserverCallback;
    private readonly options: IntersectionObserverInit | undefined;
    private readonly thresholdList: number[];
    private readonly nodes = new Map<CNode, Tracked>();
    /** Built only if a real Element is ever observed — most surfaces never do. */
    private native: IntersectionObserver | null = null;

    constructor(callback: ObserverCallback, options?: IntersectionObserverInit) {
      this.callback = callback;
      this.options = options;
      this.thresholdList = thresholdsOf(options);
    }

    get root(): Element | Document | null {
      return (this.options?.root as Element | Document | null) ?? null;
    }
    get rootMargin(): string {
      return this.options?.rootMargin ?? '0px';
    }
    /** Spec property: the normalized, ascending threshold list. */
    get thresholds(): number[] {
      return this.thresholdList;
    }

    private nativeObserver(): IntersectionObserver {
      // Delegate with the caller's own callback and options: a real Element
      // must behave exactly as it would have without this wrapper.
      // The cast is the widening above, viewed from the other side: the native
      // observer hands back Elements, which CanvasIntersectionEntry allows.
      this.native ??= new Native(this.callback as unknown as IntersectionObserverCallback, this.options);
      return this.native;
    }

    observe(target: unknown): void {
      if (target instanceof CNode) {
        if (!this.nodes.has(target)) {
          this.nodes.set(target, { node: target, wasIntersecting: null, lastRatio: 0 });
          active.add(this);
          ensurePumping();
        }
        return;
      }
      this.nativeObserver().observe(target as Element);
    }

    unobserve(target: unknown): void {
      if (target instanceof CNode) {
        this.nodes.delete(target);
        if (this.nodes.size === 0) active.delete(this);
        return;
      }
      this.native?.unobserve(target as Element);
    }

    disconnect(): void {
      this.nodes.clear();
      active.delete(this);
      this.native?.disconnect();
    }

    /**
     * Always empty for engine-node targets: entries are delivered to the
     * callback in the same pass that computes them, so none are ever left
     * queued. (The real observer can queue between frames; nothing here can.)
     */
    takeRecords(): CanvasIntersectionEntry[] {
      return this.native?.takeRecords() ?? [];
    }

    /** One sampling pass over this observer's engine-node targets. */
    check(): void {
      if (this.nodes.size === 0) {
        active.delete(this);
        return;
      }
      const root = rootRect(this.options?.root);
      const entries: CanvasIntersectionEntry[] = [];
      for (const tracked of [...this.nodes.values()]) {
        const { node } = tracked;
        // A node deleted from the tree stops being observable, exactly as a
        // detached Element does.
        if (node.destroyed) {
          this.nodes.delete(node);
          continue;
        }
        const box = node.getBoundingClientRect() as unknown as DOMRectReadOnly;
        const { ratio, intersection } = intersectionOf(box, root);
        if (!crossesThreshold(tracked.wasIntersecting === null ? null : tracked.lastRatio, ratio, this.thresholdList)) {
          tracked.lastRatio = ratio;
          continue;
        }
        tracked.lastRatio = ratio;
        tracked.wasIntersecting = ratio > 0;
        entries.push({
          target: node,
          isIntersecting: ratio > 0,
          intersectionRatio: ratio,
          boundingClientRect: box,
          intersectionRect: intersection,
          rootBounds: root,
          time: performance.now(),
        });
      }
      if (this.nodes.size === 0) active.delete(this);
      if (entries.length === 0) return;
      this.callback(entries, this);
    }
  }

  return CanvasIntersectionObserver as unknown as typeof IntersectionObserver;
}

let installed = false;

/**
 * Replace the global with the delegating wrapper. Idempotent, and a no-op
 * without a DOM or without a native observer to fall back to.
 */
export function installIntersectionObserver(): void {
  if (installed || typeof window === 'undefined') return;
  const Native = (window as { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver;
  if (typeof Native !== 'function') return;
  installed = true;
  (window as { IntersectionObserver: typeof IntersectionObserver }).IntersectionObserver =
    createCanvasIntersectionObserver(Native);
}
