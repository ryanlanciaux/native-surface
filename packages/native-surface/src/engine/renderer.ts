import { createElement, type ReactElement } from 'react';
import type { Surface } from 'canvaskit-wasm';
import { Direction } from 'yoga-layout/load';
import { ensureEngine, getEngine } from './init';
import { CNode, type RootHooks } from './node';
import { paintNode, type PaintContext } from './paint';
import { PointerPipeline } from './events';
import { getReconciler, type ContainerHost } from '../reconciler/hostConfig';
import { setOverlayFactory, syncFocusedOverlay } from './textInputState';
import { createDomInputOverlay } from './textInputOverlay';
import {
  DimensionsContext,
  setPrimaryDimensions,
  pushActiveRenderDimensions,
  popActiveRenderDimensions,
} from '../api/Dimensions';
import { setHairlineWidth } from '../api/StyleSheet';
import { isNode, scheduleFrame } from '../env/index';
import type { LayoutNode, NativeRoot, PointerEventType, RootOptions, SyntheticPointer } from '../types';

let firstRoot: RootImpl | null = null;
/** Insertion-ordered live roots; the oldest is the "primary" for Dimensions. */
const liveRoots = new Set<RootImpl>();

// A focused TextInput materializes a real DOM element through this factory
// (returns null under Node → headless focus; the state machine still runs).
setOverlayFactory(createDomInputOverlay);

export class RootImpl implements NativeRoot, RootHooks, ContainerHost {
  cssWidth: number;
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
    this.onAction = opts.onAction;
    this.canvas = typeof HTMLCanvasElement !== 'undefined' && target instanceof HTMLCanvasElement ? target : null;

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

  private windowDimensions() {
    return { width: this.cssWidth, height: this.cssHeight, scale: this.dpr, fontScale: 1 };
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
    const down = (e: PointerEvent) => {
      canvas.setPointerCapture?.(e.pointerId);
      this.pointer.dispatch('down', local(e));
    };
    const move = (e: PointerEvent) => this.pointer.dispatch('move', local(e));
    const up = (e: PointerEvent) => this.pointer.dispatch('up', local(e));
    const cancel = (e: PointerEvent) => this.pointer.dispatch('cancel', local(e));
    const wheel = (e: WheelEvent) => {
      this.pointer.dispatch('wheel', { ...local(e), deltaX: e.deltaX, deltaY: e.deltaY });
      e.preventDefault();
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', cancel);
    canvas.addEventListener('wheel', wheel, { passive: false });
    this.detachListeners = () => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', cancel);
      canvas.removeEventListener('wheel', wheel);
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
    const wrapped = createElement(DimensionsContext.Provider, { value: dims }, element);
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

  getLayoutTree(): LayoutNode {
    if (this.ready && this.dirty) {
      this.cancelFrame?.();
      this.cancelFrame = null;
      this.frameScheduled = false;
      this.doFlush();
    }
    const toLayoutNode = (node: CNode, absX: number, absY: number): LayoutNode => {
      const x = absX + node.frame.x;
      const y = absY + node.frame.y;
      const children: LayoutNode[] = [];
      for (const c of node.children) {
        if (!c.participatesInYoga) continue;
        children.push(
          toLayoutNode(c, x - (node.type === 'scroll' ? node.scrollX : 0), y - (node.type === 'scroll' ? node.scrollY : 0))
        );
      }
      const out: LayoutNode = {
        type: node.type === 'rawtext' ? 'RawText' : node.type.charAt(0).toUpperCase() + node.type.slice(1),
        frame: { x, y, width: node.frame.width, height: node.frame.height },
        children,
      };
      if (node.type === 'text') out.text = node.textContent();
      // Drivers (e2e, validation harnesses) locate elements by testID, role,
      // label, or placeholder and synthesize pointer events at frame centers.
      if (typeof node.props.testID === 'string') out.testID = node.props.testID;
      const role = node.props.accessibilityRole ?? node.props.role;
      if (typeof role === 'string') out.role = role;
      const label = node.props.accessibilityLabel ?? node.props['aria-label'];
      if (typeof label === 'string') out.label = label;
      if (typeof node.props.placeholder === 'string') out.placeholder = node.props.placeholder;
      return out;
    };
    return toLayoutNode(this.rootNode, 0, 0);
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
