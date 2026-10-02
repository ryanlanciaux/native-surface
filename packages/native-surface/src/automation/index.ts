/** Optional automation entry. The normal package entry never imports this. */
import type { NativeRoot, PointerEventType, SyntheticPointer } from '../types';
import type { RootImpl } from '../engine/renderer';
import { now } from '../env/index';
import { getEngine } from '../engine/init';
import { getFocusedInputElement, getFocusedInputNode, hasDomOverlay } from '../engine/textInputState';
import { portalElementsOf } from '../engine/portalHost';
import { buildSnapshot } from './snapshot';
import { hitTestPath } from '../engine/events';
import { keyInto, typeInto } from './input';
import type { AutomationOptions, DragOptions, KeyOptions, Observation, ObserveOptions, OverlayInfo,
  Point, Screenshot, ScreenshotOptions, Snapshot, StableOptions, Viewport, WaitOptions } from './types';
export type * from './types';

export class AutomationTimeoutError extends Error {
  override name = 'AutomationTimeoutError';
}
export class AutomationDisposedError extends Error {
  override name = 'AutomationDisposedError';
  constructor() { super('native-surface: automation controller or surface was disposed'); }
}
export class DisplayCaptureRequiredError extends Error {
  override name = 'DisplayCaptureRequiredError';
  constructor() { super('native-surface: DOM overlays require format: display and a captureDisplay browser bridge'); }
}
export class StaleCaptureError extends Error {
  override name = 'StaleCaptureError';
  constructor() { super('native-surface: surface changed during browser capture; observe again'); }
}

const finite = (value: number, name: string) => {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
};
const point = (p: Point) => { finite(p.x, 'x'); finite(p.y, 'y'); };
const frame = (cb: () => void): (() => void) => {
  if (typeof requestAnimationFrame === 'function') {
    const id = requestAnimationFrame(cb); return () => cancelAnimationFrame(id);
  }
  const id = setTimeout(cb, 1000 / 60); return () => clearTimeout(id);
};

export class AutomationController {
  private readonly root: RootImpl;
  private detach: () => void;
  private disposed = false;
  private revisionValue = 0;
  private paintedAt = now();
  private cached: Snapshot | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly cancellations = new Set<(reason: unknown) => void>();
  private buffer: HTMLCanvasElement | OffscreenCanvas | null = null;
  private bufferContext: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
  private captureError: unknown = null;
  private pointerHeld = false;

