/**
 * The DOM facade on CNode (engine/domFacade). Runs in the suite's default
 * `environment: 'node'` — deliberately, since "safe with no document" is one of
 * the guarantees under test: every geometry read below happens with no DOM at
 * all and still returns the node's real frame.
 */
import { describe, expect, it } from 'vitest';
import React from 'react';
import { ScrollView, View } from '../src/index';
import { CNode } from '../src/engine/node';
import { ForeignNodeError, type DOMRectLike, type DomEventListener, type NodeStyle } from '../src/engine/domFacade';
import { createTestRoot, sleep } from './helpers';

/** Nearest scroll ancestor — how a test reaches the ScrollView's own CNode
 *  (the component's ref is a ScrollViewHandle, not the host node). */
function scrollAncestor(node: CNode): CNode {
  for (let n: CNode | null = node; n; n = n.parent) if (n.type === 'scroll') return n;
  throw new Error('no scroll ancestor');
}

describe('CNode DOM facade — geometry', () => {
  it('getBoundingClientRect returns the node frame, nested and inside a scrolled ScrollView', async () => {
    const root = createTestRoot(300, 400);
    let plain: CNode | null = null;
    let inner: CNode | null = null;

    root.render(
      <View style={{ padding: 20 }}>
        <View
          ref={(n) => {
            plain = n as CNode | null;
          }}
          style={{ marginTop: 10, width: 100, height: 50 }}
        />
        <ScrollView style={{ height: 120 }}>
          <View style={{ height: 400 }}>
            <View
              ref={(n) => {
                inner = n as CNode | null;
              }}
              style={{ marginTop: 60, width: 80, height: 40 }}
            />
          </View>
        </ScrollView>
      </View>
    );
    await root.flush();

    // No document at all: the fallback path is what produced these numbers.
    expect(typeof document).toBe('undefined');

    const flat = plain!.getBoundingClientRect();
    expect({ x: flat.x, y: flat.y, width: flat.width, height: flat.height }).toEqual({
      x: 20,
      y: 30,
      width: 100,
      height: 50,
    });
    expect(flat.left).toBe(flat.x);
    expect(flat.top).toBe(flat.y);
    expect(flat.right).toBe(120);
    expect(flat.bottom).toBe(80);
    expect(flat.toJSON()).toEqual({ x: 20, y: 30, left: 20, top: 30, right: 120, bottom: 80, width: 100, height: 50 });

    // Deep inside the ScrollView: ancestor frames accumulate.
    const before = inner!.getBoundingClientRect();
    expect({ x: before.x, y: before.y, width: before.width, height: before.height }).toEqual({
      x: 20,
      y: 140,
      width: 80,
      height: 40,
    });

    // ...and the scroll offset comes off the top, exactly as absoluteRect does.
    const scroll = scrollAncestor(inner!);
    scroll.scrollTop = 45;
    await root.flush();
    const after = inner!.getBoundingClientRect();
    expect(after.y).toBe(95);
    expect(after.x).toBe(20);

    root.unmount();
  });

  it('reports offsetWidth/clientHeight from the frame and maps scrollTop/scrollLeft to the scroll offsets', async () => {
    const root = createTestRoot(300, 400);
    let inner: CNode | null = null;
    root.render(
      <ScrollView style={{ height: 120 }}>
        <View style={{ height: 500 }}>
          <View
            ref={(n) => {
              inner = n as CNode | null;
            }}
            style={{ width: 90, height: 30 }}
          />
        </View>
      </ScrollView>
    );
    await root.flush();

    expect(inner!.offsetWidth).toBe(90);
    expect(inner!.offsetHeight).toBe(30);
    expect(inner!.clientWidth).toBe(90);
    expect(inner!.clientHeight).toBe(30);

    // A non-scroll node has no offsets, and writes to it are ignored.
    expect(inner!.scrollTop).toBe(0);
    inner!.scrollTop = 33;
    inner!.scrollLeft = 33;
    expect(inner!.scrollTop).toBe(0);
    expect(inner!.scrollLeft).toBe(0);

    const scroll = scrollAncestor(inner!);
    expect(scroll.scrollTop).toBe(0);
    scroll.scrollTop = 60;
    expect(scroll.scrollTop).toBe(60);
    expect(scroll.scrollY).toBe(60);
    scroll.scrollLeft = 12;
    expect(scroll.scrollLeft).toBe(12);
    expect(scroll.scrollX).toBe(12);
    scroll.scrollTop = -5; // clamped at 0
    expect(scroll.scrollTop).toBe(0);

    root.unmount();
  });
});

