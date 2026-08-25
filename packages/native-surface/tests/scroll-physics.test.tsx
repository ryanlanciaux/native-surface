import { describe, expect, test } from 'vitest';
import * as React from 'react';
import { Pressable, ScrollView } from '../src/components/primitives';
import { createTestRoot, sleep } from './helpers';
import {
  DECELERATION_FAST,
  DECELERATION_NORMAL,
  bounceAt,
  decayAt,
  decaySettleTarget,
  rubberBand,
} from '../src/engine/scrollPhysics';
import type { NativeRoot, ScrollViewHandle, ScrollEvent } from '../src/types';

/** Polls until `cond` holds or `timeout` elapses; returns whether it held. */
async function until(cond: () => boolean, timeout: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (cond()) return true;
    await sleep(25);
  }
  return cond();
}

/**
 * Event-driven settle: waits for the motion's own completion signal.
 * (A quiescence-based sampler false-positives under CPU starvation when
 * parallel test workers delay the 16 ms ticker — learned the hard way.)
 */
async function afterMomentumEnd(rec: Recorded, read: () => number, timeout = 8000): Promise<number> {
  const ok = await until(() => rec.events.includes('momentumEnd'), timeout);
  expect(ok).toBe(true);
  await sleep(60); // let the final clamped offset paint/emit
  return read();
}

interface Recorded {
  offsets: number[];
  events: string[];
}

function renderFeed(
  root: NativeRoot,
  rec: Recorded,
  opts: {
    contentH?: number;
    bounces?: boolean;
    decelerationRate?: 'normal' | 'fast' | number;
    onPress?: () => void;
    scrollRef?: React.Ref<ScrollViewHandle>;
  } = {}
): void {
  const rows = Math.max(1, Math.round((opts.contentH ?? 2000) / 100));
  root.render(
    <ScrollView
      ref={opts.scrollRef}
      style={{ width: 300, height: 300 }}
      bounces={opts.bounces}
      decelerationRate={opts.decelerationRate ?? 'fast'}
      onScroll={(e: ScrollEvent) => rec.offsets.push(e.nativeEvent.contentOffset.y)}
      onScrollBeginDrag={() => rec.events.push('beginDrag')}
      onScrollEndDrag={(e: ScrollEvent) => {
        rec.events.push('endDrag');
        rec.offsets.push(e.nativeEvent.contentOffset.y);
        if (e.nativeEvent.velocity) rec.events.push(`v=${e.nativeEvent.velocity.y.toFixed(2)}`);
      }}
      onMomentumScrollBegin={() => rec.events.push('momentumBegin')}
      onMomentumScrollEnd={() => rec.events.push('momentumEnd')}
    >
      {Array.from({ length: rows }, (_, i) => (
        <Pressable key={i} style={{ width: 300, height: 100 }} onPress={opts.onPress} />
      ))}
    </ScrollView>
  );
}

/** down→3 moves→up along -y with explicit timestamps; returns release velocity px/ms (content). */
function fling(root: NativeRoot, perStepPx: number): number {
  root.dispatchPointerEvent('down', { x: 150, y: 280, t: 0 });
  root.dispatchPointerEvent('move', { x: 150, y: 280 - perStepPx, t: 16 });
  root.dispatchPointerEvent('move', { x: 150, y: 280 - 2 * perStepPx, t: 32 });
  root.dispatchPointerEvent('move', { x: 150, y: 280 - 3 * perStepPx, t: 48 });
  root.dispatchPointerEvent('up', { x: 150, y: 280 - 3 * perStepPx, t: 64 });
  return (3 * perStepPx) / 64;
}

describe('scroll physics — closed forms', () => {
  test('decay matches RN DecayAnimation semantics', () => {
    expect(decaySettleTarget(0, 1, DECELERATION_NORMAL)).toBeCloseTo(500, 5);
    expect(decaySettleTarget(10, 2, DECELERATION_FAST)).toBeCloseTo(210, 5);
    const early = decayAt(0, 1, DECELERATION_FAST, 50);
    const late = decayAt(0, 1, DECELERATION_FAST, 300);
    expect(early.x).toBeGreaterThan(0);
    expect(late.x).toBeGreaterThan(early.x);
    expect(late.x).toBeLessThan(100);
    expect(late.v).toBeLessThan(early.v);
  });

  test('rubber-band is monotonic, diminishing, bounded by the viewport', () => {
    const dim = 300;
    expect(rubberBand(0, dim)).toBe(0);
    expect(rubberBand(120, dim)).toBeGreaterThan(rubberBand(60, dim));
    // diminishing returns: second 60px moves less than the first 60px
    expect(rubberBand(120, dim) - rubberBand(60, dim)).toBeLessThan(rubberBand(60, dim));
    expect(rubberBand(120, dim)).toBeCloseTo(54.1, 0);
    expect(rubberBand(1e9, dim)).toBeLessThan(dim);
  });

  test('bounce spring is critically damped: settles without ringing', () => {
    let prevAbs = Infinity;
    let signFlips = 0;
    let prevSign = Math.sign(bounceAt(60, 0, 0.012, 1).x);
    for (let t = 40; t <= 800; t += 40) {
      const { x } = bounceAt(60, 0, 0.012, t);
      if (Math.sign(x) !== prevSign && Math.abs(x) > 0.01) signFlips++;
      prevSign = Math.sign(x);
      expect(Math.abs(x)).toBeLessThanOrEqual(prevAbs + 1e-9);
      prevAbs = Math.abs(x);
    }
    expect(signFlips).toBe(0);
    expect(Math.abs(bounceAt(60, 0, 0.012, 700).x)).toBeLessThan(0.6);
  });
});

