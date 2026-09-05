import type { Node as YogaNode } from 'yoga-layout/load';
import { getEngine } from './init';
import {
  alignSelfValue,
  applyYogaStyle,
  flattenStyle,
  resolvePaintStyle,
  type FlatStyle,
  type PaintStyle,
} from './styles';
import { Align, Direction } from 'yoga-layout/load';
import {
  ClonedElementStub,
  ForeignNodeError,
  createDomFacade,
  nodeBoundingClientRect,
  nodeContains,
  type DOMRectLike,
  type DomEventListener,
  type DomFacade,
  type NodeStyle,
} from './domFacade';
import { loadImage, releaseImageEntry, retainImageEntry, type ImageEntry } from './init';
import { measureTextNode, measureInputNode, placeInlineChildren } from './text';
import { inputNodeDestroyed } from './textInputState';
import { MeasureMode, Overflow } from 'yoga-layout/load';
import type { Paragraph } from 'canvaskit-wasm';

export type CNodeType = 'root' | 'view' | 'text' | 'rawtext' | 'image' | 'scroll' | 'textinput';

export const HOST_TYPE_MAP: Record<string, CNodeType> = {
  'cn-view': 'view',
  'cn-text': 'text',
  'cn-image': 'image',
  'cn-scroll': 'scroll',
  'cn-textinput': 'textinput',
};

export interface RootHooks {
  scheduleFlush(): void;
  onActionDispatch(name: string, payload?: unknown): void;
  /** Browser roots expose their canvas so a focused TextInput can place its DOM overlay. */
  getInputHost?(): { canvas: HTMLCanvasElement | null; cssWidth: number; cssHeight: number };
}

export interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
}

function styleInset(v: unknown, size: number): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && /^-?\d*\.?\d+%$/.test(v)) return (parseFloat(v) / 100) * size;
  return undefined;
}

let nextId = 1;

export class CNode {
  readonly id = nextId++;
  readonly type: CNodeType;
  props: Record<string, unknown>;
  /** Last props handed down by React, without setNativeProps overrides. */
  rawProps: Record<string, unknown>;
  /** Direct-manipulation overrides (reanimated's web update seam). */
  nativeProps: Record<string, unknown> | null = null;
  nativeStyle: Record<string, unknown> | null = null;
  children: CNode[] = [];
  parent: CNode | null = null;
  rootHooks: RootHooks | null = null;

  yoga: YogaNode | null = null;
  flatStyle: FlatStyle = {};
  paint: PaintStyle = resolvePaintStyle({});

  /** Nearest composite React component name (Button, Feed, …), when known. */
  ownerName: string | null = null;

  /** rawtext content */
  text = '';

  /** Set post-layout each flush; relative to parent. */
  frame: Frame = { x: 0, y: 0, width: 0, height: 0 };
  lastReportedLayout: Frame | null = null;

  /** Set by the reconciler's hideInstance (Suspense/Offscreen): skip paint + hits. */
  hidden = false;

  /**
   * This node's own size as an inline view, measured unconstrained. Cached
   * because it is computed BEFORE the surface's layout pass — see
   * `measureAsInline`.
   */
  inlineMeasured: { width: number; height: number } | null = null;

  /**
   * Where the paragraph put this node's placeholder, in the text root's
   * content box. Set by the text root's syncLayout, consumed by this node's
   * own syncLayout — which otherwise reads x/y from a Yoga tree it is the ROOT
   * of, where both are always 0.
   */
  inlineOffset: { x: number; y: number } | null = null;

  /** Paragraph cache for text roots (built during measure / paint). */
  paragraph: Paragraph | null = null;
  paragraphKey = '';
  paragraphWidth = -1;

  // scroll state
  scrollX = 0;
  scrollY = 0;
  contentWidth = 0;
  contentHeight = 0;
  scrollIndicatorUntil = 0;
  /** Active momentum/bounce/scrollTo driver (engine/scrollPhysics). */
  scrollMotion: { stop(fireMomentumEnd: boolean): void; readonly phase: string } | null = null;
  /** True while a drag gesture holds this scroll view (may be rubber-banded). */
  scrollHold = false;