describe('CNode DOM facade — style', () => {
  it('writes through to the engine, coercing CSS values, and skips animation bookkeeping', async () => {
    const root = createTestRoot(200, 200);
    let ref: CNode | null = null;
    root.render(
      <View
        ref={(n) => {
          ref = n as CNode | null;
        }}
        style={{ width: 40, height: 40, backgroundColor: '#ff0000' }}
      />
    );
    await root.flush();

    // Bare number → number, which is the only form resolvePaintStyle accepts.
    ref!.style.opacity = '0.5';
    await root.flush();
    expect(ref!.flatStyle.opacity).toBe(0.5);
    expect(ref!.paint.opacity).toBe(0.5);

    // Pixel length → number for a property that IS forwarded.
    ref!.style.borderRadius = '12px';
    await root.flush();
    expect(ref!.flatStyle.borderRadius).toBe(12);

    // Non-numeric values pass through untouched.
    ref!.style.setProperty('background-color', '#00ff00');
    await root.flush();
    expect(ref!.flatStyle.backgroundColor).toBe('#00ff00');

    // Animation bookkeeping is recorded but never reaches the engine.
    ref!.style.animationName = 'REA-ENTERING-FadeIn';
    ref!.style.animationDuration = '0.3s';
    ref!.style.visibility = 'hidden';
    ref!.style.willChange = 'transform';
    await root.flush();
    expect(ref!.flatStyle.animationName).toBeUndefined();
    expect(ref!.flatStyle.animationDuration).toBeUndefined();
    expect(ref!.flatStyle.visibility).toBeUndefined();
    expect(ref!.flatStyle.willChange).toBeUndefined();
    expect(String(ref!.style.animationName)).toBe('REA-ENTERING-FadeIn');
    expect(String(ref!.style.visibility)).toBe('hidden');

    ref!.style.animationName = ''; // stop the emulated cycle before teardown
    root.unmount();
  });

  /**
   * getBoundingClientRect() answers in PAGE space, so geometry written back
   * through `style` is page space too — while this node's layout is
   * parent-relative and may be canvas-stretched on top. A library restoring a
   * rect it measured is asking to stay put, and forwarding those numbers moves
   * it instead. reanimated's setElementPosition() writes exactly this set onto
   * a real node for custom Keyframes.
   */
  it('records geometry writes but never forwards them to layout', async () => {
    const root = createTestRoot(200, 200);
    let ref: CNode | null = null;
    root.render(
      <View
        ref={(n) => {
          ref = n as CNode | null;
        }}
        style={{ width: 40, height: 40 }}
      />
    );
    await root.flush();

    const s = ref!.style;
    s.position = 'absolute';
    s.top = '317px';
    s.left = '208px';
    s.width = '120px';
    s.height = '64px';
    s.margin = '0px';
    await root.flush();

    // The node has not moved or resized.
    expect(ref!.frame).toMatchObject({ x: 0, y: 0, width: 40, height: 40 });
    // Names the node never had stay absent...
    for (const key of ['position', 'top', 'left', 'margin'] as const) {
      expect(ref!.flatStyle[key], `${key} must not reach the engine`).toBeUndefined();
    }
    // ...and names it DID have keep the value React gave them, rather than
    // being overwritten by the page-space numbers just written.
    expect(ref!.flatStyle.width).toBe(40);
    expect(ref!.flatStyle.height).toBe(40);
    // ...but the declaration still reports them, which is what a library that
    // writes then reads back is checking.
    expect(String(s.top)).toBe('317px');
    expect(String(s.position)).toBe('absolute');
    expect(Array.from(s)).toContain('top');

    root.unmount();
  });

  it('is iterable and supports setProperty/getPropertyValue/removeProperty/length/index/cssText', async () => {
    const root = createTestRoot(200, 200);
    let ref: CNode | null = null;
    root.render(
      <View
        ref={(n) => {
          ref = n as CNode | null;
        }}
        style={{ width: 20, height: 20 }}
      />
    );
    await root.flush();

    const style = ref!.style;
    style.setProperty('background-color', '#123456');
    style.opacity = '0.25';

    // Iteration yields the CSS names of what is set — this is the read that
    // crashed reanimated (`Array.from(element.style)`).
    expect(Array.from(style)).toEqual(['background-color', 'opacity']);
    expect(style.length).toBe(2);
    expect(style.item(0)).toBe('background-color');
    expect(style.item(1)).toBe('opacity');
    expect(style.item(9)).toBe('');
    expect(style[0]).toBe('background-color');

    // Either spelling reaches the same property.
    expect(style.getPropertyValue('background-color')).toBe('#123456');
    expect(style.getPropertyValue('backgroundColor')).toBe('#123456');
    expect(String(style.backgroundColor)).toBe('#123456');
    expect(style.getPropertyValue('not-set')).toBe('');

    expect(style.cssText).toBe('background-color: #123456; opacity: 0.25');

    expect(style.removeProperty('opacity')).toBe('0.25');
    expect(style.length).toBe(1);
    expect(Array.from(style)).toEqual(['background-color']);

    // Assigning '' removes, as a real declaration does.
    style.backgroundColor = '';
    expect(style.length).toBe(0);
    expect(Array.from(style)).toEqual([]);

    style.cssText = 'opacity: 0.75; border-top-width: 2px';
    expect(Array.from(style)).toEqual(['opacity', 'border-top-width']);
    await root.flush();
    expect(ref!.flatStyle.opacity).toBe(0.75);
    expect(ref!.flatStyle.borderTopWidth).toBe(2);

    root.unmount();
  });
});

