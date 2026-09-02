import { createElement, type ReactElement } from 'react';
import type { Surface } from 'canvaskit-wasm';
import { Direction } from 'yoga-layout/load';
import { ensureEngine, getEngine } from './init';
import { CNode, type RootHooks } from './node';
import { paintNode, type PaintContext } from './paint';
import { PointerPipeline } from './events';
import { IDENTITY, applyToPoint, multiply, transformMatrix, translation, type Mat3 } from './matrix';
import { getReconciler, type ContainerHost } from '../reconciler/hostConfig';
import { setOverlayFactory, syncFocusedOverlay } from './textInputState';
import { createDomInputOverlay } from './textInputOverlay';
import { installIntersectionObserver } from './intersectionObserver';
import { inlineChildrenOf } from './text';
import { layoutEdges, layoutFont } from './styles';
import { destroyPortalOverlays, syncPortalOverlays } from './portalHost';
import {
  DimensionsContext,
  SurfaceInsetsContext,
  ZERO_INSETS,
  setPrimaryDimensions,
  pushActiveRenderDimensions,
  popActiveRenderDimensions,
  type SurfaceInsets,
  type WindowDimensions,
} from '../api/Dimensions';
import { setHairlineWidth } from '../api/StyleSheet';
import { isNode, scheduleFrame } from '../env/index';
import type { LayoutNode, NativeRoot, PointerEventType, RootOptions, SyntheticPointer } from '../types';

/** Partial insets fill in from zero — an embedder declaring only `top` means it. */
function resolveInsets(insets: RootOptions['safeAreaInsets']): SurfaceInsets {
  return insets ? { ...ZERO_INSETS, ...insets } : ZERO_INSETS;
}

/** Sub-pixel noise must not make an untransformed node look transformed. */
const PAINT_EPSILON = 0.01;

/**
 * A node's box under `m`, in surface coordinates.
 *
 * Under a pure translate/scale this is exact. Under a rotation or skew the
 * painted region is not axis-aligned at all, so the honest answer is the
 * bounding box of the four transformed corners plus a flag saying so — a
 * caller aiming a press still wants the center, and the center of the bounding
 * box IS the transformed center.
 */
