import { describe, expect, test } from 'vitest';
import * as React from 'react';
import { View } from '../src/components/primitives';
import { createTestRoot, findNode } from './helpers';

describe('layout', () => {
  test('column flow with margins and fixed sizes', async () => {
    const root = createTestRoot(200, 300);
    root.render(
      <View style={{ flex: 1, padding: 10 }}>
        <View testID="a" style={{ width: 50, height: 40 }} />
        <View testID="b" style={{ width: 60, height: 30, marginTop: 5 }} />
      </View>
    );
    await root.flush();
    const tree = root.getLayoutTree();
    const outer = tree.children[0]!;
    expect(outer.frame).toEqual({ x: 0, y: 0, width: 200, height: 300 });
    const [a, b] = outer.children;
    expect(a!.frame).toEqual({ x: 10, y: 10, width: 50, height: 40 });
    expect(b!.frame).toEqual({ x: 10, y: 55, width: 60, height: 30 });
    root.unmount();
  });

  test('row with flexGrow and gap', async () => {
    const root = createTestRoot(320, 100);
    root.render(
      <View style={{ flexDirection: 'row', gap: 20, width: 320, height: 100 }}>
        <View style={{ flexGrow: 1, height: 100 }} />
        <View style={{ flexGrow: 2, height: 100 }} />
      </View>
    );
    await root.flush();
    const row = root.getLayoutTree().children[0]!;
    const [a, b] = row.children;
    expect(a!.frame.width).toBe(100);
    expect(b!.frame.x).toBe(120);
    expect(b!.frame.width).toBe(200);
    root.unmount();
  });

  test('percentage sizes and absolute positioning', async () => {
    const root = createTestRoot(400, 200);
    root.render(
      <View style={{ flex: 1 }}>
        <View testID="half" style={{ width: '50%', height: '25%' }} />
        <View testID="abs" style={{ position: 'absolute', right: 10, bottom: 10, width: 40, height: 40 }} />
      </View>
    );
    await root.flush();
    const outer = root.getLayoutTree().children[0]!;
    expect(outer.children[0]!.frame).toEqual({ x: 0, y: 0, width: 200, height: 50 });
    expect(outer.children[1]!.frame).toEqual({ x: 350, y: 150, width: 40, height: 40 });
    root.unmount();
  });

  test('aspectRatio and alignment', async () => {
    const root = createTestRoot(300, 300);
    root.render(
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: 100, aspectRatio: 2 }} />
      </View>
    );
    await root.flush();
    const box = root.getLayoutTree().children[0]!.children[0]!;
    expect(box.frame.width).toBe(100);
    expect(box.frame.height).toBe(50);
    expect(box.frame.x).toBe(100);
    expect(box.frame.y).toBe(125);
    root.unmount();
  });

  test('flexWrap with row gap', async () => {
    const root = createTestRoot(250, 300);
    root.render(
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, width: 250 }}>
        {[0, 1, 2].map((i) => (
          <View key={i} testID={`cell${i}`} style={{ width: 100, height: 60 }} />
        ))}
      </View>
    );
    await root.flush();
    const row = root.getLayoutTree().children[0]!;
    expect(row.children[0]!.frame).toMatchObject({ x: 0, y: 0 });
    expect(row.children[1]!.frame).toMatchObject({ x: 110, y: 0 });
    expect(row.children[2]!.frame).toMatchObject({ x: 0, y: 70 });
    root.unmount();
  });

  test('style updates relayout', async () => {
    const root = createTestRoot(200, 200);
    function App({ wide }: { wide: boolean }): React.JSX.Element {
      return (
        <View style={{ flex: 1 }}>
          <View testID="box" style={{ width: wide ? 180 : 90, height: 20 }} />
        </View>
      );
    }
    root.render(<App wide={false} />);
    await root.flush();
    expect(root.getLayoutTree().children[0]!.children[0]!.frame.width).toBe(90);
    root.render(<App wide={true} />);
    await root.flush();
    expect(root.getLayoutTree().children[0]!.children[0]!.frame.width).toBe(180);
    root.unmount();
  });

  test('onLayout fires with frame and only on change', async () => {
    const root = createTestRoot(200, 200);
    const events: Array<{ width: number; height: number }> = [];
    root.render(
      <View style={{ flex: 1 }}>
        <View
          style={{ width: 120, height: 44 }}
          onLayout={(e) => events.push({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
        />
      </View>
    );
    await root.flush();
    await root.flush();
    expect(events).toEqual([{ width: 120, height: 44 }]);
    root.unmount();
  });

  test('display none removes from layout', async () => {
    const root = createTestRoot(200, 200);
    root.render(
      <View style={{ flex: 1 }}>
        <View style={{ width: 50, height: 50, display: 'none' }} />
        <View testID="visible" style={{ width: 50, height: 50 }} />
      </View>
    );
    await root.flush();
    const outer = root.getLayoutTree().children[0]!;
    expect(outer.children[1]!.frame.y).toBe(0);
    root.unmount();
  });

  test('findNode helper works via testID-free structure', async () => {
    const root = createTestRoot(100, 100);
    root.render(<View style={{ width: 30, height: 30 }} />);
    await root.flush();
    expect(findNode(root.getLayoutTree(), (n) => n.frame.width === 30)).toBeTruthy();
    root.unmount();
  });
});