describe('CNode DOM facade — CSS animation lifecycle', () => {
  it('fires animationstart then animationend to handler properties and listeners', async () => {
    const root = createTestRoot(200, 200);
    let ref: CNode | null = null;
    root.render(
      <View
        ref={(n) => {
          ref = n as CNode | null;
        }}
        style={{ width: 20, height: 20 }}
      />
    );
    await root.flush();

    const seen: string[] = [];
    ref!.onanimationstart = (e) => seen.push(`start:${e.animationName}`);
    ref!.onanimationend = () => seen.push('end');
    const listener = () => seen.push('listener-end');
    ref!.addEventListener('animationend', listener);

    ref!.style.animationName = 'FadeIn';
    ref!.style.animationDelay = '10ms';
    ref!.style.animationDuration = '40ms';
    expect(seen).toEqual([]); // never synchronous

    await sleep(15);
    expect(seen).toEqual(['start:FadeIn']);

    await sleep(90);
    expect(seen).toEqual(['start:FadeIn', 'end', 'listener-end']);

    // A removed listener stops receiving; the handler property still fires.
    ref!.removeEventListener('animationend', listener);
    seen.length = 0;
    ref!.style.animationName = 'FadeOut';
    ref!.style.animationDuration = '0.02s';
    await sleep(80);
    expect(seen).toEqual(['start:FadeOut', 'end']);

    root.unmount();
  });

  it('clearing animationName reports animationcancel, never animationend', async () => {
    const root = createTestRoot(200, 200);
    let ref: CNode | null = null;
    root.render(
      <View
        ref={(n) => {
          ref = n as CNode | null;
        }}
        style={{ width: 20, height: 20 }}
      />
    );
    await root.flush();

    const seen: string[] = [];
    ref!.onanimationstart = () => seen.push('start');
    ref!.onanimationend = () => seen.push('end');
    // `animationcancel` is the one reanimated registers through the listener
    // registry rather than the handler property (Chrome's oncancel is
    // unreliable), so drive it that way here too.
    ref!.addEventListener('animationcancel', () => seen.push('cancel'));

    ref!.style.animationName = 'FadeOut';
    ref!.style.animationDuration = '20ms';
    ref!.style.animationName = ''; // reanimated's cancel, before the start lands
    await sleep(80);
    expect(seen).toEqual(['cancel']);
    expect(String(ref!.style.animationName)).toBe('');

    // Cancelling mid-flight, after the start has already landed.
    seen.length = 0;
    ref!.style.animationName = 'FadeIn';
    ref!.style.animationDuration = '200ms';
    await sleep(15);
    expect(seen).toEqual(['start']);
    ref!.style.animationName = '';
    await sleep(250);
    // Cancelled, and crucially the end never arrives late.
    expect(seen).toEqual(['start', 'cancel']);

    // Replacing one animation with another SUPERSEDES rather than cancels —
    // a browser reports no cancel there, and a spurious one would run a
    // library's teardown for an animation that is still going.
    seen.length = 0;
    ref!.style.animationName = 'SlideIn';
    ref!.style.animationDuration = '20ms';
    ref!.style.animationName = 'SlideOut';
    await sleep(120);
    expect(seen).toEqual(['start', 'end']);
    ref!.style.animationName = '';

    root.unmount();
  });
});