describe('scroll physics — engine integration', () => {
  test('fling glides to the decay settle target and fires callbacks in RN order', async () => {
    const root = createTestRoot(300, 300);
    const rec: Recorded = { offsets: [], events: [] };
    renderFeed(root, rec, { contentH: 2000, decelerationRate: 'fast' });
    await root.flush();

    const v = fling(root, 16); // 48px drag, v = 0.75 px/ms
    const draggedTo = rec.offsets.at(-1)!;
    expect(draggedTo).toBeCloseTo(48, 0);
    const predicted = decaySettleTarget(draggedTo, v, DECELERATION_FAST);

    const final = await afterMomentumEnd(rec, () => rec.offsets.at(-1) ?? 0);
    expect(Math.abs(final - predicted)).toBeLessThan(6);

    const order = rec.events.filter((e) => !e.startsWith('v='));
    expect(order).toEqual(['beginDrag', 'endDrag', 'momentumBegin', 'momentumEnd']);
    // endDrag reported the release velocity
    expect(rec.events.find((e) => e.startsWith('v='))).toBe(`v=${v.toFixed(2)}`);
    root.unmount();
  });

  test('touching a decelerating scroll view stops it dead and suppresses press', async () => {
    const root = createTestRoot(300, 300);
    const rec: Recorded = { offsets: [], events: [] };
    let pressed = 0;
    renderFeed(root, rec, { contentH: 2000, onPress: () => pressed++ });
    await root.flush();

    fling(root, 24);
    await sleep(100); // mid-glide
    expect(rec.events).toContain('momentumBegin');
    expect(rec.events).not.toContain('momentumEnd');

    root.dispatchPointerEvent('down', { x: 150, y: 150, t: 1000 });
    expect(rec.events).toContain('momentumEnd'); // catch ends momentum immediately
    const atCatch = rec.offsets.at(-1)!;
    await sleep(150);
    expect(Math.abs((rec.offsets.at(-1) ?? atCatch) - atCatch)).toBeLessThan(0.05); // held still
    root.dispatchPointerEvent('up', { x: 150, y: 150, t: 1050 });
    await sleep(150);
    expect(pressed).toBe(0); // the stop-touch never presses
    expect(Math.abs((rec.offsets.at(-1) ?? atCatch) - atCatch)).toBeLessThan(0.5); // no re-glide
    root.unmount();
  });

  test('momentum into an edge overshoots (bounces) then settles exactly at the edge', async () => {
    const root = createTestRoot(300, 300);
    const rec: Recorded = { offsets: [], events: [] };
    renderFeed(root, rec, { contentH: 600 }); // max = 300
    await root.flush();

    fling(root, 64); // v = 3 px/ms → settle target far past max
    const final = await afterMomentumEnd(rec, () => rec.offsets.at(-1) ?? 0);
    const maxSeen = Math.max(...rec.offsets);
    expect(maxSeen).toBeGreaterThan(310); // visibly rubber-banded past the edge
    expect(maxSeen).toBeLessThan(400); // but resisted
    expect(final).toBeCloseTo(300, 0);
    expect(rec.events.filter((e) => e === 'momentumEnd')).toHaveLength(1);
    root.unmount();
  });

  test('bounces={false} clamps dead at the edge with no overshoot', async () => {
    const root = createTestRoot(300, 300);
    const rec: Recorded = { offsets: [], events: [] };
    renderFeed(root, rec, { contentH: 600, bounces: false });
    await root.flush();

    fling(root, 64);
    // bounces=false never enters a bounce: momentum ends when the edge clamps
    const final = await afterMomentumEnd(rec, () => rec.offsets.at(-1) ?? 0);
    expect(Math.max(...rec.offsets)).toBeLessThanOrEqual(300.001);
    expect(final).toBeCloseTo(300, 5);
    root.unmount();
  });

  test('dragging past the top rubber-bands with iOS resistance and springs back', async () => {
    const root = createTestRoot(300, 300);
    const rec: Recorded = { offsets: [], events: [] };
    renderFeed(root, rec, { contentH: 2000 });
    await root.flush();

    root.dispatchPointerEvent('down', { x: 150, y: 60, t: 0 });
    root.dispatchPointerEvent('move', { x: 150, y: 100, t: 16 });
    root.dispatchPointerEvent('move', { x: 150, y: 140, t: 32 });
    root.dispatchPointerEvent('move', { x: 150, y: 180, t: 48 });
    const displayed = rec.offsets.at(-1)!;
    expect(displayed).toBeLessThan(0); // overscrolled above the top
    expect(displayed).toBeCloseTo(-rubberBand(120, 300), 0); // resistance, not 1:1
    // hold still so release velocity ≈ 0, then let go
    root.dispatchPointerEvent('up', { x: 150, y: 180, t: 200 });
    // an overscrolled release settles via the bounce phase (momentum-callbacked)
    const final = await afterMomentumEnd(rec, () => rec.offsets.at(-1) ?? 0);
    expect(final).toBeCloseTo(0, 1); // sprang back to rest
    root.unmount();
  });

  test('scrollTo: immediate when animated=false, eased glide when animated', async () => {
    const root = createTestRoot(300, 300);
    const rec: Recorded = { offsets: [], events: [] };
    const ref = React.createRef<ScrollViewHandle>();
    renderFeed(root, rec, { contentH: 2000, scrollRef: ref });
    await root.flush();

    ref.current!.scrollTo({ y: 200, animated: false });
    expect(rec.offsets.at(-1)).toBe(200);

    ref.current!.scrollTo({ y: 500, animated: true });
    await sleep(80);
    const mid = rec.offsets.at(-1)!;
    expect(mid).toBeGreaterThan(200);
    expect(mid).toBeLessThan(500); // in flight, not a teleport
    const ok = await until(() => Math.abs((rec.offsets.at(-1) ?? 0) - 500) < 0.5, 8000);
    expect(ok).toBe(true);
    await sleep(150);
    expect(rec.offsets.at(-1)).toBeCloseTo(500, 0); // arrived and stayed

    ref.current!.scrollToEnd({ animated: false });
    expect(rec.offsets.at(-1)).toBe(1700); // content 2000 − viewport 300
    root.unmount();
  });

  test('coalesced swipe (one move right before up) still flings', async () => {
    // Browsers coalesce pointermoves: a fast swipe can arrive as a single
    // move at the release instant. Velocity must extend its baseline to the
    // down sample instead of reading a zero-length window.
    const root = createTestRoot(300, 300);
    const rec: Recorded = { offsets: [], events: [] };
    renderFeed(root, rec, { contentH: 2000 });
    await root.flush();
    root.dispatchPointerEvent('down', { x: 150, y: 280, t: 0 });
    root.dispatchPointerEvent('move', { x: 150, y: 80, t: 38 }); // one 200px jump
    root.dispatchPointerEvent('up', { x: 150, y: 80, t: 42 });
    const final = await afterMomentumEnd(rec, () => rec.offsets.at(-1) ?? 0);
    expect(rec.events).toContain('momentumBegin');
    expect(final).toBeGreaterThan(250); // glided well past the 200px drag
    root.unmount();
  });

  test('drag, hold, release produces no momentum (iOS semantics)', async () => {
    const root = createTestRoot(300, 300);
    const rec: Recorded = { offsets: [], events: [] };
    renderFeed(root, rec, { contentH: 2000 });
    await root.flush();
    root.dispatchPointerEvent('down', { x: 150, y: 280, t: 0 });
    root.dispatchPointerEvent('move', { x: 150, y: 200, t: 16 });
    root.dispatchPointerEvent('move', { x: 150, y: 160, t: 32 });
    root.dispatchPointerEvent('up', { x: 150, y: 160, t: 600 }); // held still, then let go
    await sleep(200);
    expect(rec.events).not.toContain('momentumBegin');
    expect(rec.offsets.at(-1)).toBeCloseTo(120, 0); // stayed where the drag left it
    root.unmount();
  });

  test('wheel input stays clamped and interrupts momentum', async () => {
    const root = createTestRoot(300, 300);
    const rec: Recorded = { offsets: [], events: [] };
    renderFeed(root, rec, { contentH: 2000 });
    await root.flush();

    fling(root, 24);
    await sleep(80); // mid-glide
    root.dispatchPointerEvent('wheel', { x: 150, y: 150, deltaY: 100 });
    expect(rec.events).toContain('momentumEnd');
    const after = rec.offsets.at(-1)!;
    await sleep(150);
    expect(Math.abs((rec.offsets.at(-1) ?? after) - after)).toBeLessThan(0.05); // wheel killed the glide
    root.dispatchPointerEvent('wheel', { x: 150, y: 150, deltaY: -1e6 });
    expect(rec.offsets.at(-1)).toBe(0); // clamped
    root.unmount();
  });
});