function paintedRect(
  m: Mat3,
  width: number,
  height: number
): { x: number; y: number; width: number; height: number; rotated?: boolean } {
  const corners = [applyToPoint(m, 0, 0), applyToPoint(m, width, 0), applyToPoint(m, 0, height), applyToPoint(m, width, height)];
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const rect = { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
  // Off-diagonal terms are what a rotation or skew puts in; a translate/scale
  // leaves them at zero.
  return Math.abs(m[1]!) > PAINT_EPSILON || Math.abs(m[3]!) > PAINT_EPSILON ? { ...rect, rotated: true } : rect;
}

let firstRoot: RootImpl | null = null;
/** Insertion-ordered live roots; the oldest is the "primary" for Dimensions. */
const liveRoots = new Set<RootImpl>();

// A focused TextInput materializes a real DOM element through this factory
// (returns null under Node → headless focus; the state machine still runs).
setOverlayFactory(createDomInputOverlay);

export class RootImpl implements NativeRoot, RootHooks, ContainerHost {
  cssWidth: number;
  private safeAreaInsets: SurfaceInsets;
  cssHeight: number;
  dpr: number;
  theme: 'ios' | 'android';
  onAction?: RootOptions['onAction'];

  readonly rootNode: CNode;
  readonly canvas: HTMLCanvasElement | null;
  private surface: Surface | null = null;
  private fiberRoot: unknown = null;
  private pendingElement: ReactElement | null = null;
  private mounted = false;
  private destroyed = false;
  private dirty = false;
  private frameScheduled = false;
  private cancelFrame: (() => void) | null = null;
  private readonly readyPromise: Promise<void>;
  private ready = false;
  private readonly pointer: PointerPipeline;
  private detachListeners: (() => void) | null = null;

  constructor(target: HTMLCanvasElement | { surfaceWidth: number; surfaceHeight: number }, opts: RootOptions) {
    this.cssWidth = opts.width;
    this.cssHeight = opts.height;
    this.dpr = opts.dpr ?? (typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1);
    this.theme = opts.theme ?? 'ios';
    this.safeAreaInsets = resolveInsets(opts.safeAreaInsets);
    this.onAction = opts.onAction;
    this.canvas = typeof HTMLCanvasElement !== 'undefined' && target instanceof HTMLCanvasElement ? target : null;
    // A canvas root means app code is about to run in a browser, where
    // `typeof IntersectionObserver !== 'undefined'` is true and any web branch
    // gated on it will hand us an engine node. Install the delegating wrapper
    // before that can happen; it is idempotent and leaves real Elements alone.
    if (this.canvas) installIntersectionObserver();

    this.rootNode = new CNode('root', {});
    this.pointer = new PointerPipeline(
      () => this.rootNode,
      { requestRepaint: () => this.scheduleFlush(), onAction: (n, p) => this.onAction?.(n, p) }
    );

    liveRoots.add(this);
    if (!firstRoot) {
      firstRoot = this;
      setPrimaryDimensions(this.windowDimensions(), true);
      setHairlineWidth(1 / this.dpr);
    }

    if (this.canvas) this.attachDomListeners(this.canvas);

    this.readyPromise = ensureEngine().then(() => {
      if (this.destroyed) return;
      this.initGraphics();
      this.ready = true;
      if (this.pendingElement) this.mount(this.pendingElement);
    });
  }

  /**
   * Cached so its IDENTITY is stable while the numbers are.
   *
   * This object is the value of `DimensionsContext`, and `render()` re-provides
   * it on every commit of the embedding tree. A fresh object each time makes
   * React treat the context as changed, so every `useWindowDimensions()`
   * consumer re-renders — and any of them running an effect keyed on that
   * value re-runs it, sets state, and renders again. That is a "Maximum update
   * depth exceeded" waiting to happen, and it only became reachable once app
   * components could actually SEE this context (see api/Dimensions.ts on the
   * duplicate-module bug that had been hiding them from it).
   */
  private cachedDimensions: WindowDimensions | null = null;

  private windowDimensions(): WindowDimensions {
    const cached = this.cachedDimensions;
    if (cached && cached.width === this.cssWidth && cached.height === this.cssHeight && cached.scale === this.dpr) {
      return cached;
    }
    return (this.cachedDimensions = {
      width: this.cssWidth,
      height: this.cssHeight,
      scale: this.dpr,
      fontScale: 1,
    });
  }

  private initGraphics(): void {
    this.rootNode.rootHooks = this;
    // give the root a yoga node sized to the surface
    this.rootNode.updateProps({ style: { width: this.cssWidth, height: this.cssHeight } });
    this.createSurface();
  }

  private createSurface(): void {
    const { ck } = getEngine();
    this.surface?.delete();
    this.surface = null;
    if (this.canvas) {
      this.canvas.width = Math.max(1, Math.round(this.cssWidth * this.dpr));
      this.canvas.height = Math.max(1, Math.round(this.cssHeight * this.dpr));
      this.canvas.style.width = `${this.cssWidth}px`;
      this.canvas.style.height = `${this.cssHeight}px`;
      this.surface = ck.MakeWebGLCanvasSurface(this.canvas) ?? ck.MakeSWCanvasSurface(this.canvas);
    } else {
      this.surface = ck.MakeSurface(
        Math.max(1, Math.round(this.cssWidth * this.dpr)),
        Math.max(1, Math.round(this.cssHeight * this.dpr))
      );
    }
    if (!this.surface) throw new Error('native-surface: could not create a CanvasKit surface');
  }

  private attachDomListeners(canvas: HTMLCanvasElement): void {
    // The canvas may be CSS-stretched (width:100% etc.): map from its CSS box
    // to layout CSS px, or every hit is off by the stretch factor.
    const local = (e: { clientX: number; clientY: number }) => {
      const rect = canvas.getBoundingClientRect();
      const sx = rect.width > 0 ? this.cssWidth / rect.width : 1;
      const sy = rect.height > 0 ? this.cssHeight / rect.height : 1;
      return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy };
    };
    /** Pointer ids this root captured, so the window fallback only speaks for
     *  gestures that actually started on this canvas. */
    const activePointers = new Set<number>();
    const down = (e: PointerEvent) => {
      // Without this the browser may start its own text selection or image
      // drag from the pointerdown, which STEALS the pointer: capture is lost,
      // no pointerup ever reaches us, and the engine sits in a held gesture
      // forever — the drag-off-the-canvas-and-everything-stays-pressed bug.
      e.preventDefault();
      canvas.setPointerCapture?.(e.pointerId);
      activePointers.add(e.pointerId);
      this.pointer.dispatch('down', local(e));
    };
    const move = (e: PointerEvent) => this.pointer.dispatch('move', local(e));
    const endGesture = (kind: 'up' | 'cancel', e: PointerEvent) => {
      if (!activePointers.delete(e.pointerId)) return; // not ours, or already ended
      this.pointer.dispatch(kind, local(e));
    };
    const up = (e: PointerEvent) => endGesture('up', e);
    const cancel = (e: PointerEvent) => endGesture('cancel', e);
    /**
     * Capture can be revoked by the browser (a native drag starting, the tab
     * losing focus, a devtools inspect). The spec fires `lostpointercapture`
     * and then NOTHING else — no up, no cancel — so a gesture that is not
     * terminated here stays held for the rest of the session.
     */
    const lostCapture = (e: PointerEvent) => endGesture('cancel', e);
    /**
     * Belt and braces for the case where capture was never granted at all
     * (older Safari, a synthetic event with an unknown pointerId): a release
     * anywhere on the page ends a gesture this canvas started.
     */
    const windowUp = (e: PointerEvent) => endGesture('up', e);
    const windowCancel = (e: PointerEvent) => endGesture('cancel', e);
    const wheel = (e: WheelEvent) => {
      this.pointer.dispatch('wheel', { ...local(e), deltaX: e.deltaX, deltaY: e.deltaY });
      e.preventDefault();
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', cancel);
    canvas.addEventListener('lostpointercapture', lostCapture);
    canvas.addEventListener('wheel', wheel, { passive: false });
    // Window-level, and deliberately not capture-phase: these only fire for
    // ids still in activePointers, so they are a fallback rather than a
    // duplicate of the canvas handlers.
    window.addEventListener('pointerup', windowUp);
    window.addEventListener('pointercancel', windowCancel);
    this.detachListeners = () => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', cancel);
      canvas.removeEventListener('lostpointercapture', lostCapture);
      canvas.removeEventListener('wheel', wheel);
      window.removeEventListener('pointerup', windowUp);
      window.removeEventListener('pointercancel', windowCancel);
      activePointers.clear();
    };
  }

  // ---------------------------------------------------------------------------
  // RootHooks / ContainerHost
  // ---------------------------------------------------------------------------

  scheduleFlush(): void {
    this.dirty = true;
    if (this.frameScheduled || !this.ready || this.destroyed) return;
    this.frameScheduled = true;
    this.cancelFrame = scheduleFrame(() => {
      this.frameScheduled = false;
      this.cancelFrame = null;
      this.doFlush();
    });
  }

  onActionDispatch(name: string, payload?: unknown): void {
    this.onAction?.(name, payload);
  }

  getInputHost(): { canvas: HTMLCanvasElement | null; cssWidth: number; cssHeight: number } {
    return { canvas: this.canvas, cssWidth: this.cssWidth, cssHeight: this.cssHeight };
  }

  private doFlush(): void {
    if (!this.ready || this.destroyed || !this.surface) return;
    this.dirty = false;
    const { ck } = getEngine();

    this.rootNode.applyPreLayoutFixups();
    this.rootNode.yoga?.calculateLayout(this.cssWidth, this.cssHeight, Direction.LTR);
    const layoutEvents: Array<() => void> = [];
    this.rootNode.syncLayout(layoutEvents);

    const canvas = this.surface.getCanvas();
    const ctx: PaintContext = { ck, canvas, theme: this.theme, needsAnimationFrame: false };
    canvas.clear(ck.TRANSPARENT);
    canvas.save();
    canvas.scale(this.dpr, this.dpr);
    paintNode(ctx, this.rootNode);
    canvas.restore();
    this.surface.flush();

    for (const fire of layoutEvents) fire();
    // controlled-value changes and layout/scroll movement must reach a live
    // TextInput overlay (repositions the DOM element, syncs its value)
    syncFocusedOverlay(this.rootNode);
    // same beat for portal elements (iframes, videos): create/diff/reposition
    syncPortalOverlays(this.rootNode);
    // continuous repaint for time-based paints (spinners, fading indicators) —
    // browser only; in Node a test drives frames explicitly via flush()
    if (ctx.needsAnimationFrame && !isNode) this.scheduleFlush();
  }

  // ---------------------------------------------------------------------------
  // NativeRoot
  // ---------------------------------------------------------------------------

  render(element: ReactElement): void {
    if (this.destroyed) {
      throw new Error('native-surface: render() called on an unmounted root — create a new root instead');
    }
    this.pendingElement = element;
    if (this.ready) this.mount(element);
  }

  setTheme(theme: 'ios' | 'android'): void {
    if (this.theme === theme) return;
    this.theme = theme;
    this.scheduleFlush();
  }

  setOnAction(onAction: RootOptions['onAction']): void {
    this.onAction = onAction; // pointer pipeline reads this.onAction at dispatch time
  }

  private mount(element: ReactElement): void {
    const r = getReconciler();
    if (!this.fiberRoot) {
      this.fiberRoot = r.createContainer(
        this,
        1, // ConcurrentRoot
        null,
        false,
        null,
        '',
        r.defaultOnUncaughtError,
        r.defaultOnCaughtError,
        r.defaultOnRecoverableError,
        () => {}
      );
    }
    this.mounted = true;
    const dims = this.windowDimensions();
    const wrapped = createElement(
      DimensionsContext.Provider,
      { value: dims },
      createElement(SurfaceInsetsContext.Provider, { value: this.safeAreaInsets }, element)
    );
    // While this root renders, module-level Dimensions.get answers with THIS
    // root's dims — libraries read it at mount (gorhom's initial position).
    const prevDims = pushActiveRenderDimensions(dims);
    try {
      r.updateContainerSync(wrapped, this.fiberRoot, null, null);
      r.flushSyncWork();
      r.flushPassiveEffects();
    } finally {
      popActiveRenderDimensions(prevDims);
    }
    this.scheduleFlush();
  }

  async whenReady(): Promise<void> {
    await this.readyPromise;
  }

  async flush(): Promise<void> {
    await this.readyPromise;
    // let queued microtasks/macrotasks (React passive effects, image callbacks,
    // our scheduled frame) settle, then force a synchronous flush
    await new Promise((resolve) => setTimeout(resolve, 0));
    this.cancelFrame?.();
    this.cancelFrame = null;
    this.frameScheduled = false;
    this.doFlush();
  }

  unmount(): void {
    if (this.destroyed) return;
    this.pointer.cancelActive(); // clears the long-press timer; fires pressOut while the tree is alive
    if (this.fiberRoot && this.mounted) {
      const r = getReconciler();
      r.updateContainerSync(null, this.fiberRoot, null, null);
      r.flushSyncWork();
      r.flushPassiveEffects(); // run useEffect cleanups in the canvas tree
    }
    this.destroyed = true;
    this.cancelFrame?.();
    this.cancelFrame = null;
    this.frameScheduled = false;
    this.detachListeners?.();
    destroyPortalOverlays(this.rootNode);
    this.rootNode.destroy();
    this.surface?.delete();
    this.surface = null;
    liveRoots.delete(this);
    if (firstRoot === this) {
      // Promote the oldest surviving root so Dimensions/hairlineWidth stay live.
      firstRoot = liveRoots.values().next().value ?? null;
      if (firstRoot) {
        setPrimaryDimensions(firstRoot.windowDimensions(), true);
        setHairlineWidth(1 / firstRoot.dpr);
      }
    }
  }

  resize(width: number, height: number, dpr?: number): void {
    if (this.destroyed) return;
    this.cssWidth = width;
    this.cssHeight = height;
    if (dpr !== undefined && dpr > 0) this.dpr = dpr;
    if (firstRoot === this) {
      setPrimaryDimensions(this.windowDimensions(), true);
      setHairlineWidth(1 / this.dpr);
    }
    if (!this.ready) return;
    this.rootNode.updateProps({ style: { width, height } });
    this.createSurface();
    if (this.mounted && this.pendingElement) this.mount(this.pendingElement); // re-provide dimensions context
    this.scheduleFlush();
  }

  setSafeAreaInsets(insets: RootOptions['safeAreaInsets']): void {
    const next = resolveInsets(insets);
    const cur = this.safeAreaInsets;
    if (next.top === cur.top && next.right === cur.right && next.bottom === cur.bottom && next.left === cur.left) return;
    this.safeAreaInsets = next;
    // The context value is built in mount(), so the tree has to be re-provided
    // for consumers to see the change.
    if (this.mounted && this.pendingElement) this.mount(this.pendingElement);
    this.scheduleFlush();
  }

  getLayoutTree(): LayoutNode {
    if (this.ready && this.dirty) {
      this.cancelFrame?.();
      this.cancelFrame = null;
      this.frameScheduled = false;
      this.doFlush();
    }
    /**
     * Two positions are carried down at once, and they are not the same thing:
     * `absX/absY` is where Yoga put the node, and `paintM` is the composed
     * transform that decides where it is actually drawn. The composition below
     * is the exact inverse of the hit path in events.ts — parent matrix, then
     * the parent's scroll, then this node's own frame offset, then its own
     * transform about its center — so `painted` and "what a press hits" cannot
     * drift apart.
     */
    const toLayoutNode = (node: CNode, absX: number, absY: number, paintM: Mat3): LayoutNode => {
      const x = absX + node.frame.x;
      const y = absY + node.frame.y;
      let m = multiply(paintM, translation(node.frame.x, node.frame.y));
      if (node.paint.transform?.length) {
        m = multiply(m, transformMatrix(node.paint.transform, node.frame.width / 2, node.frame.height / 2));
      }
      const children: LayoutNode[] = [];
      const scrollX = node.type === 'scroll' ? node.scrollX : 0;
      const scrollY = node.type === 'scroll' ? node.scrollY : 0;
      const childM = scrollX || scrollY ? multiply(m, translation(-scrollX, -scrollY)) : m;
      // A text node's real children are its INLINE VIEWS, gathered from the
      // whole subtree: a nested <Text> is folded into the same paragraph and
      // has no box of its own, so walking `children` would lose anything
      // inline inside one. Everything else walks its laid-out children.
      const kids = node.type === 'text' ? inlineChildrenOf(node) : node.children;
      for (const c of kids) {
        if (!c.participatesInYoga) continue;
        children.push(toLayoutNode(c, x - scrollX, y - scrollY, childM));
      }
      const out: LayoutNode = {
        type: node.type === 'rawtext' ? 'RawText' : node.type.charAt(0).toUpperCase() + node.type.slice(1),
        frame: { x, y, width: node.frame.width, height: node.frame.height },
        children,
      };
      const painted = paintedRect(m, node.frame.width, node.frame.height);
      // Only when it actually differs: an untransformed tree must serialize
      // exactly as it did before this existed.
      if (
        Math.abs(painted.x - x) > PAINT_EPSILON ||
        Math.abs(painted.y - y) > PAINT_EPSILON ||
        Math.abs(painted.width - node.frame.width) > PAINT_EPSILON ||
        Math.abs(painted.height - node.frame.height) > PAINT_EPSILON
      ) {
        out.painted = painted;
      }
      if (node.type === 'text') out.text = node.textContent();
      if (node.ownerName) out.name = node.ownerName;
      // Drivers (e2e, validation harnesses) locate elements by testID, role,
      // label, or placeholder and synthesize pointer events at frame centers.
      if (typeof node.props.testID === 'string') out.testID = node.props.testID;
      const role = node.props.accessibilityRole ?? node.props.role;
      if (typeof role === 'string') out.role = role;
      const label = node.props.accessibilityLabel ?? node.props['aria-label'];
      if (typeof label === 'string') out.label = label;
      if (typeof node.props.placeholder === 'string') out.placeholder = node.props.placeholder;
      const padding = layoutEdges(node.flatStyle, 'padding');
      if (padding) out.padding = padding;
      const margin = layoutEdges(node.flatStyle, 'margin');
      if (margin) out.margin = margin;
      const gap = typeof node.flatStyle.gap === 'number' ? node.flatStyle.gap : undefined;
      if (gap != null) out.gap = gap;
      const font = layoutFont(node.flatStyle);
      if (font) out.font = font;
      return out;
    };
    return toLayoutNode(this.rootNode, 0, 0, IDENTITY);
  }

  dispatchPointerEvent(type: PointerEventType, e: SyntheticPointer): void {
    this.pointer.dispatch(type, e);
  }

  /** Test helper: RGBA of the pixel at CSS coords (x, y) on the current surface. */
  readPixel(x: number, y: number): { r: number; g: number; b: number; a: number } {
    if (!this.surface) throw new Error('native-surface: no surface');
    const { ck } = getEngine();
    const img = this.surface.makeImageSnapshot();
    try {
      const px = img.readPixels(Math.round(x * this.dpr), Math.round(y * this.dpr), {
        width: 1,
        height: 1,
        colorType: ck.ColorType.RGBA_8888,
        alphaType: ck.AlphaType.Unpremul,
        colorSpace: ck.ColorSpace.SRGB,
      }) as Uint8Array | null;
      if (!px) throw new Error('native-surface: readPixels failed');
      return { r: px[0]!, g: px[1]!, b: px[2]!, a: px[3]! };
    } finally {
      img.delete();
    }
  }

  /** Node/test only: encode the current surface to PNG. */
  encodePNG(): Uint8Array {
    if (!this.surface) throw new Error('native-surface: no surface to snapshot');
    const img = this.surface.makeImageSnapshot();
    try {
      const bytes = img.encodeToBytes();
      if (!bytes) throw new Error('native-surface: PNG encode failed');
      return bytes;
    } finally {
      img.delete();
    }
  }
}

export function createNativeRoot(
  target: HTMLCanvasElement | { surfaceWidth: number; surfaceHeight: number },
  opts: RootOptions
): NativeRoot {
  return new RootImpl(target, opts);
}

export async function snapshotPNG(root: NativeRoot): Promise<Uint8Array> {
  await root.flush();
  return (root as RootImpl).encodePNG();
}