describe('CNode DOM facade — tree members', () => {
  it('firstChild is null even with children, and the tree rejects a non-CNode', async () => {
    const root = createTestRoot(200, 200);
    let parent: CNode | null = null;
    root.render(
      <View
        ref={(n) => {
          parent = n as CNode | null;
        }}
        style={{ width: 100, height: 100 }}
      >
        <View style={{ width: 10, height: 10 }} />
        <View style={{ width: 10, height: 10 }} />
      </View>
    );
    await root.flush();

    expect(parent!.children).toHaveLength(2);
    // Load-bearing: reanimated drains `while (element.firstChild)` into a
    // detached clone. Reporting null keeps the live subtree where it is.
    expect(parent!.firstChild).toBeNull();
    expect(parent!.offsetParent).toBeNull();
    expect(parent!.parentElement).toBeNull();
    expect(parent!.nodeType).toBe(1);
    expect(parent!.tagName).toBe('VIEW');
    expect(parent!.nodeName).toBe('VIEW');

    expect(parent!.contains(parent!)).toBe(true);
    expect(parent!.contains(parent!.children[0])).toBe(true);
    expect(parent!.contains(parent!.parent)).toBe(false);
    expect(parent!.contains({})).toBe(false);

    const foreign = { nodeType: 1, style: {} } as unknown as CNode;
    expect(() => parent!.appendChild(foreign)).toThrow(ForeignNodeError);
    expect(() => parent!.insertBefore(foreign, parent!.children[0]!)).toThrow(/not a CNode/);
    try {
      parent!.appendChild(foreign);
    } catch (e) {
      expect((e as Error).name).toBe('ForeignNodeError');
    }
    expect(parent!.children).toHaveLength(2); // untouched

    root.unmount();
  });

  it('cloneNode returns an inert stub that is not a CNode and cannot touch the tree', async () => {
    const root = createTestRoot(200, 200);
    let parent: CNode | null = null;
    root.render(
      <View
        ref={(n) => {
          parent = n as CNode | null;
        }}
        style={{ width: 100, height: 100 }}
      >
        <View style={{ width: 10, height: 10 }} />
      </View>
    );
    await root.flush();

    const child = parent!.children[0]!;
    const clone = parent!.cloneNode();
    expect(clone).not.toBeInstanceOf(CNode);
    expect(clone.tagName).toBe('VIEW');
    expect(clone.nodeType).toBe(1);
    expect(clone.firstChild).toBeNull();
    expect(clone.offsetParent).toBeNull();
    expect(clone.parentElement).toBeNull();
    expect(Array.from(clone.children)).toEqual([]);
    expect(clone.getBoundingClientRect().width).toBe(0);
    expect(clone.getBoundingClientRect().height).toBe(0);

    // The exiting flow's whole sequence, run against the stub.
    clone.appendChild(child);
    clone.removeChild(child);
    clone.remove();
    clone.scrollTop = 42;
    expect(clone.scrollTop).toBe(42);
    expect(Array.from(clone.children)).toEqual([]);
    expect(child.parent).toBe(parent); // the real tree never moved
    expect(parent!.children).toHaveLength(1);

    // The stub has its own style bag with the same lifecycle, driving nothing.
    const seen: string[] = [];
    clone.onanimationstart = () => seen.push('start');
    clone.onanimationend = () => seen.push('end');
    clone.style.opacity = '0.1';
    clone.style.animationName = 'FadeOut';
    clone.style.animationDuration = '20ms';
    await root.flush();
    expect(parent!.flatStyle.opacity).toBeUndefined();
    expect(Array.from(clone.style)).toEqual(['opacity', 'animation-name', 'animation-duration']);
    await sleep(80);
    expect(seen).toEqual(['start', 'end']);

    expect(clone.cloneNode()).not.toBe(clone);

    root.unmount();
  });

  it('remove() detaches the node from its parent', async () => {
    const root = createTestRoot(200, 200);
    let parent: CNode | null = null;
    root.render(
      <View
        ref={(n) => {
          parent = n as CNode | null;
        }}
        style={{ width: 100, height: 100 }}
      >
        <View style={{ width: 10, height: 10 }} />
      </View>
    );
    await root.flush();

    const child = parent!.children[0]!;
    child.remove();
    expect(parent!.children).toHaveLength(0);
    expect(child.parent).toBeNull();

    root.unmount();
  });
});