  // image state
  imageEntry: ImageEntry | null = null;
  imageUri: string | null = null;
  /** Asset density (RN {uri, scale} sources): intrinsic pt = px / scale. */
  imageScale = 1;

  constructor(type: CNodeType, props: Record<string, unknown>) {
    this.type = type;
    this.props = props;
    this.rawProps = props;
    if (type === 'rawtext') this.text = String(props.text ?? '');
  }

  get isTextish(): boolean {
    return this.type === 'text' || this.type === 'rawtext';
  }

  /** A text node that owns a yoga leaf + paragraph (its parent is not text). */
  get isTextRoot(): boolean {
    return this.type === 'text' && (this.parent == null || !this.parent.isTextish);
  }

  get participatesInYoga(): boolean {
    if (this.type === 'rawtext') return false;
    if (this.type === 'text') return this.isTextRoot;
    return true;
  }

  /**
   * An element child of a `<Text>` — RN's inline view.
   *
   * It has its own Yoga tree but is NOT a child of its parent's Yoga node:
   * a node with a measure function may not have children, and handing Yoga one
   * anyway reaches Emscripten's `abort()` — `RuntimeError: Aborted()`, which no
   * error boundary catches and which kills the surface. The paragraph gives it
   * a placeholder instead, and `inlineOffset` below is where that landed.
   */
  get isInlineInText(): boolean {
    return this.parent?.type === 'text' && !this.isTextish;
  }

  // -------------------------------------------------------------------------
  // Tree management (called from the reconciler host config)
  // -------------------------------------------------------------------------


  /** Re-throws style-application errors with the component identified, so an
   *  invalid style value (e.g. a web-CSS string from a mis-resolved library
   *  build) names its offender instead of an anonymous <cn-view>. */
  private applyStyles(prev: FlatStyle | null): void {
    if (!this.yoga) return;
    try {
      applyYogaStyle(this.yoga, this.flatStyle, prev);
    } catch (e) {
      const id = this.props.testID ? ` testID="${String(this.props.testID)}"` : '';
      throw new Error(`${(e as Error).message} — on <${this.type}${id}> (style: ${JSON.stringify(this.flatStyle)})`);
    }
  }

  private ensureYoga(): void {
    if (this.yoga || !this.participatesInYoga) return;
    const { yoga, yogaConfig } = getEngine();
    this.yoga = yoga.Node.create(yogaConfig);
    this.applyStyles(null);
    if (this.type === 'text') {
      this.yoga.setMeasureFunc((width, widthMode, _height, _heightMode) =>
        measureTextNode(this, width, widthMode as MeasureMode)
      );
    }
    if (this.type === 'scroll') {
      // scroll containers clip; overflow scroll lets children exceed bounds
      this.yoga.setOverflow(Overflow.Scroll);
    }
    if (this.type === 'textinput') {
      this.yoga.setMeasureFunc((width, widthMode, height, heightMode) =>
        measureInputNode(this, width, widthMode as MeasureMode, height, heightMode as MeasureMode)
      );
    }
    if (this.type === 'image') {
      // RN sizes a style-less Image to the decoded bitmap's intrinsic size.
      // Yoga only consults the measure func when the style leaves an axis open.
      this.yoga.setMeasureFunc((width, widthMode, height, heightMode) => {
        const entry = this.imageEntry;
        if (!entry || entry.status !== 'loaded') return { width: 0, height: 0 };
        const iw = entry.image.width() / this.imageScale;
        const ih = entry.image.height() / this.imageScale;
        const clamp = (v: number, mode: MeasureMode, intrinsic: number) =>
          mode === MeasureMode.Exactly ? v : mode === MeasureMode.AtMost ? Math.min(intrinsic, v) : intrinsic;
        return {
          width: clamp(width, widthMode as MeasureMode, iw),
          height: clamp(height, heightMode as MeasureMode, ih),
        };
      });
    }
  }

  private yogaChildIndex(child: CNode): number {
    let idx = 0;
    for (const c of this.children) {
      if (c === child) return idx;
      if (c.participatesInYoga && !c.isInlineInText) idx++;
    }
    return idx;
  }

  private setRootDeep(hooks: RootHooks | null): void {
    this.rootHooks = hooks;
    for (const c of this.children) c.setRootDeep(hooks);
  }

