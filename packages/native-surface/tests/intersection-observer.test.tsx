// @vitest-environment jsdom
/**
 * IntersectionObserver over canvas nodes.
 *
 * The failure this exists for is not subtle: `observe()` on an engine node
 * throws "parameter 1 is not of type 'Element'" and takes the render down with
 * it. Apps reach that line by branching on `typeof IntersectionObserver !==
 * 'undefined'`, which is a browser check that is TRUE here — Bluesky's feed
 * interstitials do exactly that.
 *
 * jsdom has no real IntersectionObserver, so the native half is a stub whose
 * only job is to prove delegation happens and that a real Element never
 * reaches the engine path.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// jsdom supplies a window, so the engine's env seam would try to fetch its
// wasm and fonts over HTTP; force the Node loaders instead.
vi.mock('../src/env/index', async () => (await import('./nodeEnvMock')).nodeEnvMock());

import React from 'react';
import { View } from '../src/index';
import type { CNode } from '../src/engine/node';
import { createCanvasIntersectionObserver } from '../src/engine/intersectionObserver';
import { createTestRoot } from './helpers';

interface NativeCall {
  observed: unknown[];
  disconnected: number;
}
let nativeCalls: NativeCall;

/** Stands in for the platform observer jsdom does not provide. */
function makeNative(): typeof IntersectionObserver {
  return class {
    observe(target: unknown): void {
      nativeCalls.observed.push(target);
    }
    unobserve(): void {}
    disconnect(): void {
      nativeCalls.disconnected++;
    }
    takeRecords(): [] {
      return [];
    }
  } as unknown as typeof IntersectionObserver;
}

const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));

/** A laid-out node at a known place on a surface the size of the viewport. */
async function nodeAt(top: number, height: number): Promise<{ node: CNode; unmount(): void }> {
  const root = createTestRoot(400, 800);
  let node: CNode | null = null;
  root.render(
    <View style={{ paddingTop: top }}>
      <View
        ref={(n) => {
          node = n as CNode | null;
        }}
        style={{ width: 100, height }}
      />
    </View>
  );
  await root.flush();
  return { node: node!, unmount: () => root.unmount() };
}

beforeEach(() => {
  nativeCalls = { observed: [], disconnected: 0 };
  Object.defineProperty(window, 'innerWidth', { value: 400, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
});

describe('IntersectionObserver over canvas nodes', () => {
  it('observes an engine node instead of throwing "not of type Element"', async () => {
    const Observer = createCanvasIntersectionObserver(makeNative());
    const { node, unmount } = await nodeAt(10, 50);
    const seen: boolean[] = [];

    const observer = new Observer((entries) => seen.push(entries[0]!.isIntersecting));
    expect(() => observer.observe(node as unknown as Element)).not.toThrow();
    await nextFrame();

    expect(seen).toEqual([true]);
    // ...and it never reached the native observer.
    expect(nativeCalls.observed).toHaveLength(0);
    observer.disconnect();
    unmount();
  });

  it('delegates a real Element to the platform observer, untouched', () => {
    const Observer = createCanvasIntersectionObserver(makeNative());
    const el = document.createElement('div');
    const observer = new Observer(() => {});
    observer.observe(el);
    expect(nativeCalls.observed).toEqual([el]);
    observer.disconnect();
    expect(nativeCalls.disconnected).toBe(1);
  });

  it('reports a node laid out beyond the viewport as not intersecting', async () => {
    const Observer = createCanvasIntersectionObserver(makeNative());
    // 900px down a surface whose viewport is 800 tall: entirely below the fold.
    const { node, unmount } = await nodeAt(900, 50);
    const seen: Array<{ hit: boolean; ratio: number }> = [];

    const observer = new Observer((entries) =>
      seen.push({ hit: entries[0]!.isIntersecting, ratio: entries[0]!.intersectionRatio })
    );
    observer.observe(node as unknown as Element);
    await nextFrame();

    expect(seen).toHaveLength(1);
    expect(seen[0]!.hit).toBe(false);
    expect(seen[0]!.ratio).toBe(0);
    observer.disconnect();
    unmount();
  });

  it('honors a threshold and only reports when it is crossed', async () => {
    const Observer = createCanvasIntersectionObserver(makeNative());
    // Straddles the fold: 780..880 against an 800-tall viewport → 20% visible.
    const { node, unmount } = await nodeAt(780, 100);
    const ratios: number[] = [];

    const observer = new Observer((entries) => ratios.push(entries[0]!.intersectionRatio));
    observer.observe(node as unknown as Element);
    await nextFrame();

    // The first observation always reports, as the real observer does.
    expect(ratios).toHaveLength(1);
    expect(ratios[0]).toBeCloseTo(0.2, 5);

    // Nothing moved, so no further callbacks — it fires on CHANGE.
    await nextFrame();
    await nextFrame();
    expect(ratios).toHaveLength(1);
    observer.disconnect();
    unmount();
  });

  it('stops observing a node that has been destroyed', async () => {
    const Observer = createCanvasIntersectionObserver(makeNative());
    const { node, unmount } = await nodeAt(10, 50);
    let calls = 0;
    const observer = new Observer(() => calls++);
    observer.observe(node as unknown as Element);
    await nextFrame();
    expect(calls).toBe(1);

    unmount();
    await nextFrame();
    await nextFrame();
    // A destroyed node is dropped rather than measured forever — the same
    // outcome a detached Element gets.
    expect(calls).toBe(1);
    observer.disconnect();
  });

  it('exposes the spec surface callers read', () => {
    const Observer = createCanvasIntersectionObserver(makeNative());
    const observer = new Observer(() => {}, { threshold: [0.75, 0.25] });
    expect(observer.thresholds).toEqual([0.25, 0.75]); // normalized + sorted
    expect(observer.rootMargin).toBe('0px');
    expect(observer.root).toBeNull();
    expect(observer.takeRecords()).toEqual([]);
  });
});
