import { describe, expect, test } from 'vitest';
import * as React from 'react';
import { Pressable, ScrollView, View } from '../src/components/primitives';
import { createTestRoot } from './helpers';

interface StreamEvent {
  x: number;
  y: number;
  timestamp: number;
}

function makeRecorder() {
  const events: Array<{ kind: string; x?: number; y?: number }> = [];
  const handler = {
    onDown: (e: StreamEvent) => events.push({ kind: 'down', x: e.x, y: e.y }),
    onMove: (e: StreamEvent) => events.push({ kind: 'move', x: e.x, y: e.y }),
    onUp: (e: StreamEvent) => events.push({ kind: 'up', x: e.x, y: e.y }),
    onCancel: () => events.push({ kind: 'cancel' }),
  };
  return { events, handler };
}

describe('pan handler seam (__panHandler)', () => {
  test('receives the raw down/move/up stream in page coords', async () => {
    const root = createTestRoot(200, 200);
    const { events, handler } = makeRecorder();
    root.render(
      <View style={{ flex: 1 }}>
        <View style={{ width: 200, height: 100 }} {...({ __panHandler: handler } as object)} />
      </View>
    );
    await root.flush();
    root.dispatchPointerEvent('down', { x: 50, y: 40 });
    root.dispatchPointerEvent('move', { x: 60, y: 70 });
    root.dispatchPointerEvent('move', { x: 60, y: 90 });
    root.dispatchPointerEvent('up', { x: 60, y: 95 });
    expect(events.map((e) => e.kind)).toEqual(['down', 'move', 'move', 'up']);
    expect(events[0]).toMatchObject({ x: 50, y: 40 });
    expect(events[3]).toMatchObject({ x: 60, y: 95 });
    root.unmount();
  });

  test('a pan past slop cancels the press on a nested pressable; a tap still presses', async () => {
    const root = createTestRoot(200, 200);
    const { handler } = makeRecorder();
    const calls: string[] = [];
    root.render(
      <View style={{ flex: 1 }} {...({ __panHandler: handler } as object)}>
        <Pressable
          style={{ width: 200, height: 200 }}
          onPressIn={() => calls.push('in')}
          onPress={() => calls.push('press')}
          onPressOut={() => calls.push('out')}
        />
      </View>
    );
    await root.flush();
    // drag: press-in then cancelled once movement exceeds slop
    root.dispatchPointerEvent('down', { x: 100, y: 100 });
    root.dispatchPointerEvent('move', { x: 100, y: 140 });
    root.dispatchPointerEvent('up', { x: 100, y: 150 });
    expect(calls).toEqual(['in', 'out']);
    // clean tap on the same tree still presses
    calls.length = 0;
    root.dispatchPointerEvent('down', { x: 100, y: 100 });
    root.dispatchPointerEvent('up', { x: 100, y: 100 });
    expect(calls).toEqual(['in', 'out', 'press']);
    root.unmount();
  });

  test('an active pan claim wins over an ancestor ScrollView', async () => {
    const root = createTestRoot(200, 200);
    const { handler } = makeRecorder();
    let scrollY = -1;
    root.render(
      <ScrollView
        style={{ width: 200, height: 200 }}
        onScroll={(e) => {
          scrollY = e.nativeEvent.contentOffset.y;
        }}
      >
        <View style={{ width: 200, height: 300 }} {...({ __panHandler: handler } as object)} />
        <View style={{ width: 200, height: 300 }} />
      </ScrollView>
    );
    await root.flush();
    root.dispatchPointerEvent('down', { x: 100, y: 50 });
    root.dispatchPointerEvent('move', { x: 100, y: 20 });
    root.dispatchPointerEvent('move', { x: 100, y: 5 });
    root.dispatchPointerEvent('up', { x: 100, y: 5 });
    expect(scrollY).toBe(-1); // scroll never engaged; the pan owned the drag
    root.unmount();
  });

  test('pointercancel reaches the pan handler as onCancel', async () => {
    const root = createTestRoot(200, 200);
    const { events, handler } = makeRecorder();
    root.render(<View style={{ flex: 1 }} {...({ __panHandler: handler } as object)} />);
    await root.flush();
    root.dispatchPointerEvent('down', { x: 10, y: 10 });
    root.dispatchPointerEvent('move', { x: 10, y: 60 });
    root.dispatchPointerEvent('cancel', { x: 10, y: 60 });
    expect(events.map((e) => e.kind)).toEqual(['down', 'move', 'cancel']);
    root.unmount();
  });

  test('host instances expose measure() with frame and page coordinates', async () => {
    const root = createTestRoot(300, 300);
    const ref = React.createRef<{
      measure(cb: (x: number, y: number, w: number, h: number, px: number, py: number) => void): void;
    }>();
    root.render(
      <View style={{ flex: 1, paddingTop: 40, paddingLeft: 20 }}>
        <View {...({ ref, style: { width: 120, height: 60 } } as object)} />
      </View>
    );
    await root.flush();
    const measured = await new Promise<number[]>((resolve) => {
      ref.current!.measure((x, y, w, h, px, py) => resolve([x, y, w, h, px, py]));
    });
    expect(measured).toEqual([20, 40, 120, 60, 20, 40]);
    root.unmount();
  });
});