  appendChild(child: CNode): void {
    assertCNode(child, 'appendChild');
    if (child.parent) child.parent.removeChild(child);
    if (child.type === 'rawtext' && this.type !== 'text') {
      throw new Error('native-surface: text strings must be rendered within a <Text> component');
    }
    child.parent = this;
    this.children.push(child);
    child.setRootDeep(this.rootHooks);
    this.linkYoga(child);
    this.invalidateText();
    this.markDirty();
  }

  /**
   * Gives `child` its Yoga node and, unless it is an inline view inside a
   * `<Text>`, parents it under this node's. An inline view keeps a Yoga tree of
   * its OWN — see `isInlineInText` for why parenting it would abort the WASM
   * runtime rather than throw.
   */
  private linkYoga(child: CNode): void {
    if (!child.participatesInYoga) return;
    this.ensureYoga();
    child.ensureYoga();
    if (child.isInlineInText) return;
    if (this.yoga && child.yoga) this.yoga.insertChild(child.yoga, this.yogaChildIndex(child));
  }

  insertBefore(child: CNode, before: CNode): void {
    assertCNode(child, 'insertBefore');
    if (child.parent) child.parent.removeChild(child);
    if (child.type === 'rawtext' && this.type !== 'text') {
      throw new Error('native-surface: text strings must be rendered within a <Text> component');
    }
    const idx = this.children.indexOf(before);
    child.parent = this;
    this.children.splice(idx < 0 ? this.children.length : idx, 0, child);
    child.setRootDeep(this.rootHooks);
    this.linkYoga(child);
    this.invalidateText();
    this.markDirty();
  }

  removeChild(child: CNode): void {
    const idx = this.children.indexOf(child);
    if (idx < 0) return;
    const wasInline = child.isInlineInText;
    this.children.splice(idx, 1);
    // Never adopted by this node's Yoga (see linkYoga), so never detach it.
    if (this.yoga && child.yoga && !wasInline) this.yoga.removeChild(child.yoga);
    child.parent = null;
    child.setRootDeep(null);
    this.invalidateText();
    this.markDirty();
  }

  /**
   * True once this node has been deleted from the tree.
   *
   * Async work outlives the node: an image fetch settles after the row that
   * requested it has scrolled away and unmounted. Every such callback has to
   * check this, because the node it closed over is otherwise indistinguishable
   * from a live one — see `syncImage`, where adopting a late entry left a
   * permanent reference on it.
   */
  destroyed = false;

  /** Recursively free yoga nodes + paragraphs. Called on deletion. */
  destroy(): void {
    // Idempotent: the WASM handles below are freed here, and freeing one twice
    // aborts the whole runtime rather than throwing something catchable.
    if (this.destroyed) return;
    this.destroyed = true;
    for (const c of this.children) c.destroy();
    if (this.type === 'textinput') inputNodeDestroyed(this);
    releaseImageEntry(this.imageEntry);
    this.imageEntry = null;
    if (this.paragraph) {
      this.paragraph.delete();
      this.paragraph = null;
    }
    if (this.yoga) {
      this.yoga.unsetMeasureFunc?.();
      this.yoga.free();
      this.yoga = null;
    }
  }

  // -------------------------------------------------------------------------
  // Updates
  // -------------------------------------------------------------------------

  updateProps(next: Record<string, unknown>): void {
    const prevFlat = this.flatStyle;
    this.rawProps = next;
    this.props = this.nativeProps ? { ...next, ...this.nativeProps, style: next.style } : next;
    this.flatStyle = flattenStyle(next.style as never);
    if (this.nativeStyle) Object.assign(this.flatStyle, this.nativeStyle);
    this.applyStyles(prevFlat);
    this.paint = resolvePaintStyle(this.flatStyle);
    if (this.isTextish) this.invalidateText();
    if (this.type === 'image') this.syncImage();
    if (this.type === 'textinput') this.invalidateInput();
    this.markDirty();
  }

  /** Drop the cached value/placeholder paragraph (textinput nodes). */
  invalidateInput(): void {
    if (this.type !== 'textinput') return;
    if (this.paragraph) {
      this.paragraph.delete();
      this.paragraph = null;
    }
    this.paragraphKey = '';
    this.paragraphWidth = -1;
    this.yoga?.markDirty();
  }

