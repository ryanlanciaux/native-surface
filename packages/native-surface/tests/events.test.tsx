import { describe, expect, test } from 'vitest';
import * as React from 'react';
import { Pressable, ScrollView, Text, View } from '../src/components/primitives';
import { createTestRoot, sleep } from './helpers';

describe('events', () => {
  test('tap fires onPressIn, onPress, onPressOut in order', async () => {
    const root = createTestRoot(200, 200);
    const calls: string[] = [];
    root.render(
      <View style={{ flex: 1 }}>
        <Pressable
          style={{ width: 100, height: 50 }}
          onPressIn={() => calls.push('in')}
          onPress={() => calls.push('press')}
          onPressOut={() => calls.push('out')}
        >
          <Text>Tap</Text>
        </Pressable>
      </View>
    );
    await root.flush();
    root.dispatchPointerEvent('down', { x: 50, y: 25 });
    root.dispatchPointerEvent('up', { x: 50, y: 25 });
    expect(calls).toEqual(['in', 'out', 'press']);
    root.unmount();
  });

  test('press outside bounds does nothing', async () => {
    const root = createTestRoot(200, 200);
    let pressed = 0;
    root.render(
      <View style={{ flex: 1 }}>
        <Pressable style={{ width: 100, height: 50 }} onPress={() => pressed++} />
      </View>
    );
    await root.flush();
    root.dispatchPointerEvent('down', { x: 150, y: 100 });
    root.dispatchPointerEvent('up', { x: 150, y: 100 });
    expect(pressed).toBe(0);
    root.unmount();
  });

  test('hitSlop expands the touch target', async () => {
    const root = createTestRoot(200, 200);
    let pressed = 0;
    root.render(
      <View style={{ flex: 1, padding: 50 }}>
        <Pressable style={{ width: 50, height: 50 }} hitSlop={20} onPress={() => pressed++} />
      </View>
    );
    await root.flush();
    // pressable occupies (50,50)-(100,100); slop extends to (30,30)-(120,120)
    root.dispatchPointerEvent('down', { x: 110, y: 110 });
    root.dispatchPointerEvent('up', { x: 110, y: 110 });
    expect(pressed).toBe(1);
    root.unmount();
  });

  test('moving off the pressable cancels the press', async () => {
    const root = createTestRoot(200, 200);
    const calls: string[] = [];
    root.render(
      <View style={{ flex: 1 }}>
        <Pressable
          style={{ width: 100, height: 50 }}
          onPressIn={() => calls.push('in')}
          onPress={() => calls.push('press')}
          onPressOut={() => calls.push('out')}
        />
      </View>
    );
    await root.flush();
    root.dispatchPointerEvent('down', { x: 50, y: 25 });
    root.dispatchPointerEvent('move', { x: 180, y: 150 });
    root.dispatchPointerEvent('up', { x: 180, y: 150 });
    expect(calls).toEqual(['in', 'out']);
    root.unmount();
  });

  test('disabled pressable ignores taps', async () => {
    const root = createTestRoot(200, 200);
    let pressed = 0;
    root.render(
      <View style={{ flex: 1 }}>
        <Pressable disabled style={{ width: 100, height: 50 }} onPress={() => pressed++} />
      </View>
    );
    await root.flush();
    root.dispatchPointerEvent('down', { x: 50, y: 25 });
    root.dispatchPointerEvent('up', { x: 50, y: 25 });
    expect(pressed).toBe(0);
    root.unmount();
  });

  test('long press fires onLongPress and suppresses onPress', async () => {
    const root = createTestRoot(200, 200);
    const calls: string[] = [];
    root.render(
      <View style={{ flex: 1 }}>
        <Pressable
          style={{ width: 100, height: 50 }}
          onPress={() => calls.push('press')}
          onLongPress={() => calls.push('long')}
        />
      </View>
    );
    await root.flush();
    root.dispatchPointerEvent('down', { x: 50, y: 25 });
    await sleep(600);
    root.dispatchPointerEvent('up', { x: 50, y: 25 });
    expect(calls).toEqual(['long']);
    root.unmount();
  });

  test('overlapping siblings: topmost (later/zIndex) wins', async () => {
    const root = createTestRoot(200, 200);
    const calls: string[] = [];
    root.render(
      <View style={{ flex: 1 }}>
        <Pressable
          style={{ position: 'absolute', top: 0, left: 0, width: 100, height: 100 }}
          onPress={() => calls.push('under')}
        />
        <Pressable
          style={{ position: 'absolute', top: 0, left: 0, width: 100, height: 100 }}
          onPress={() => calls.push('over')}
        />
      </View>
    );
    await root.flush();
    root.dispatchPointerEvent('down', { x: 50, y: 50 });
    root.dispatchPointerEvent('up', { x: 50, y: 50 });
    expect(calls).toEqual(['over']);
    root.unmount();
  });

  test('pointerEvents none skips subtree', async () => {
    const root = createTestRoot(200, 200);
    const calls: string[] = [];
    root.render(
      <View style={{ flex: 1 }}>
        <Pressable
          style={{ position: 'absolute', top: 0, left: 0, width: 100, height: 100 }}
          onPress={() => calls.push('under')}
        />
        <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, width: 100, height: 100 }} />
      </View>
    );
    await root.flush();
    root.dispatchPointerEvent('down', { x: 50, y: 50 });
    root.dispatchPointerEvent('up', { x: 50, y: 50 });
    expect(calls).toEqual(['under']);
    root.unmount();
  });

  test('wheel scroll moves content and clamps', async () => {
    const root = createTestRoot(200, 200);
    const offsets: number[] = [];
    root.render(
      <ScrollView
        style={{ width: 200, height: 200 }}
        onScroll={(e) => offsets.push(e.nativeEvent.contentOffset.y)}
      >
        {Array.from({ length: 10 }, (_, i) => (
          <View key={i} style={{ width: 200, height: 100 }} />
        ))}
      </ScrollView>
    );
    await root.flush();
    root.dispatchPointerEvent('wheel', { x: 100, y: 100, deltaY: 300 });
    expect(offsets.at(-1)).toBe(300);
    // clamp at max = contentHeight(1000) - viewport(200) = 800
    root.dispatchPointerEvent('wheel', { x: 100, y: 100, deltaY: 5000 });
    expect(offsets.at(-1)).toBe(800);
    // clamp at 0
    root.dispatchPointerEvent('wheel', { x: 100, y: 100, deltaY: -5000 });
    expect(offsets.at(-1)).toBe(0);
    root.unmount();
  });

  test('drag scroll cancels press and scrolls', async () => {
    const root = createTestRoot(200, 200);
    const calls: string[] = [];
    const offsets: number[] = [];
    root.render(
      <ScrollView style={{ width: 200, height: 200 }} onScroll={(e) => offsets.push(e.nativeEvent.contentOffset.y)}>
        {Array.from({ length: 10 }, (_, i) => (
          <Pressable
            key={i}
            style={{ width: 200, height: 100 }}
            onPress={() => calls.push(`press${i}`)}
            onPressIn={() => calls.push('in')}
            onPressOut={() => calls.push('out')}
          />
        ))}
      </ScrollView>
    );
    await root.flush();
    root.dispatchPointerEvent('down', { x: 100, y: 150 });
    root.dispatchPointerEvent('move', { x: 100, y: 100 }); // 50px up → scroll mode
    root.dispatchPointerEvent('move', { x: 100, y: 60 });
    root.dispatchPointerEvent('up', { x: 100, y: 60 });
    expect(calls).toEqual(['in', 'out']); // press cancelled, no onPress
    expect(offsets.at(-1)).toBeGreaterThan(0);
    root.unmount();
  });

  test('scroll offset shifts hit targets', async () => {
    const root = createTestRoot(200, 200);
    const calls: string[] = [];
    root.render(
      <ScrollView style={{ width: 200, height: 200 }}>
        {Array.from({ length: 10 }, (_, i) => (
          <Pressable key={i} style={{ width: 200, height: 100 }} onPress={() => calls.push(`row${i}`)} />
        ))}
      </ScrollView>
    );
    await root.flush();
    root.dispatchPointerEvent('wheel', { x: 100, y: 100, deltaY: 250 });
    await root.flush();
    // viewport y=50 now maps to content y=300 → row 3
    root.dispatchPointerEvent('down', { x: 100, y: 50 });
    root.dispatchPointerEvent('up', { x: 100, y: 50 });
    expect(calls).toEqual(['row3']);
    root.unmount();
  });

  test('onAction hook logs presses', async () => {
    const actions: string[] = [];
    const root = createTestRoot(200, 200, { onAction: (name) => actions.push(name) });
    root.render(
      <View style={{ flex: 1 }}>
        <Pressable style={{ width: 100, height: 50 }} onPress={() => {}} />
      </View>
    );
    await root.flush();
    root.dispatchPointerEvent('down', { x: 50, y: 25 });
    root.dispatchPointerEvent('up', { x: 50, y: 25 });
    expect(actions).toContain('onPress');
    root.unmount();
  });
});