/**
 * The two crashes F14 reports, plus the flow that produces them, transcribed
 * from react-native-reanimated 4.5.3's `layoutReanimation/web/*`. The point is
 * not to test reanimated — it is to pin the exact call sequence the facade
 * exists to survive, so a future edit to an "obviously inert" member (above
 * all `firstChild`) fails here instead of in a browser.
 */
interface ExitingElement {
  style: NodeStyle;
  children: readonly ExitingElement[];
  firstChild: null;
  offsetParent: null;
  parentElement: null;
  scrollTop: number;
  scrollLeft: number;
  onanimationstart: DomEventListener | null;
  onanimationend: DomEventListener | null;
  addEventListener(type: string, listener: DomEventListener): void;
  removeEventListener(type: string, listener: DomEventListener): void;
  appendChild(child: never): unknown;
  remove(): void;
  cloneNode(): ExitingElement;
  getBoundingClientRect(): DOMRectLike;
  /** `isDummy`, `dummyClone`, `removedAfterAnimation` — reanimated's own tags. */
  [extra: string]: unknown;
}

function saveScrollPositions(rootEl: ExitingElement): Map<ExitingElement, { top: number; left: number }> {
  const positions = new Map<ExitingElement, { top: number; left: number }>();
  const visit = (node: ExitingElement) => {
    positions.set(node, { top: node.scrollTop, left: node.scrollLeft });
    for (const child of Array.from(node.children)) visit(child);
  };
  visit(rootEl);
  return positions;
}