  /**
   * RN host-instance API: apply prop/style patches directly, bypassing React.
   * Persist as overrides re-applied over subsequent React commits (reanimated's
   * web mode drives per-frame animation through this seam).
   */
  setNativeProps(patch: Record<string, unknown>): void {
    const { style, ...rest } = patch;
    if (Object.keys(rest).length) this.nativeProps = { ...this.nativeProps, ...rest };
    if (style != null) this.nativeStyle = { ...this.nativeStyle, ...flattenStyle(style as never) };
    this.updateProps(this.rawProps);
  }

  updateText(text: string): void {
    this.text = text;
    this.invalidateText();
    this.markDirty();
  }

  /** Called when this node or a descendant span changed: invalidate the owning paragraph. */
  invalidateText(): void {
    if (!this.isTextish) return;
    let n: CNode = this;
    while (n.parent && n.parent.isTextish) n = n.parent;
    if (n.type === 'text') {
      if (n.paragraph) {
        n.paragraph.delete();
        n.paragraph = null;
      }
      n.paragraphKey = '';
      n.paragraphWidth = -1;
      n.yoga?.markDirty();
    }
  }

  /**
   * Measures this inline view as its own Yoga ROOT, both axes unconstrained —
   * what an inline attachment gets on a device, where the text engine asks the
   * view for its intrinsic size.
   *
   * Run from `applyPreLayoutFixups`, i.e. BEFORE the surface's layout pass
   * begins, and deliberately not from inside the text node's Yoga measure
   * callback: Yoga keeps a global generation counter for layout caching, and
   * starting a second `calculateLayout` while the first is still running would
   * invalidate the outer pass's caches underneath it.
   */
  private measureAsInline(): void {
    if (!this.yoga) return;
    this.yoga.calculateLayout(undefined, undefined, Direction.LTR);
    const l = this.yoga.getComputedLayout();
    const width = Number.isFinite(l.width) ? l.width : 0;
    const height = Number.isFinite(l.height) ? l.height : 0;
    const prev = this.inlineMeasured;
    if (prev && prev.width === width && prev.height === height) return;
    this.inlineMeasured = { width, height };
    // A resized inline view changes the paragraph's content: the text has to
    // re-wrap around it. Nothing else notices a plain View's style change.
    this.invalidateText();
  }

  syncImage(): void {
    const source = this.props.source as { uri?: string; scale?: number } | string | undefined;
    const uri = typeof source === 'string' ? source : source?.uri;
    this.imageScale = (typeof source === 'object' && source?.scale) || 1;
    if (uri === this.imageUri) return;
    releaseImageEntry(this.imageEntry);
    this.imageEntry = null;
    this.imageUri = uri ?? null;
    if (!uri) {
      this.yoga?.markDirty();
      this.markDirty();
      return;
    }
    const acquired = loadImage(uri, (entry) => {
      // Unmounted while the bytes were in flight. Adopting the entry here
      // would RETAIN it on a node that will never release it again, and the
      // LRU refuses to evict anything still referenced — so the image becomes
      // immortal and the cache grows without bound. A feed scrolling past
      // images faster than they load leaks one per row, and CanvasKit's heap
      // ends that with an un-catchable `Aborted()`.
      if (this.destroyed) return;
      if (this.imageUri !== uri) return; // source changed while loading
      releaseImageEntry(this.imageEntry);
      this.imageEntry = entry;
      retainImageEntry(entry);
      if (entry.status === 'loaded') (this.props.onLoad as (() => void) | undefined)?.();
      if (entry.status === 'error')
        (this.props.onError as ((e: { nativeEvent: { error: string } }) => void) | undefined)?.({
          nativeEvent: { error: entry.error },
        });
      this.yoga?.markDirty(); // intrinsic size may have arrived
      this.markDirty();
    });
    this.imageEntry = acquired;
    retainImageEntry(acquired);
  }

  markDirty(): void {
    this.rootHooks?.scheduleFlush();
  }

  private wrapAspectFixApplied = false;

