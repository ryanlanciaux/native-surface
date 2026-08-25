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
import { Align } from 'yoga-layout/load';
import { loadImage, releaseImageEntry, retainImageEntry, type ImageEntry } from './init';
import { measureTextNode, measureInputNode } from './text';
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

  /** rawtext content */
  text = '';

  /** Set post-layout each flush; relative to parent. */
  frame: Frame = { x: 0, y: 0, width: 0, height: 0 };
  lastReportedLayout: Frame | null = null;

  /** Set by the reconciler's hideInstance (Suspense/Offscreen): skip paint + hits. */
  hidden = false;

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
      if (c.participatesInYoga) idx++;
    }
    return idx;
  }

  private setRootDeep(hooks: RootHooks | null): void {
    this.rootHooks = hooks;
    for (const c of this.children) c.setRootDeep(hooks);
  }

  appendChild(child: CNode): void {
    if (child.parent) child.parent.removeChild(child);
    if (child.type === 'rawtext' && this.type !== 'text') {
      throw new Error('native-surface: text strings must be rendered within a <Text> component');
    }
    child.parent = this;
    this.children.push(child);
    child.setRootDeep(this.rootHooks);
    if (child.participatesInYoga) {
      this.ensureYoga();
      child.ensureYoga();
      if (this.yoga && child.yoga) this.yoga.insertChild(child.yoga, this.yogaChildIndex(child));
    }
    this.invalidateText();
    this.markDirty();
  }

  insertBefore(child: CNode, before: CNode): void {
    if (child.parent) child.parent.removeChild(child);
    if (child.type === 'rawtext' && this.type !== 'text') {
      throw new Error('native-surface: text strings must be rendered within a <Text> component');
    }
    const idx = this.children.indexOf(before);
    child.parent = this;
    this.children.splice(idx < 0 ? this.children.length : idx, 0, child);
    child.setRootDeep(this.rootHooks);
    if (child.participatesInYoga) {
      this.ensureYoga();
      child.ensureYoga();
      if (this.yoga && child.yoga) this.yoga.insertChild(child.yoga, this.yogaChildIndex(child));
    }
    this.invalidateText();
    this.markDirty();
  }

  removeChild(child: CNode): void {
    const idx = this.children.indexOf(child);
    if (idx < 0) return;
    this.children.splice(idx, 1);
    if (this.yoga && child.yoga) this.yoga.removeChild(child.yoga);
    child.parent = null;
    child.setRootDeep(null);
    this.invalidateText();
    this.markDirty();
  }

  /** Recursively free yoga nodes + paragraphs. Called on deletion. */
  destroy(): void {
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
  }

  // -------------------------------------------------------------------------
  // Post-layout
  // -------------------------------------------------------------------------

  /** Reads computed layout into `frame` recursively; fires onLayout diffs into `layoutEvents`. */
  syncLayout(layoutEvents: Array<() => void>): void {
    if (this.yoga) {
      const l = this.yoga.getComputedLayout();
      this.frame = { x: l.left, y: l.top, width: l.width, height: l.height };
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
