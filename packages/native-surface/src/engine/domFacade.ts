/**
 * A DOM facade for `CNode`.
 *
 * The reconciler hands React the engine node itself (`getPublicInstance:
 * (instance) => instance`), so a ref held by a component IS a `CNode`. Any
 * library whose *web* build drives its host element then talks to us in DOM:
 * it measures with `getBoundingClientRect()`, writes inline `style`, listens
 * for `animationend`. react-native-reanimated 4's web layout-animation runtime
 * is the case that forced this file — it crashed on
 * `element.getBoundingClientRect is not a function` and again on
 * `Array.from(element.style)` — but the shape is general: most animation and
 * measuring libraries with a web target assume exactly this surface.
 *
 * WHAT THIS IS NOT. Nothing here animates. The engine paints the end state of
 * a style write immediately, so the animation members below *emulate the CSS
 * animation lifecycle without the animation*: `animationstart` fires a frame
 * after `animationName` is set, `animationend` fires once the declared
 * delay+duration has elapsed, and in between the node simply sits at its final
 * style. That is deliberate and it is the ceiling. It is enough to make
 * reanimated's layout animations *correct* — entering components get revealed
 * (reanimated hides them until `onanimationstart`), exiting components run
 * their cleanup and fire the user's `.withCallback` (only ever driven from
 * `onanimationend`) — but a caller expecting interpolated frames gets none.
 *
 * The tree members are deliberately INERT, and that is the load-bearing design
 * decision in this file rather than an omission; see each member's comment.
 *
 * Node-import-safe, like portalHost/textInputOverlay: no top-level DOM access,
 * and every DOM-touching path degrades instead of throwing when there is no
 * `document` (the engine's own test suite runs with `environment: 'node'`).
 */
import { scheduleFrame } from '../env/index';
import { canvasGeometry, canvasHostOf } from './canvasGeometry';
import type { CNode } from './node';

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** The shape of a `DOMRect`, minus the class identity nothing here needs. */
export interface DOMRectLike {
  readonly x: number;
  readonly y: number;
  readonly top: number;
  readonly left: number;
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
  toJSON(): Record<string, number>;
}

function domRect(x: number, y: number, width: number, height: number): DOMRectLike {
  const rect = {
    x,
    y,
    left: x,
    top: y,
    right: x + width,
    bottom: y + height,
    width,
    height,
    toJSON: () => ({ x, y, left: x, top: y, right: x + width, bottom: y + height, width, height }),
  };
  return rect;
}

/**
 * `getBoundingClientRect()` for a node: the node's absolute frame translated
 * onto the page through the root canvas's own box and scaled by the canvas's
 * CSS-stretch factors — the same `canvasGeometry()` the DOM portal host places
 * real elements with, so a portal and a measured node agree to the pixel.
 *
 * With no canvas or no document — Node, vitest, a headless root, a canvas that
 * is not laid out yet — it falls back to the un-offset, un-scaled
 * `absoluteRect()`. The numbers are then in layout space rather than page
 * space, which is the honest answer: they are still the node's real frame, and
 * every caller that only *compares* rects (reanimated computes deltas between
 * two snapshots) is correct either way.
 */
export function nodeBoundingClientRect(node: CNode): DOMRectLike {
  const abs = node.absoluteRect();
  if (typeof document === 'undefined') return domRect(abs.x, abs.y, abs.w, abs.h);
  const host = canvasHostOf(node);
  const geo = host ? canvasGeometry(node, host) : null;
  if (!geo) return domRect(abs.x, abs.y, abs.w, abs.h);
  return domRect(geo.left, geo.top, geo.width, geo.height);
}