  /**
   * Pre-layout fixup for a yoga-layout 3.2.1 bug: inside a `flexWrap` parent,
   * a stretched child with `aspectRatio` and no explicit cross size computes a
   * 0 cross size (native defaults; on-device RN computes it from the ratio).
   * Pin such children to flex-start, which yields the on-device result.
   * REMOVE when yoga-layout ships a release newer than 3.2.1 with the fix —
   * see tests/layout.test.tsx "flexWrap with aspectRatio tiles".
   */
  applyPreLayoutFixups(): void {
    for (const c of this.children) c.applyPreLayoutFixups();
    if (this.isInlineInText) this.measureAsInline();
    if (!this.yoga || !this.parent?.yoga) return;
    const parentFlat = this.parent.flatStyle;
    const wrap = parentFlat.flexWrap;
    const dir = (parentFlat.flexDirection as string | undefined) ?? 'column';
    const crossKey = dir.startsWith('row') ? 'height' : 'width';
    const needsFix =
      wrap != null &&
      wrap !== 'nowrap' &&
      this.flatStyle.aspectRatio != null &&
      this.flatStyle[crossKey] == null &&
      this.flatStyle.alignSelf == null &&
      (parentFlat.alignItems == null || parentFlat.alignItems === 'stretch');
    if (needsFix !== this.wrapAspectFixApplied) {
      this.wrapAspectFixApplied = needsFix;
      this.yoga.setAlignSelf(needsFix ? Align.FlexStart : alignSelfValue(this.flatStyle.alignSelf));
    } else if (needsFix) {
      // style updates re-apply alignSelf; keep the fix pinned
      this.yoga.setAlignSelf(Align.FlexStart);
    }
    // Horizontal __scrollContent is an auto-width row. `flex:1` sets basis 0, so
    // children contribute 0 to that intrinsic width and Yoga stacks them at x=0.
    // A definite width is the item's main size — use it as basis so the row
    // sizes to the sum and each child advances along the main axis.
    const scrollParent = this.parent.parent?.props.__scroll as { horizontal?: boolean } | undefined;
    if (this.parent.props.__scrollContent === true && scrollParent?.horizontal) {
      const w = this.flatStyle.width;
      if (typeof w === 'number') this.yoga.setFlexBasis(w);
    }
  }

  // -------------------------------------------------------------------------
  // Post-layout
  // -------------------------------------------------------------------------

  /** Reads computed layout into `frame` recursively; fires onLayout diffs into `layoutEvents`. */
  syncLayout(layoutEvents: Array<() => void>): void {
    if (this.yoga) {
      const l = this.yoga.getComputedLayout();
      // An inline view is the ROOT of its own Yoga tree, so Yoga's x/y are
      // always 0 — the paragraph decided where it goes (see placeInlineChildren).
      const at = this.inlineOffset;
      let x = at ? at.x : l.left;
      let y = at ? at.y : l.top;
      // ponytail: `fixed` is Yoga Absolute (out of flow) with insets resolved
      // against the surface root, not the parent. Overflow-hidden ancestors
      // still clip; reparent+paint at root if a host needs true viewport stacking.
      if (!at && this.flatStyle.position === 'fixed') {
        let root: CNode = this;
        while (root.parent) root = root.parent;
        const rw = root.frame.width;
        const rh = root.frame.height;
        const left = styleInset(this.flatStyle.left, rw);
        const right = styleInset(this.flatStyle.right, rw);
        const top = styleInset(this.flatStyle.top, rh);
        const bottom = styleInset(this.flatStyle.bottom, rh);
        const origin = this.parent ? this.parent.absoluteRect() : { x: 0, y: 0 };
        if (left != null) x = left - origin.x;
        else if (right != null) x = rw - right - l.width - origin.x;
        if (top != null) y = top - origin.y;
        else if (bottom != null) y = rh - bottom - l.height - origin.y;
      }
      this.frame = { x, y, width: l.width, height: l.height };
      const onLayout = this.props.onLayout as ((e: { nativeEvent: { layout: Frame } }) => void) | undefined;
      if (onLayout) {
        const prev = this.lastReportedLayout;
        const f = this.frame;
        if (!prev || prev.x !== f.x || prev.y !== f.y || prev.width !== f.width || prev.height !== f.height) {
          this.lastReportedLayout = { ...f };
          layoutEvents.push(() => onLayout({ nativeEvent: { layout: { ...f } } }));
        }
      }
      if (this.type === 'scroll') {
        const content = this.children.find((c) => c.participatesInYoga);
        if (content?.yoga) {
          const cl = content.yoga.getComputedLayout();
          this.contentWidth = cl.width;
          this.contentHeight = cl.height;
          // clamp offsets if content shrank — but never mid-bounce/drag, when
          // offsets legitimately sit outside [0, max] (rubber-band)
          if (!this.scrollMotion && !this.scrollHold) {
            this.scrollX = Math.min(this.scrollX, Math.max(0, this.contentWidth - this.frame.width));
            this.scrollY = Math.min(this.scrollY, Math.max(0, this.contentHeight - this.frame.height));
          }
        }
      }
    }
    // Before recursing: the text root's paragraph is what positions its inline
    // children, and they read `inlineOffset` in their own syncLayout below.
    if (this.type === 'text' && this.isTextRoot) placeInlineChildren(this);
    for (const c of this.children) c.syncLayout(layoutEvents);
  }

