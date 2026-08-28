/**
 * PanResponder contract, driven through the REAL pointer pipeline: the
 * panHandlers bag is spread onto a View exactly as RN code spreads it, and the
 * engine's pan seam (__panHandler, engine/events.ts) delivers the stream. That
 * is what makes these assertions about the shipped path rather than about a
 * hand-called driver.
 *
 * gestureState is one mutable object reused for the whole gesture (RN
 * semantics), so every case snapshots it inside the callback.
 */
import { describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { Pressable, ScrollView, View } from '../src/components/primitives';
import { Animated } from '../src/api/Animated';
import { PanResponder, type PanResponderGestureState } from '../src/api/PanResponder';
import { createTestRoot, sleep } from './helpers';

const RESPONDER_PROPS = [
  'onStartShouldSetResponder',
  'onStartShouldSetResponderCapture',
  'onMoveShouldSetResponder',
  'onMoveShouldSetResponderCapture',
  'onResponderGrant',
  'onResponderStart',
  'onResponderMove',
  'onResponderEnd',
  'onResponderRelease',
  'onResponderTerminate',
  'onResponderTerminationRequest',
  'onResponderReject',
];

type Snapshot = PanResponderGestureState;
const snapshot = (g: PanResponderGestureState): Snapshot => ({ ...g });

describe('PanResponder', () => {
  it('exposes the RN responder props plus the engine seam', () => {
    const responder = PanResponder.create({ onStartShouldSetPanResponder: () => true });
    expect(Object.keys(responder.panHandlers).sort()).toEqual([...RESPONDER_PROPS, '__panHandler'].sort());
    for (const name of RESPONDER_PROPS) {
      expect(typeof (responder.panHandlers as unknown as Record<string, unknown>)[name]).toBe('function');
    }
    expect(responder.getInteractionHandle()).toBeNull();
  });

  it('grants at touch-down and reports translation from the grant point', async () => {
    const root = createTestRoot(200, 200);
    const grants: Snapshot[] = [];
    const moves: Snapshot[] = [];
    let release: Snapshot | null = null;
    const responder = PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: (_e, g) => grants.push(snapshot(g)),
      onPanResponderMove: (_e, g) => moves.push(snapshot(g)),
      onPanResponderRelease: (_e, g) => (release = snapshot(g)),
    });
    root.render(<View style={{ flex: 1 }} {...responder.panHandlers} />);
    await root.flush();

    root.dispatchPointerEvent('down', { x: 50, y: 50 });
    root.dispatchPointerEvent('move', { x: 70, y: 90 });
    root.dispatchPointerEvent('move', { x: 80, y: 110 });
    root.dispatchPointerEvent('up', { x: 80, y: 110 });

    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({ x0: 50, y0: 50, dx: 0, dy: 0, numberActiveTouches: 1 });
    expect(moves.map((g) => [g.dx, g.dy])).toEqual([
      [20, 40],
      [30, 60],
    ]);
    expect(moves[1]).toMatchObject({ moveX: 80, moveY: 110 });
    expect(release!).toMatchObject({ dx: 30, dy: 60, numberActiveTouches: 0 });
    // stateID identifies the responder instance and never becomes NaN.
    expect(Number.isFinite(grants[0]!.stateID)).toBe(true);
    root.unmount();
  });

  it('orders Grant, Start, Move, End, Release the way RN does', async () => {
    const root = createTestRoot(200, 200);
    const order: string[] = [];
    const responder = PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => order.push('grant'),
      onPanResponderStart: () => order.push('start'),
      onPanResponderMove: () => order.push('move'),
      onPanResponderEnd: () => order.push('end'),
      onPanResponderRelease: () => order.push('release'),
    });
    root.render(<View style={{ flex: 1 }} {...responder.panHandlers} />);
    await root.flush();

    root.dispatchPointerEvent('down', { x: 10, y: 10 });
    root.dispatchPointerEvent('move', { x: 10, y: 40 });
    root.dispatchPointerEvent('up', { x: 10, y: 40 });
    expect(order).toEqual(['grant', 'start', 'move', 'end', 'release']);
    root.unmount();
  });

  it('accumulates dx/dy while deciding, then resets them at a mid-drag grant', async () => {
    const root = createTestRoot(200, 200);
    const decisions: Array<[number, number]> = [];
    let grant: Snapshot | null = null;
    const moves: Snapshot[] = [];
    const responder = PanResponder.create({
      // The RN idiom everyone writes: claim only once the drag is real.
      onMoveShouldSetPanResponder: (_e, g) => {
        decisions.push([g.dx, g.dy]);
        return Math.abs(g.dy) > 5;
      },
      onPanResponderGrant: (_e, g) => (grant = snapshot(g)),
      onPanResponderMove: (_e, g) => moves.push(snapshot(g)),
    });
    root.render(<View style={{ flex: 1 }} {...responder.panHandlers} />);
    await root.flush();

    root.dispatchPointerEvent('down', { x: 100, y: 100 });
    root.dispatchPointerEvent('move', { x: 100, y: 104 }); // dy 4: still deciding
    expect(grant).toBeNull();
    root.dispatchPointerEvent('move', { x: 100, y: 112 }); // dy 12: granted here
    root.dispatchPointerEvent('move', { x: 100, y: 132 });
    root.dispatchPointerEvent('up', { x: 100, y: 132 });

    expect(decisions).toEqual([
      [0, 4],
      [0, 12],
    ]);
    // Granted mid-drag: the gesture measures from the activation point, and the
    // granting move itself delivers no onPanResponderMove.
    expect(grant!).toMatchObject({ x0: 100, y0: 112, dx: 0, dy: 0 });
    expect(moves.map((g) => g.dy)).toEqual([20]);
    root.unmount();
  });

  it('estimates release velocity in px/ms over the recent pointer samples', async () => {
    const root = createTestRoot(200, 200);
    let release: Snapshot | null = null;
    const responder = PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderRelease: (_e, g) => (release = snapshot(g)),
    });
    root.render(<View style={{ flex: 1 }} {...responder.panHandlers} />);
    await root.flush();

    // Real elapsed time between samples: the engine timestamps the pan stream
    // from its own clock, so the sleeps are what make dt meaningful.
    root.dispatchPointerEvent('down', { x: 20, y: 20 });
    await sleep(20);
    root.dispatchPointerEvent('move', { x: 20, y: 60 });
    await sleep(20);
    root.dispatchPointerEvent('move', { x: 20, y: 100 });
    root.dispatchPointerEvent('up', { x: 20, y: 100 });

    expect(release!.dy).toBe(80);
    expect(Number.isFinite(release!.vy)).toBe(true);
    expect(release!.vx).toBe(0);
    // The up repeats the last move's position, so this is only non-zero
    // because the estimate reaches back over the window rather than
    // differencing the final pair. ~80px over ~40ms, downward.
    expect(release!.vy).toBeGreaterThan(0);
    expect(release!.vy).toBeLessThan(20);
    root.unmount();
  });

  it('owns the gesture: a nested press cancels and an ancestor ScrollView stays put', async () => {
    const root = createTestRoot(200, 200);
    const calls: string[] = [];
    let scrollY = -1;
    const responder = PanResponder.create({ onStartShouldSetPanResponder: () => true });
    root.render(
      <ScrollView
        style={{ width: 200, height: 200 }}
        onScroll={(e) => {
          scrollY = e.nativeEvent.contentOffset.y;
        }}
      >
        <View style={{ width: 200, height: 300 }} {...responder.panHandlers}>
          <Pressable
            style={{ flex: 1 }}
            onPressIn={() => calls.push('in')}
            onPress={() => calls.push('press')}
            onPressOut={() => calls.push('out')}
          />
        </View>
        <View style={{ width: 200, height: 300 }} />
      </ScrollView>
    );
    await root.flush();

    root.dispatchPointerEvent('down', { x: 100, y: 50 });
    root.dispatchPointerEvent('move', { x: 100, y: 20 });
    root.dispatchPointerEvent('move', { x: 100, y: 5 });
    root.dispatchPointerEvent('up', { x: 100, y: 5 });
    expect(scrollY).toBe(-1); // the responder took the drag; the list never scrolled
    expect(calls).toEqual(['in', 'out']); // press-in, then cancelled by the pan
    root.unmount();
  });

  it('terminates on a cancelled pointer without releasing', async () => {
    const root = createTestRoot(200, 200);
    const order: string[] = [];
    let terminated: Snapshot | null = null;
    const responder = PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderRelease: () => order.push('release'),
      onPanResponderTerminate: (_e, g) => {
        order.push('terminate');
        terminated = snapshot(g);
      },
    });
    root.render(<View style={{ flex: 1 }} {...responder.panHandlers} />);
    await root.flush();

    root.dispatchPointerEvent('down', { x: 10, y: 10 });
    root.dispatchPointerEvent('move', { x: 10, y: 60 });
    root.dispatchPointerEvent('cancel', { x: 10, y: 60 });
    expect(order).toEqual(['terminate']);
    expect(terminated!).toMatchObject({ dy: 50, numberActiveTouches: 0 });
    root.unmount();
  });

  it('survives being spread onto an Animated.View', async () => {
    // Exactly how @sentry/react-native's feedback sheet wires it: the handlers
    // go on an Animated.View, so the engine seam has to pass through
    // createAnimatedComponent's prop resolution untouched.
    const root = createTestRoot(200, 200);
    const moves: Array<[number, number]> = [];
    const responder = PanResponder.create({
      onStartShouldSetPanResponder: (_e, g) => g.dy > 0,
      onMoveShouldSetPanResponder: (_e, g) => g.dy > 0,
      onPanResponderMove: (_e, g) => moves.push([g.dx, g.dy]),
    });
    root.render(
      <Animated.View style={{ flex: 1 }} {...responder.panHandlers}>
        <View style={{ flex: 1 }} />
      </Animated.View>
    );
    await root.flush();

    root.dispatchPointerEvent('down', { x: 100, y: 20 });
    root.dispatchPointerEvent('move', { x: 100, y: 40 }); // dy 20 > 0: grants here
    root.dispatchPointerEvent('move', { x: 100, y: 70 });
    root.dispatchPointerEvent('up', { x: 100, y: 70 });
    expect(moves).toEqual([[0, 30]]); // measured from the activation point
    root.unmount();
  });

  it('never claims a gesture it declined, leaving press and scroll alone', async () => {
    const root = createTestRoot(200, 200);
    const calls: string[] = [];
    const move = vi.fn();
    const responder = PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: () => false,
      onPanResponderMove: move,
    });
    root.render(
      <View style={{ flex: 1 }} {...responder.panHandlers}>
        <Pressable style={{ flex: 1 }} onPress={() => calls.push('press')} />
      </View>
    );
    await root.flush();

    root.dispatchPointerEvent('down', { x: 40, y: 40 });
    root.dispatchPointerEvent('up', { x: 40, y: 40 });
    expect(calls).toEqual(['press']);
    expect(move).not.toHaveBeenCalled();
    root.unmount();
  });
});