/** True iff `other` is this node or one of its descendants (`Node.contains`). */
export function nodeContains(node: CNode, other: unknown): boolean {
  for (let n = other as { parent?: unknown } | null | undefined; n; n = n.parent as typeof n) {
    if (n === node) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Thrown when a tree mutation is handed something that is not a `CNode`. A
 * web-targeted library will happily pass us a detached clone (reanimated's
 * exiting flow builds one), and silently pushing it into `CNode.children`
 * corrupts layout, paint and hit-testing in ways that surface three frames
 * later as an unreadable crash. Fail at the call site instead.
 */
export class ForeignNodeError extends Error {
  constructor(method: string, value: unknown) {
    super(
      `native-surface: CNode.${method}() was given ${describeValue(value)}, not a CNode. ` +
        `A web-targeted library is treating this node as an HTMLElement — the engine's DOM ` +
        `facade (engine/domFacade.ts) answers reads, but the render tree only accepts CNodes.`
    );
    this.name = 'ForeignNodeError';
  }
}

function describeValue(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value !== 'object') return `a ${typeof value}`;
  const ctor = (value as { constructor?: { name?: string } }).constructor?.name;
  return ctor ? `a ${ctor}` : 'a plain object';
}

// ---------------------------------------------------------------------------
// style — a CSSStyleDeclaration-alike
// ---------------------------------------------------------------------------

/**
 * `CNode.style`. Property access takes camelCase or kebab-case (both normalize
 * to one internal key), and the object is iterable over the names of the
 * properties currently set — which is what a real `CSSStyleDeclaration` does,
 * and what reanimated's `Array.from(element.style)` needs to not throw.
 *
 * The string index signature is `unknown` rather than `string` so the typed
 * members below can coexist with it; reads of an arbitrary CSS property come
 * back as `unknown` and are worth a `String(...)` at the call site.
 */
export interface NodeStyle {
  /** Number of properties currently set. */
  readonly length: number;
  /** Serialized declaration (`"opacity: 0.5; animation-name: FadeIn"`). */
  cssText: string;
  setProperty(name: string, value: string | number | null): void;
  getPropertyValue(name: string): string;
  removeProperty(name: string): string;
  /** Kebab-case name at `index`, or `''` — also reachable as `style[0]`. */
  item(index: number): string;
  [Symbol.iterator](): IterableIterator<string>;
  /** Kebab-case name at that position — and what makes this `ArrayLike<string>`,
   *  so `Array.from(style)` infers `string[]` the way a real declaration does. */
  [index: number]: string;
  /** Any CSS property, camelCase or kebab-case. */
  [prop: string]: unknown;
}

/**
 * Style names recorded in the bag but never forwarded to the engine.
 *
 * These are pure CSS-animation bookkeeping: they exist so the browser's
 * animation machinery has somewhere to read its configuration from, and none
 * of them has a React Native meaning. Forwarding them would push a key into
 * the node's style on every animation step, and each write re-runs
 * `flattenStyle` → `applyYogaStyle` → `resolvePaintStyle` and schedules a
 * flush — churn and re-layout for values Yoga cannot express. `visibility` is
 * here for a different reason: the engine has no visibility concept at all
 * (nothing in paint or hit-testing reads it), so forwarding it would be pure
 * cost. Reads and iteration still see every one of them, which is what the
 * libraries writing them actually check.
 */
const ANIMATION_BOOKKEEPING = new Set([
  'animationName',
  'animationDuration',
  'animationDelay',
  'animationTimingFunction',
  'animationFillMode',
  'animationIterationCount',
  'animationDirection',
  'animationPlayState',
  'transition',
  'transitionProperty',
  'transitionDuration',
  'transitionDelay',
  'transitionTimingFunction',
  'transitionBehavior',
  'visibility',
  'willChange',
]);

/**
 * `transform` is the one property whose CSS *value grammar* the engine cannot
 * accept: RN models it as an array of single-key objects and `matrix.ts`
 * iterates it with the `in` operator, so handing it the CSS function-list
 * string a web library writes (`"translateX(4px) scale(2)"`) throws inside the
 * paint pass. Record it, never forward it. (In practice reanimated only ever
 * writes `transform = ''` on a node, which clears rather than sets.)
 *
 * The geometry names are excluded under a different, sharper rule:
 * **`getBoundingClientRect()` above answers in PAGE space, so geometry written
 * back through `style` is page space too — and this node's layout is
 * parent-relative.** A library that measures us and restores what it measured
 * is not asking to be moved; it is asking to be put back exactly where it
 * already is, and forwarding those numbers displaces it instead. The values
 * are additionally scaled by the canvas's CSS stretch, so on a stretched
 * surface they are not even the right magnitude.
 *
 * This is not hypothetical: reanimated's `setElementPosition()` writes all six
 * of them onto a real node (position/top/left/width/height/margin, from a
 * `getBoundingClientRect` snapshot) whenever an animation is a custom
 * `Keyframe` or carries `.withInitialValues` — the branch that falls through
 * to `scheduleAnimationCleanup`. Its predefined animations never take that
 * path, which is the only reason it was not visible immediately.
 *
 * The cost is stated plainly: a library cannot position or size its host
 * through this facade. That is the honest ceiling for a node whose position is
 * decided by Yoga — such a library needs `setNativeProps` with layout-space
 * values, which is the seam that exists for exactly this.
 */
const CSS_ONLY_VALUES = new Set([
  'transform',
  'position',
  'top',
  'left',
  'right',
  'bottom',
  'width',
  'height',
  'margin',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
]);

const KEBAB_SEGMENT = /-([a-z])/g;
const UPPER = /[A-Z]/g;

/** `animation-name` → `animationName`. CSS custom properties pass through. */
function camelCase(name: string): string {
  if (name.startsWith('--')) return name;
  return name.replace(KEBAB_SEGMENT, (_, c: string) => c.toUpperCase());
}

/** `animationName` → `animation-name`, the form a real declaration iterates. */
function kebabCase(name: string): string {
  if (name.startsWith('--')) return name;
  return name.replace(UPPER, (c) => `-${c.toLowerCase()}`);
}

const NUMERIC = /^-?\d*\.?\d+$/;
const PIXELS = /^(-?\d*\.?\d+)px$/;

/**
 * CSS values are strings; RN style values are mostly numbers, and the engine
 * type-guards on that (`resolvePaintStyle` ignores a non-number `opacity`
 * outright). So a write-through coerces the two forms a web library actually
 * produces — a bare number (`"0.5"`) and a pixel length (`"12px"`) — into
 * numbers, and passes everything else (percentages, `auto`, keywords, colors)
 * through as the string the engine already tolerates.
 */
function toEngineValue(value: string): string | number {
  if (NUMERIC.test(value)) return Number(value);
  const px = PIXELS.exec(value);
  if (px) return Number(px[1]);
  return value;
}

/** CSS `<time>` → ms. A comma-joined list uses its first entry. */
function parseCssTime(value: string): number {
  const first = value.split(',')[0]?.trim() ?? '';
  const match = /^(-?\d*\.?\d+)(ms|s)$/.exec(first);
  if (!match) return 0;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return 0;
  return Math.max(0, match[2] === 's' ? amount * 1000 : amount);
}

interface StyleBagHost {
  /** Forward one property to the engine. Skip-listed names never reach here. */
  writeStyle(prop: string, value: string): void;
  /** Fire a CSS-animation lifecycle event at the owning element. */
  emit(type: AnimationEventType): void;
}

/**
 * The declaration's storage and its animation-lifecycle timer. Wrapped in a
 * Proxy by `createNodeStyle` so arbitrary property and index access work;
 * every field here is a normal (not `#private`) member for that reason — a
 * Proxy cannot forward access to a true private field.
 */
class StyleBag {
  /** camelCase name → CSS value string, in insertion order. */
  readonly values = new Map<string, string>();
  readonly host: StyleBagHost;
  /** Cancels the pending `animationstart` frame, if one is scheduled. */
  cancelStart: (() => void) | null = null;
  endTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(host: StyleBagHost) {
    this.host = host;
  }

  get length(): number {
    return this.values.size;
  }

  get cssText(): string {
    const out: string[] = [];
    for (const [prop, value] of this.values) out.push(`${kebabCase(prop)}: ${value}`);
    return out.join('; ');
  }

  set cssText(text: string) {
    for (const prop of [...this.values.keys()]) this.removeProperty(prop);
    for (const decl of text.split(';')) {
      const colon = decl.indexOf(':');
      if (colon < 0) continue;
      this.setProperty(decl.slice(0, colon).trim(), decl.slice(colon + 1).trim());
    }
  }

  item(index: number): string {
    let i = 0;
    for (const prop of this.values.keys()) {
      if (i++ === index) return kebabCase(prop);
    }
    return '';
  }

  getPropertyValue(name: string): string {
    return this.values.get(camelCase(name)) ?? '';
  }

  setProperty(name: string, value: string | number | null | undefined): void {
    const prop = camelCase(name);
    const next = value == null ? '' : String(value);
    // Assigning '' removes the property, exactly as a real declaration does —
    // which is how every web library "cancels" an animation
    // (`element.style.animationName = ''`).
    if (next === '') {
      this.removeProperty(prop);
      return;
    }
    this.values.set(prop, next);
    if (prop === 'animationName') this.startAnimationCycle(next);
    if (!ANIMATION_BOOKKEEPING.has(prop) && !CSS_ONLY_VALUES.has(prop)) this.host.writeStyle(prop, next);
  }

  removeProperty(name: string): string {
    const prop = camelCase(name);
    const previous = this.values.get(prop) ?? '';
    this.values.delete(prop);
    // Clearing the name kills a running animation, which a browser reports as
    // `animationcancel` — never `animationend`. Emitting it matters rather
    // than being pedantic: a component that unmounts mid-entering while it
    // also carries `exiting` has its pending cycle cleared by
    // `handleExitingAnimation`, and the cancel event is the ONLY thing left
    // that can run the entering animation's `.withCallback`. Staying silent
    // there loses the callback with no trace.
    if (prop === 'animationName') this.cancelAnimationCycle({ emit: true });
    // Note the ceiling: removal clears the bag but cannot un-drive a property
    // already written to the engine. `setNativeProps` overrides are additive
    // (`nativeStyle` is merged, never pruned), so there is nothing to remove.
    return previous;
  }

  *[Symbol.iterator](): IterableIterator<string> {
    for (const prop of this.values.keys()) yield kebabCase(prop);
  }

  /**
   * Emulate one CSS animation run. `animationstart` lands on the next frame —
   * both because that is when a browser would start one, and because callers
   * assign `element.onanimationstart` *after* setting `animationName` and set
   * the timing properties in the same synchronous block. `animationend`
   * follows delay+duration later, read at start time so those later writes are
   * accounted for.
   */
  startAnimationCycle(name: string): void {
    this.cancelAnimationCycle();
    this.cancelStart = scheduleFrame(() => {
      this.cancelStart = null;
      if (this.values.get('animationName') !== name) return; // superseded meanwhile
      this.host.emit('animationstart');
      const total =
        parseCssTime(this.getPropertyValue('animationDelay')) +
        parseCssTime(this.getPropertyValue('animationDuration'));
      this.endTimer = setTimeout(() => {
        this.endTimer = null;
        this.host.emit('animationend');
      }, total);
    });
  }

  /**
   * Tear down a pending cycle. `emit` reports it as the browser would — but
   * only when a cycle was actually in flight, and never from
   * `startAnimationCycle`'s own reset, where the new animation supersedes the
   * old rather than cancelling it.
   */
  cancelAnimationCycle(opts: { emit?: boolean } = {}): void {
    const running = this.cancelStart !== null || this.endTimer !== null;
    this.cancelStart?.();
    this.cancelStart = null;
    if (this.endTimer !== null) {
      clearTimeout(this.endTimer);
      this.endTimer = null;
    }
    if (opts.emit && running) this.host.emit('animationcancel');
  }
}

const INDEX_KEY = /^\d+$/;

function createNodeStyle(host: StyleBagHost): NodeStyle {
  const bag = new StyleBag(host);
  const proxy = new Proxy(bag, {
    get(target, key) {
      if (typeof key === 'symbol') return Reflect.get(target, key) as unknown;
      if (INDEX_KEY.test(key)) return target.item(Number(key));
      // Declared members (methods, length, cssText) win over CSS properties;
      // no real CSS property collides with any of them.
      if (key in target) return Reflect.get(target, key) as unknown;
      return target.getPropertyValue(key);
    },
    set(target, key, value) {
      if (typeof key === 'symbol') return Reflect.set(target, key, value);
      if (key === 'cssText') {
        target.cssText = String(value);
        return true;
      }
      target.setProperty(key, value as string | number | null);
      return true;
    },
    has(target, key) {
      if (typeof key === 'symbol') return Reflect.has(target, key);
      return key in target || target.values.has(camelCase(key));
    },
    deleteProperty(target, key) {
      if (typeof key === 'string') target.removeProperty(key);
      return true;
    },
    // A real declaration enumerates as its numeric indices; mirroring that
    // keeps `Object.keys(style)` from leaking the bag's internals.
    ownKeys(target) {
      return Array.from({ length: target.values.size }, (_, i) => String(i));
    },
    getOwnPropertyDescriptor(target, key) {
      if (typeof key === 'string' && INDEX_KEY.test(key) && Number(key) < target.values.size) {
        return { value: target.item(Number(key)), writable: false, enumerable: true, configurable: true };
      }
      return undefined;
    },
  });
  return proxy as unknown as NodeStyle;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type AnimationEventType = 'animationstart' | 'animationend' | 'animationcancel';

/** The fields of an `AnimationEvent` that a listener plausibly reads. */
export interface AnimationEventLike {
  readonly type: AnimationEventType;
  readonly animationName: string;
  readonly elapsedTime: number;
  readonly pseudoElement: '';
  readonly bubbles: false;
  readonly cancelable: false;
  readonly target: object;
  readonly currentTarget: object;
}

export type DomEventListener = (event: AnimationEventLike) => void;

/**
 * The `on*` handler slots a facade owner exposes. Libraries assign these
 * directly (`element.onanimationend = …`) as often as they use
 * `addEventListener`, and reanimated does both — it drives cleanup off the
 * handler property and cancellation off a registered listener.
 */
export interface AnimationHandlerHost {
  onanimationstart: DomEventListener | null;
  onanimationend: DomEventListener | null;
  onanimationcancel: DomEventListener | null;
}

/**
 * Per-node DOM state: the style declaration and the event-listener registry.
 * Created lazily — most nodes in a tree are never touched by a web library, and
 * this is one Map and one Proxy each.
 */
export class DomFacade {
  readonly style: NodeStyle;
  private readonly owner: AnimationHandlerHost;
  private readonly listeners = new Map<string, Set<DomEventListener>>();

  constructor(owner: AnimationHandlerHost, writeStyle: (prop: string, value: string) => void) {
    this.owner = owner;
    this.style = createNodeStyle({ writeStyle, emit: (type) => this.emit(type) });
  }

  /**
   * A real registry, not a no-op: reanimated registers `animationcancel` here
   * (with a comment that `element.onanimationcancel` is unreliable on Chrome)
   * and un-registers it from `onanimationend`, so a stub would leak listeners
   * and silently drop the cancel path.
   */
  addEventListener(type: string, listener: DomEventListener): void {
    if (typeof listener !== 'function') return;
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(type: string, listener: DomEventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  /** Dispatch to the handler property first, then to registered listeners. */
  emit(type: AnimationEventType): void {
    const event: AnimationEventLike = {
      type,
      animationName: this.style.getPropertyValue('animation-name'),
      elapsedTime: 0,
      pseudoElement: '',
      bubbles: false,
      cancelable: false,
      target: this.owner,
      currentTarget: this.owner,
    };
    const handler =
      type === 'animationstart'
        ? this.owner.onanimationstart
        : type === 'animationend'
          ? this.owner.onanimationend
          : this.owner.onanimationcancel;
    handler?.call(this.owner, event);
    // Copy: a listener may remove itself (reanimated's cancel handler does).
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener.call(this.owner, event);
  }
}

// ---------------------------------------------------------------------------
// cloneNode
// ---------------------------------------------------------------------------

/**
 * What `CNode.cloneNode()` returns: a detached, inert object carrying the same
 * facade surface and nothing else. It is deliberately NOT a `CNode` and can
 * never enter the render tree.
 *
 * reanimated's exiting flow builds a "dummy clone", moves the original's
 * children into it, parents it next to the original, animates it and throws it
 * away. On a canvas none of that can happen — but every step of it must still
 * run to completion, because the tail of that flow is what fires the user's
 * exit callback. Giving it a stub lets the whole sequence execute harmlessly:
 * the appends land nowhere, the geometry reads back zeros, and the stub's own
 * animation cycle drives `onanimationend`, which is where the cleanup lives.
 */
export class ClonedElementStub implements AnimationHandlerHost {
  onanimationstart: DomEventListener | null = null;
  onanimationend: DomEventListener | null = null;
  onanimationcancel: DomEventListener | null = null;

  readonly nodeType = 1;
  readonly tagName: string;
  readonly nodeName: string;
  /** Always empty; `appendChild` below is a no-op, so nothing can arrive. */
  readonly children: readonly never[] = [];
  readonly firstChild = null;
  readonly parentElement = null;
  readonly offsetParent = null;
  readonly offsetWidth = 0;
  readonly offsetHeight = 0;
  readonly clientWidth = 0;
  readonly clientHeight = 0;
  /** Writable: the exiting flow saves and restores scroll positions on it. */
  scrollTop = 0;
  scrollLeft = 0;

  private readonly facade: DomFacade;

  constructor(tagName: string) {
    this.tagName = tagName;
    this.nodeName = tagName;
    // Write-through drops everything: a stub has no node to drive.
    this.facade = new DomFacade(this, () => {});
  }

  get style(): NodeStyle {
    return this.facade.style;
  }

  addEventListener(type: string, listener: DomEventListener): void {
    this.facade.addEventListener(type, listener);
  }

  removeEventListener(type: string, listener: DomEventListener): void {
    this.facade.removeEventListener(type, listener);
  }

  getBoundingClientRect(): DOMRectLike {
    return domRect(0, 0, 0, 0);
  }

  appendChild<T>(child: T): T {
    return child;
  }

  insertBefore<T>(child: T): T {
    return child;
  }

  removeChild<T>(child: T): T {
    return child;
  }

  remove(): void {}

  contains(): boolean {
    return false;
  }

  cloneNode(): ClonedElementStub {
    return new ClonedElementStub(this.tagName);
  }

  /**
   * Present so reanimated's `_updatePropsJS` takes its `setNativeProps` branch
   * on a stub. The alternative branches read `component.props`, which a stub
   * does not have, and would throw.
   */
  setNativeProps(): void {}
}

/** Facade construction for `CNode`; keeps the wiring out of node.ts. */
export function createDomFacade(node: CNode & AnimationHandlerHost): DomFacade {
  return new DomFacade(node, (prop, value) => {
    node.setNativeProps({ style: { [prop]: toEngineValue(value) } });
  });
}