  /**
   * Absolute rect in root CSS px, accounting for ancestor scroll offsets.
   * Transforms are ignored (approximation, same as press retention).
   */
  absoluteRect(): { x: number; y: number; w: number; h: number } {
    let x = 0;
    let y = 0;
    let n: CNode | null = this;
    while (n) {
      x += n.frame.x;
      y += n.frame.y;
      const p: CNode | null = n.parent;
      if (p && p.type === 'scroll') {
        x -= p.scrollX;
        y -= p.scrollY;
      }
      n = p;
    }
    return { x, y, w: this.frame.width, h: this.frame.height };
  }

  // RN host-instance measurement API (used by libraries via refs).
  measure(cb: (x: number, y: number, w: number, h: number, pageX: number, pageY: number) => void): void {
    queueMicrotask(() => {
      const abs = this.absoluteRect();
      cb(this.frame.x, this.frame.y, this.frame.width, this.frame.height, abs.x, abs.y);
    });
  }

  measureInWindow(cb: (x: number, y: number, w: number, h: number) => void): void {
    queueMicrotask(() => {
      const abs = this.absoluteRect();
      cb(abs.x, abs.y, abs.w, abs.h);
    });
  }

  measureLayout(
    _relativeTo: unknown,
    onSuccess: (left: number, top: number, w: number, h: number) => void,
    _onFail?: () => void
  ): void {
    queueMicrotask(() => onSuccess(this.frame.x, this.frame.y, this.frame.width, this.frame.height));
  }

  // -------------------------------------------------------------------------
  // DOM facade
  //
  // A ref handed to React IS this object (hostConfig `getPublicInstance`), so a
  // library's *web* build talks to a CNode in DOM. These members answer it.
  // The logic lives in engine/domFacade.ts — read its header for the ceiling
  // (nothing here animates) and for why the tree members are inert.
  // -------------------------------------------------------------------------

  /** CSS-animation lifecycle slots; libraries assign these directly. */
  onanimationstart: DomEventListener | null = null;
  onanimationend: DomEventListener | null = null;
  onanimationcancel: DomEventListener | null = null;

  /** Built on first DOM-ish access; most nodes never need one. */
  private dom: DomFacade | null = null;

  private get domFacade(): DomFacade {
    return (this.dom ??= createDomFacade(this));
  }

  /** Inline style, `CSSStyleDeclaration`-shaped and iterable. */
  get style(): NodeStyle {
    return this.domFacade.style;
  }

  addEventListener(type: string, listener: DomEventListener): void {
    this.domFacade.addEventListener(type, listener);
  }

  removeEventListener(type: string, listener: DomEventListener): void {
    this.domFacade.removeEventListener(type, listener);
  }

  readonly nodeType = 1; // Node.ELEMENT_NODE

  get tagName(): string {
    return this.type.toUpperCase();
  }

  get nodeName(): string {
    return this.type.toUpperCase();
  }

  /** The node's frame in page coordinates (engine/domFacade). */
  getBoundingClientRect(): DOMRectLike {
    return nodeBoundingClientRect(this);
  }

  get offsetWidth(): number {
    return this.frame.width;
  }

