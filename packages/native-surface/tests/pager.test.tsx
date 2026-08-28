/**
 * pagingEnabled scroll physics + the react-native-pager-view compat shim,
 * exercised through the real engine with synthetic pointer gestures (explicit
 * `t` timestamps make release velocities deterministic; the snap animation
 * itself runs on real time, so settles are awaited event-driven via
 * momentum-end / onPageSelected, same as scroll-physics.test.tsx).
 */
import { describe, expect, test } from 'vitest';
import * as React from 'react';
import { ScrollView, View } from '../src/components/primitives';
import { createTestRoot, sleep } from './helpers';
import PagerView, { type PagerViewHandle } from '../../compat/src/pager-view';
import type { NativeRoot, ScrollEvent } from '../src/types';

/** Polls until `cond` holds or `timeout` elapses; returns whether it held. */
async function until(cond: () => boolean, timeout: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (cond()) return true;
    await sleep(25);
  }
  return cond();
}

interface Recorded {
  offsets: number[];
  events: string[];
}

/** Event-driven settle (see scroll-physics.test.tsx on why not quiescence). */
async function afterMomentumEnd(rec: Recorded, read: () => number, timeout = 8000): Promise<number> {
  const ok = await until(() => rec.events.includes('momentumEnd'), timeout);
  expect(ok).toBe(true);
  await sleep(60); // let the final clamped offset paint/emit
  return read();
}

/** 300×300 horizontal paging ScrollView holding `pages` full-viewport pages. */
function renderPagedRow(root: NativeRoot, rec: Recorded, pages = 3): void {
  root.render(
    <ScrollView
      horizontal
      pagingEnabled
      style={{ width: 300, height: 300 }}
      onScroll={(e: ScrollEvent) => rec.offsets.push(e.nativeEvent.contentOffset.x)}
      onScrollBeginDrag={() => rec.events.push('beginDrag')}
      onScrollEndDrag={() => rec.events.push('endDrag')}
      onMomentumScrollBegin={() => rec.events.push('momentumBegin')}
      onMomentumScrollEnd={() => rec.events.push('momentumEnd')}
    >
      {Array.from({ length: pages }, (_, i) => (
        <View key={i} style={{ width: 300, height: 300 }} />
      ))}
    </ScrollView>
  );
}

/** Leftward drag of `total` px in three slow steps, hold, release (v ≈ 0). */
function slowDragX(root: NativeRoot, total: number): void {
  const step = total / 3;
  root.dispatchPointerEvent('down', { x: 280, y: 150, t: 0 });
  root.dispatchPointerEvent('move', { x: 280 - step, y: 150, t: 100 });
  root.dispatchPointerEvent('move', { x: 280 - 2 * step, y: 150, t: 200 });
  root.dispatchPointerEvent('move', { x: 280 - 3 * step, y: 150, t: 300 });
  // the hold (t=300 → t=800) drains the velocity window: release velocity 0
  root.dispatchPointerEvent('up', { x: 280 - 3 * step, y: 150, t: 800 });
}

describe('pagingEnabled scroll physics', () => {
  test('slow drag 30% of a page snaps back to page 0', async () => {
    const root = createTestRoot(300, 300);
    const rec: Recorded = { offsets: [], events: [] };
    renderPagedRow(root, rec);
    await root.flush();

    slowDragX(root, 90);
    expect(rec.offsets.at(-1)).toBeCloseTo(90, 0); // dragged 30% in
    const final = await afterMomentumEnd(rec, () => rec.offsets.at(-1) ?? -1);
    expect(final).toBeCloseTo(0, 5);
    expect(rec.events).toEqual(['beginDrag', 'endDrag', 'momentumBegin', 'momentumEnd']);
    root.unmount();
  });

  test('slow drag past 50% settles exactly on the page 1 boundary', async () => {
    const root = createTestRoot(300, 300);
    const rec: Recorded = { offsets: [], events: [] };
    renderPagedRow(root, rec);
    await root.flush();

    slowDragX(root, 160);
    expect(rec.offsets.at(-1)).toBeCloseTo(160, 0);
    const final = await afterMomentumEnd(rec, () => rec.offsets.at(-1) ?? -1);
    expect(final).toBeCloseTo(300, 5); // exactly one viewport width
    root.unmount();
  });

  test('fast flick over a short distance still advances one page', async () => {
    const root = createTestRoot(300, 300);
    const rec: Recorded = { offsets: [], events: [] };
    renderPagedRow(root, rec);
    await root.flush();

    // 60 px in 64 ms → content velocity ≈ 0.94 px/ms, over the flick threshold
    root.dispatchPointerEvent('down', { x: 280, y: 150, t: 0 });
    root.dispatchPointerEvent('move', { x: 260, y: 150, t: 16 });
    root.dispatchPointerEvent('move', { x: 240, y: 150, t: 32 });
    root.dispatchPointerEvent('move', { x: 220, y: 150, t: 48 });
    root.dispatchPointerEvent('up', { x: 220, y: 150, t: 64 });
    expect(rec.offsets.at(-1)!).toBeLessThan(150); // released well before halfway
    const final = await afterMomentumEnd(rec, () => rec.offsets.at(-1) ?? -1);
    expect(final).toBeCloseTo(300, 5);
    root.unmount();
  });
});