function restoreScrollPositions(
  rootEl: ExitingElement,
  positions: Map<ExitingElement, { top: number; left: number }>,
  savedRoot?: ExitingElement
): void {
  const position = positions.get(savedRoot ?? rootEl);
  if (position) {
    rootEl.scrollTop = position.top;
    rootEl.scrollLeft = position.left;
  }
  for (const child of Array.from(rootEl.children)) restoreScrollPositions(child, positions);
}

describe('CNode DOM facade — reanimated 4 web runtime', () => {
  it('survives saveSnapshot and maybeReportOverwrittenProperties (the two reported crashes)', async () => {
    const root = createTestRoot(200, 200);
    let ref: CNode | null = null;
    root.render(
      <View
        ref={(n) => {
          ref = n as CNode | null;
        }}
        style={{ width: 40, height: 60, opacity: 1 }}
      />
    );
    await root.flush();
    const element = ref! as unknown as ExitingElement;

    // componentUtils.js:110 saveSnapshot — "getBoundingClientRect is not a function"
    const rect = element.getBoundingClientRect();
    const snapshot = { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
    expect(snapshot).toEqual({ top: 0, left: 0, width: 40, height: 60 });

    // animationsManager.js:28 maybeReportOverwrittenProperties —
    // "undefined is not iterable (cannot read property Symbol(Symbol.iterator))"
    element.style.opacity = '0.4';
    const keyframe = '@keyframes FadeIn { 0% { opacity: 0; } 100% { opacity: 1; } }';
    const animationProperties = new Set<string>();
    for (const match of keyframe.matchAll(/([a-zA-Z-]+)(?=:)/g)) animationProperties.add(match[1]!);
    const common = Array.from(element.style).filter((name) => animationProperties.has(name));
    expect(common).toEqual(['opacity']);

    root.unmount();
  });

  it('runs the whole exiting flow to its callback without touching the live tree', async () => {
    const root = createTestRoot(200, 200);
    let ref: CNode | null = null;
    root.render(
      <View
        ref={(n) => {
          ref = n as CNode | null;
        }}
        style={{ width: 80, height: 80 }}
      >
        <View style={{ width: 10, height: 10 }} />
        <View style={{ width: 10, height: 10 }} />
      </View>
    );
    await root.flush();
    const element = ref! as unknown as ExitingElement;

    let finished: boolean | null = null;

    // --- handleExitingAnimation(element, config) ---
    const parent = element.offsetParent as ExitingElement | null;
    const dummy = element.cloneNode();
    dummy.isDummy = true;
    dummy.style.animationName = '';
    element.style.visibility = 'hidden';
    element.dummyClone = dummy;
    element.style.animationName = '';

    const scrollPositions = saveScrollPositions(element);
    while (element.firstChild) dummy.appendChild(element.firstChild as never);
    parent?.appendChild(dummy as never);
    restoreScrollPositions(dummy, scrollPositions, element);

    // --- setElementAnimation(dummy, config, false, element) ---
    const cancelHandler = () => {
      finished = false;
    };
    dummy.onanimationstart = () => {
      dummy.addEventListener('animationcancel', cancelHandler);
    };
    dummy.onanimationend = () => {
      const positions = saveScrollPositions(dummy);
      element.style.visibility = 'initial';
      while (dummy.firstChild) element.appendChild(dummy.firstChild as never);
      restoreScrollPositions(element, positions, dummy);
      dummy.removedAfterAnimation = true;
      dummy.remove();
      delete element.dummyClone;
      finished = true;
      dummy.removeEventListener('animationcancel', cancelHandler);
    };
    dummy.style.animationName = 'FadeOut';
    dummy.style.animationDuration = '0.02s';
    dummy.style.animationDelay = '0s';

    await sleep(90);

    expect(finished).toBe(true); // the user's .withCallback would have fired
    expect(ref!.children).toHaveLength(2); // the live subtree never moved
    expect(ref!.parent).not.toBeNull();
    expect(element.dummyClone).toBeUndefined();
    expect(ref!.flatStyle.visibility).toBeUndefined(); // never reached the engine

    root.unmount();
  });
});