  constructor(root: NativeRoot, private readonly options: AutomationOptions = {}) {
    this.root = root as RootImpl;
    if (typeof this.root.subscribeFrames !== 'function') throw new TypeError('native-surface: incompatible root');
    this.detach = this.root.subscribeFrames(event => {
      if (event === 'destroy') { this.dispose(); return; }
      this.revisionValue++;
      this.paintedAt = now();
      this.cached = null;
      if (this.buffer) {
        try { this.copyCanvas(); } catch (error) { this.captureError = error; }
      }
      this.listeners.forEach(listener => listener());
    });
  }
  private assertActive(): void { if (this.disposed) throw new AutomationDisposedError(); }
  get revision(): number { this.assertActive(); return this.revisionValue; }
  get viewport(): Viewport {
    this.assertActive();
    const r = this.root;
    return { x: 0, y: 0, width: r.cssWidth, height: r.cssHeight, scale: r.dpr,
      pixelWidth: Math.max(1, Math.round(r.cssWidth * r.dpr)), pixelHeight: Math.max(1, Math.round(r.cssHeight * r.dpr)) };
  }
  private focusedInput() {
    const node = getFocusedInputNode();
    return node?.rootHooks === this.root ? node : null;
  }
  /** The focused DOM input owned by this surface, for host keyboard tooling.
   * Null in browserless hosts or when another surface owns the focus. */
  inputElement(): HTMLInputElement | HTMLTextAreaElement | null {
    this.assertActive();
    return this.focusedInput() ? getFocusedInputElement() : null;
  }
  /** IDs on the normal topmost pointer hit path, in surface logical pixels. */
  hitTest(p: Point): readonly number[] {
    this.assertActive(); point(p); this.root.flushPending();
    return hitTestPath(this.root.rootNode, p.x, p.y);
  }
  private overlays(): OverlayInfo[] {
    const out: OverlayInfo[] = portalElementsOf(this.root.rootNode).map(({ node }) => ({ id: node.id, kind: 'portal' }));
    const focused = this.focusedInput();
    if (focused && hasDomOverlay(focused)) out.push({ id: focused.id, kind: 'input' });
    return out;
  }
  private async prepare(): Promise<void> {
    this.assertActive();
    await this.root.whenReady();
    this.assertActive();
    this.root.flushPending();
  }
  /** Synchronous, immutable, revision-cached snapshot. Await root.whenReady first. */
  snapshot(): Snapshot {
    this.assertActive();
    this.root.flushPending();
    return this.snapshotCurrent();
  }
  private snapshotCurrent(): Snapshot {
    return this.cached ??= buildSnapshot(this.root.rootNode, this.viewport, this.revisionValue, this.paintedAt, this.focusedInput()?.id ?? null);
  }
  async observe(options: ObserveOptions = {}): Promise<Observation> {
    await this.prepare();
    // Capture initialization is synchronous until its first await. A WebGL
    // warm-up may paint, so obtain the matching structure/metadata afterwards.
    const pending = options.screenshot ? this.capturePrepared(options.screenshot === true ? {} : options.screenshot) : null;
    const snapshot = options.snapshot ? this.snapshotCurrent() : null;
    const observation: Observation = { viewport: this.viewport, revision: this.revisionValue, timestamp: this.paintedAt,
      focusedNode: this.focusedInput()?.id ?? null, overlays: this.overlays(),
      ...(snapshot ? { nodes: snapshot.nodes, scrollRegions: snapshot.scrollRegions } : {}) };
    if (pending) {
      const screenshot = await pending;
      if (screenshot.revision !== observation.revision) {
        if (screenshot.format === 'bitmap') screenshot.data.close();
        throw new StaleCaptureError();
      }
      observation.screenshot = screenshot;
    }
    return observation;
  }
  async screenshot(options: ScreenshotOptions = {}): Promise<Screenshot> {
    await this.prepare();
    return this.capturePrepared(options);
  }
  private copyCanvas(): void {
    const source = this.root.canvas!;
    const buffer = this.buffer!;
    if (buffer.width !== source.width) buffer.width = source.width;
    if (buffer.height !== source.height) buffer.height = source.height;
    const ctx = this.bufferContext!;
    ctx.clearRect(0, 0, buffer.width, buffer.height);
    ctx.drawImage(source, 0, 0);
    this.captureError = null;
  }
  private ensureBuffer(): HTMLCanvasElement | OffscreenCanvas {
    if (!this.root.canvas) throw new Error('native-surface: headless capture supports pixels and blob');
    if (!this.buffer) {
      this.buffer = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
      this.bufferContext = this.buffer.getContext('2d') as typeof this.bufferContext;
      if (!this.bufferContext) { this.buffer = null; throw new Error('native-surface: 2D capture context unavailable'); }
      this.root.captureFrame(() => this.copyCanvas());
    }
    if (this.captureError) throw this.captureError;
    return this.buffer;
  }
  private async capturePrepared(options: ScreenshotOptions): Promise<Screenshot> {
    const format = options.format ?? 'bitmap';
    const overlays = this.overlays();
    if (format !== 'display' && overlays.length) throw new DisplayCaptureRequiredError();
    if (format === 'display') {
      if (!this.options.captureDisplay) throw new DisplayCaptureRequiredError();
      const revision = this.revisionValue, timestamp = this.paintedAt, viewport = this.viewport;
      const capture = await this.options.captureDisplay({ root: this.root, revision, viewport, overlays });
      this.assertActive();
      if (revision !== this.revisionValue || this.root.hasPendingFrame) throw new StaleCaptureError();
      if (!Number.isInteger(capture.width) || capture.width < 1 || !Number.isInteger(capture.height) || capture.height < 1) {
        throw new RangeError('native-surface: browser capture must report actual image dimensions');
      }
      return { format, ...capture, revision, timestamp, viewport, scope: 'display' };
    }
    const buffer = this.root.canvas ? this.ensureBuffer() : null;
    const viewport = this.viewport;
    const metadata = { revision: this.revisionValue, timestamp: this.paintedAt, viewport, scope: 'surface' as const,
      width: viewport.pixelWidth, height: viewport.pixelHeight };
    if (format === 'canvas') {
      if (!buffer) throw new Error('native-surface: canvas capture requires a browser');
      return { ...metadata, format, data: buffer };
    }
    if (format === 'bitmap') {
      if (!buffer || typeof createImageBitmap !== 'function') throw new Error('native-surface: ImageBitmap unavailable; request pixels or blob');
      const data = await createImageBitmap(buffer);
      if (this.disposed) { data.close(); this.assertActive(); }
      return { ...metadata, format, data };
    }
    if (format === 'pixels') {
      const { pixelWidth: width, pixelHeight: height } = metadata.viewport;
      if (buffer) return { ...metadata, format, width, height, data: this.bufferContext!.getImageData(0, 0, width, height).data };
      const image = this.root.captureImage();
      try {
        const { ck } = getEngine();
        const data = image.readPixels(0, 0, { width, height, colorType: ck.ColorType.RGBA_8888,
          alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB }) as Uint8Array | null;
        if (!data) throw new Error('native-surface: pixel capture failed');
        return { ...metadata, format, width, height, data: new Uint8ClampedArray(data) };
      } finally { image.delete(); }
    }
    if (format !== 'blob') throw new RangeError(`native-surface: unknown screenshot format ${format}`);
    let data: Blob;
    if (buffer) {
      data = 'convertToBlob' in buffer ? await buffer.convertToBlob({ type: 'image/png' })
        : await new Promise<Blob>((resolve, reject) => buffer.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG capture failed')), 'image/png'));
    } else {
      const image = this.root.captureImage();
      try {
        const bytes = image.encodeToBytes();
        if (!bytes) throw new Error('native-surface: PNG capture failed');
        data = new Blob([new Uint8Array(bytes)], { type: 'image/png' });
      } finally { image.delete(); }
    }
    this.assertActive();
    return { ...metadata, format, data };
  }
  /** Stop maintaining the browser capture buffer until the next screenshot. */
  releaseCapture(): void {
    if (this.buffer) { this.buffer.width = 1; this.buffer.height = 1; }
    this.buffer = null; this.bufferContext = null; this.captureError = null;
  }
  private dispatch(type: PointerEventType, p: SyntheticPointer): void {
    this.assertActive(); point(p);
    // Only a new hit test needs fresh layout. A captured gesture uses its
    // existing path, just like browser pointermove/up; repainting every sample
    // defeats frame coalescing and changes gesture timing.
    if (type === 'down' || type === 'wheel') {
      this.root.flushPending();
      const v = this.viewport;
      if (p.x < 0 || p.y < 0 || p.x > v.width || p.y > v.height) throw new RangeError('input must start inside the surface');
      // DOM overlays can intercept a real pointer before it reaches the canvas.
      // Never silently click through one into a canvas control underneath it.
      const portals = portalElementsOf(this.root.rootNode);
      const input = this.focusedInput() ? getFocusedInputElement() : null;
      if (this.root.canvas && (portals.length || input)) {
        const client = this.toClientPoint(p);
        const hit = this.root.canvas.ownerDocument.elementFromPoint(client.x, client.y);
        if (hit && (hit === input || portals.some(({ element }) => element.contains(hit)))) {
          throw new Error('native-surface: DOM overlay intercepts this coordinate; use browser pointer input');
        }
      }
    }
    if (type === 'down') {
      if (this.pointerHeld) throw new Error('native-surface: a pointer gesture is already active');
      this.pointerHeld = true;
    }
    try { this.root.dispatchPointerEvent(type, p); }
    catch (error) {
      if (type === 'down') {
        this.pointerHeld = false;
        try { this.root.dispatchPointerEvent('cancel', p); } catch { /* preserve original callback error */ }
      }
      throw error;
    }
    finally { if (type === 'up' || type === 'cancel') this.pointerHeld = false; }
  }
  pointerDown(p: Point): void { this.dispatch('down', p); }
  pointerMove(p: Point): void { this.dispatch('move', p); }
  pointerUp(p: Point): void { this.dispatch('up', p); }
  pointerCancel(): void { this.dispatch('cancel', { x: 0, y: 0 }); }
  tap(p: Point): void {
    this.pointerDown(p);
    try { this.pointerUp(p); } finally { if (this.pointerHeld) this.pointerCancel(); }
  }
  scroll(p: Point & { deltaX?: number; deltaY: number }): void {
    finite(p.deltaX ?? 0, 'deltaX'); finite(p.deltaY, 'deltaY');
    this.dispatch('wheel', p);
  }
  async drag(options: DragOptions): Promise<void> {
    const { from, to, duration = 200, steps = Math.max(1, Math.ceil(duration / 16)), signal } = options;
    point(from); point(to); finite(duration, 'duration');
    if (duration < 0 || !Number.isInteger(steps) || steps < 1 || steps > 10000) throw new RangeError('invalid drag duration/steps');
    if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
    this.pointerDown(from);
    const started = now();
    try {
      for (let i = 1; i <= steps; i++) {
        const delay = started + duration * i / steps - now();
        if (delay > 0) await this.wait({ signal, timeout: delay + 1000 }, resolve => {
          const timer = setTimeout(() => resolve(this.revisionValue), delay);
          return () => clearTimeout(timer);
        }, 'drag');
        this.assertActive();
        if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
        this.pointerMove({ x: from.x + (to.x - from.x) * i / steps, y: from.y + (to.y - from.y) * i / steps });
      }
      this.pointerUp(to);
    } finally { if (!this.disposed && this.pointerHeld) this.pointerCancel(); }
  }
  type(text: string): void {
    this.assertActive(); const node = this.focusedInput();
    if (!node) throw new Error('native-surface: no focused input in this surface');
    typeInto(node, text);
  }
  key(key: string, options?: KeyOptions): void {
    this.assertActive(); const node = this.focusedInput();
    if (!node) throw new Error('native-surface: no focused input in this surface; use browser keyboard input');
    keyInto(node, key, options);
  }
  normalizePoint(p: Point): Point {
    point(p); const v = this.viewport;
    if (v.width <= 0 || v.height <= 0) throw new RangeError('surface has no area');
    return { x: p.x / v.width, y: p.y / v.height };
  }
  denormalizePoint(p: Point): Point { point(p); const v = this.viewport; return { x: p.x * v.width, y: p.y * v.height }; }
  toClientPoint(p: Point): Point {
    this.assertActive(); point(p);
    const r = this.root.canvas?.getBoundingClientRect();
    if (!r || !r.width || !r.height || !this.root.cssWidth || !this.root.cssHeight) throw new Error('native-surface: canvas has no displayed rectangle');
    return { x: r.left + p.x * r.width / this.root.cssWidth, y: r.top + p.y * r.height / this.root.cssHeight };
  }
  fromClientPoint(p: Point): Point {
    this.assertActive(); point(p); const r = this.root.canvas?.getBoundingClientRect();
    if (!r || !r.width || !r.height) throw new Error('native-surface: canvas has no displayed rectangle');
    return { x: (p.x - r.left) * this.root.cssWidth / r.width, y: (p.y - r.top) * this.root.cssHeight / r.height };
  }
  private wait(options: WaitOptions, setup: (resolve: (revision: number) => void) => () => void, operation: string): Promise<number> {
    this.assertActive();
    const timeout = options.timeout ?? 1000;
    finite(timeout, 'timeout'); if (timeout < 0) throw new RangeError('timeout must be nonnegative');
    return new Promise((resolve, reject) => {
      let cleanup = () => {}, settled = false;
      const finish = (error: unknown, revision?: number) => {
        if (settled) return;
        settled = true; clearTimeout(timer); cleanup();
        options.signal?.removeEventListener('abort', abort);
        this.cancellations.delete(cancel);
        if (revision !== undefined) resolve(revision); else reject(error);
      };
      const cancel = (reason: unknown) => finish(reason);
      const abort = () => cancel(options.signal?.reason ?? new DOMException('Aborted', 'AbortError'));
      const timer = setTimeout(() => cancel(new AutomationTimeoutError(`native-surface: ${operation} timed out after ${timeout}ms`)), timeout);
      this.cancellations.add(cancel);
      options.signal?.addEventListener('abort', abort, { once: true });
      if (options.signal?.aborted) { abort(); return; }
      try {
        cleanup = setup(revision => finish(null, revision));
        if (settled) cleanup();
      } catch (error) { finish(error); }
    });
  }
  waitForChange(previousRevision: number, options: WaitOptions = {}): Promise<number> {
    this.assertActive();
    if (!Number.isInteger(previousRevision) || previousRevision < 0 || previousRevision > this.revisionValue) {
      throw new RangeError('previousRevision must belong to this controller epoch');
    }
    if (options.signal?.aborted) return Promise.reject(options.signal.reason ?? new DOMException('Aborted', 'AbortError'));
    if (this.revisionValue > previousRevision) return Promise.resolve(this.revisionValue);
    return this.wait(options, resolve => {
      const check = () => { if (this.revisionValue > previousRevision) resolve(this.revisionValue); };
      this.listeners.add(check); check(); return () => this.listeners.delete(check);
    }, 'waitForChange');
  }
  waitForStable(options: StableOptions = {}): Promise<number> {
    const frames = options.frames ?? 2;
    if (!Number.isInteger(frames) || frames < 1) throw new RangeError('frames must be a positive integer');
    return this.wait(options, resolve => {
      let last = this.revisionValue, quiet = 0, cancel = () => {};
      const sample = () => {
        if (last === this.revisionValue && !this.root.hasPendingFrame) quiet++; else quiet = 0;
        last = this.revisionValue;
        if (quiet >= frames) resolve(last); else cancel = frame(sample);
      };
      cancel = frame(sample); return () => cancel();
    }, 'waitForStable');
  }
  dispose(): void {
    if (this.disposed) return;
    // Own synthetic gestures are cancelled through the normal pipeline.
    if (this.pointerHeld) this.root.dispatchPointerEvent('cancel', { x: 0, y: 0 });
    this.pointerHeld = false;
    this.disposed = true; this.detach();
    for (const cancel of this.cancellations) cancel(new AutomationDisposedError());
    this.listeners.clear(); this.cached = null; this.releaseCapture();
  }
}

export function createAutomationController(root: NativeRoot, options?: AutomationOptions): AutomationController {
  return new AutomationController(root, options);
}