describe('PagerView compat', () => {
  test('initialPage, setPage, and the pager event contract', async () => {
    const root = createTestRoot(300, 300);
    const sel: number[] = [];
    const scrolls: Array<{ position: number; offset: number }> = [];
    const states: string[] = [];
    const ref = React.createRef<PagerViewHandle>();
    root.render(
      <PagerView
        ref={ref}
        style={{ width: 300, height: 300 }}
        initialPage={1}
        onPageSelected={(e) => sel.push(e.nativeEvent.position)}
        onPageScroll={(e) => scrolls.push({ ...e.nativeEvent })}
        onPageScrollStateChanged={(e) => states.push(e.nativeEvent.pageScrollState)}
      >
        <View key="a" style={{ backgroundColor: '#f00' }} />
        <View key="b" style={{ backgroundColor: '#0f0' }} />
        <View key="c" style={{ backgroundColor: '#00f' }} />
      </PagerView>
    );
    await root.flush();
    await root.flush(); // measure pass → sized pages → initial jump
    const landed = await until(() => sel.length > 0, 8000);
    expect(landed).toBe(true);
    expect(sel).toEqual([1]); // landed on initialPage without animation
    expect(scrolls.at(-1)).toEqual({ position: 1, offset: 0 });
    expect(states).toEqual([]); // the initial jump neither drags nor settles

    ref.current!.setPage(2);
    const settled = await until(() => sel.includes(2), 8000);
    expect(settled).toBe(true);
    expect(scrolls.at(-1)!.position).toBe(2);
    expect(scrolls.at(-1)!.offset).toBeCloseTo(0, 5);
    // the animated glide reported intermediate progress, not a teleport
    expect(scrolls.some((s) => s.position === 1 && s.offset > 0.2 && s.offset < 0.8)).toBe(true);
    expect(states).toEqual(['settling', 'idle']);

    // fast flick rightward back to page 1
    root.dispatchPointerEvent('down', { x: 20, y: 150, t: 1000 });
    root.dispatchPointerEvent('move', { x: 50, y: 150, t: 1016 });
    root.dispatchPointerEvent('move', { x: 80, y: 150, t: 1032 });
    root.dispatchPointerEvent('move', { x: 110, y: 150, t: 1048 });
    root.dispatchPointerEvent('up', { x: 110, y: 150, t: 1064 });
    const back = await until(() => sel.length === 3, 8000);
    expect(back).toBe(true);
    expect(sel).toEqual([1, 2, 1]);
    expect(states.slice(2)).toEqual(['dragging', 'settling', 'idle']);
    root.unmount();
  });

  test('vertical orientation snaps on height boundaries', async () => {
    const root = createTestRoot(300, 300);
    const sel: number[] = [];
    const scrolls: Array<{ position: number; offset: number }> = [];
    root.render(
      <PagerView
        style={{ width: 300, height: 300 }}
        orientation="vertical"
        onPageSelected={(e) => sel.push(e.nativeEvent.position)}
        onPageScroll={(e) => scrolls.push({ ...e.nativeEvent })}
      >
        <View key="a" />
        <View key="b" />
        <View key="c" />
      </PagerView>
    );
    await root.flush();
    await root.flush();
    const landed = await until(() => sel.length > 0, 8000);
    expect(landed).toBe(true);
    expect(sel).toEqual([0]);

    // slow upward drag of 180 px (60% of a page), hold, release
    root.dispatchPointerEvent('down', { x: 150, y: 280, t: 0 });
    root.dispatchPointerEvent('move', { x: 150, y: 220, t: 100 });
    root.dispatchPointerEvent('move', { x: 150, y: 160, t: 200 });
    root.dispatchPointerEvent('move', { x: 150, y: 100, t: 300 });
    root.dispatchPointerEvent('up', { x: 150, y: 100, t: 800 });
    const settled = await until(() => sel.includes(1), 8000);
    expect(settled).toBe(true);
    expect(scrolls.at(-1)).toEqual({ position: 1, offset: 0 }); // rests on the height boundary
    root.unmount();
  });
});