  get offsetHeight(): number {
    return this.frame.height;
  }

  get clientWidth(): number {
    return this.frame.width;
  }

  get clientHeight(): number {
    return this.frame.height;
  }

  /**
   * Scroll offsets, readable AND writable — reanimated saves them before its
   * exiting flow reparents things and restores them afterwards, so a read-only
   * pair would silently zero a list's position. Only a scroll node has any;
   * everything else reads 0 and ignores writes.
   *
   * A write clamps at 0 but not at the content maximum: content size may not be
   * measured yet, and `syncLayout` already clamps against it every flush.
   */
  get scrollTop(): number {
    return this.type === 'scroll' ? this.scrollY : 0;
  }

  set scrollTop(value: number) {
    if (this.type !== 'scroll') return;
    this.scrollY = Number.isFinite(value) ? Math.max(0, value) : 0;
    this.markDirty();
  }

  get scrollLeft(): number {
    return this.type === 'scroll' ? this.scrollX : 0;
  }

  set scrollLeft(value: number) {
    if (this.type !== 'scroll') return;
    this.scrollX = Number.isFinite(value) ? Math.max(0, value) : 0;
    this.markDirty();
  }

  /**
   * Always null, on purpose. reanimated's exiting path does
   * `parent = element.offsetParent; …; parent?.appendChild(dummy)`, and
   * `fixElementPosition` calls `getComputedStyle(element.parentElement)`.
   * Handing either one a CNode would push a detached clone into the live tree
   * or throw inside a browser API we do not implement; null makes both no-op.
   * The real parent is still reachable as `.parent` for engine code.
   */
  get offsetParent(): null {
    return null;
  }

  get parentElement(): null {
    return null;
  }

  /**
   * Always null — the single most dangerous member in this facade.
   *
   * reanimated's exiting flow does
   * `while (element.firstChild) { dummy.appendChild(element.firstChild) }`,
   * because on the web `appendChild` MOVES a node rather than copying it.
   * Exposing real children here would drain this node's entire live subtree
   * into a detached clone and destroy everything it renders. Reporting "no
   * children" makes that loop a no-op, which is precisely the outcome we want:
   * the clone stays empty and the real tree is never touched.
   *
   * `children` stays a real array (libraries only ever read it, and
   * `Array.from(node.children)` already works).
   */
  get firstChild(): null {
    return null;
  }

  /** `Node.contains`: this node or one of its descendants. */
  contains(other: unknown): boolean {
    return nodeContains(this, other);
  }

  /** `ChildNode.remove`. Detaches from the parent; the tree stays consistent. */
  remove(): void {
    this.parent?.removeChild(this);
  }

  /**
   * A detached, inert stub — never a CNode, never in the render tree. See
   * ClonedElementStub in engine/domFacade.ts. `deep` is accepted and ignored:
   * the stub has no children either way.
   */
  cloneNode(_deep?: boolean): ClonedElementStub {
    return new ClonedElementStub(this.tagName);
  }

  /** zIndex-sorted children for painting (stable for equal zIndex). */
  paintOrderedChildren(): CNode[] {
    const kids = this.children.filter((c) => c.participatesInYoga);
    let needsSort = false;
    for (const k of kids) {
      if (k.paint.zIndex !== 0) {
        needsSort = true;
        break;
      }
    }
    if (!needsSort) return kids;
    return kids
      .map((c, i) => [c, i] as const)
      .sort((a, b) => a[0].paint.zIndex - b[0].paint.zIndex || a[1] - b[1])
      .map(([c]) => c);
  }

  /** Resolved text content of a text subtree (for getLayoutTree / debugging). */
  textContent(): string {
    if (this.type === 'rawtext') return this.text;
    let out = '';
    for (const c of this.children) if (c.isTextish) out += c.textContent();
    return out;
  }
}

/**
 * Tree mutations only accept CNodes. A web-targeted library will hand us a
 * detached DOM-like object (reanimated's exiting flow builds one and appends
 * to whatever it thinks the parent is); pushing that into `children` corrupts
 * layout, paint and hit-testing far from the call that caused it.
 */
function assertCNode(value: CNode, method: string): void {
  if (!(value instanceof CNode)) throw new ForeignNodeError(method, value);
}
