/**
 * `getLayoutTree()` must describe what is ON SCREEN, not just what Yoga
 * decided.
 *
 * The tree is the only introspection surface this engine has: e2e drivers
 * locate a node in it and synthesize a press at the frame's center, and every
 * debugging dump reads it. But the engine PAINTS through `transform`, and the
 * hit path (engine/events.ts) inverts those same transforms — so a node moved
 * by a translate was reported at a position it is nowhere near, a driver aimed
 * at empty space, and a layout dump quietly disagreed with the screen. That is
 * exactly the class of bug the tree exists to make visible, and it was the one
 * class it could not show.
 *
 * So a node carries `painted` whenever the composed transform moves it, and
 * the load-bearing assertion here is that `painted` and the hit path agree:
 * a press at the painted center lands on the node.
 */
import { describe, expect, it } from 'vitest';
import { Pressable, ScrollView, View } from '../src/index';
import { createTestRoot, findNode } from './helpers';

describe('getLayoutTree: painted position', () => {
  it('omits `painted` when nothing is transformed', async () => {
    // An untransformed tree must serialize exactly as it did before this
    // existed — `painted` is a signal, not noise on every node.
    const root = createTestRoot(300, 300);
    root.render(<View testID="plain" style={{ width: 50, height: 50, marginTop: 10 }} />);
    await root.flush();
    const n = findNode(root.getLayoutTree(), (x) => x.testID === 'plain')!;
    expect(n.frame).toEqual({ x: 0, y: 10, width: 50, height: 50 });
    expect(n.painted).toBeUndefined();
    root.unmount();
  });

  it('reports where a translated node is, and carries the transform to children', async () => {
    const root = createTestRoot(300, 300);
    root.render(
      <View testID="moved" style={{ width: 100, height: 100, transform: [{ translateY: -200 }, { translateX: 20 }] }}>
        <View testID="child" style={{ width: 10, height: 10, marginTop: 5 }} />
      </View>
    );
    await root.flush();
    const tree = root.getLayoutTree();
    const moved = findNode(tree, (x) => x.testID === 'moved')!;
    const child = findNode(tree, (x) => x.testID === 'child')!;
    // `frame` still answers "where did Yoga put it" — unchanged.
    expect(moved.frame).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    expect(moved.painted).toEqual({ x: 20, y: -200, width: 100, height: 100 });
    // The child has no transform of its own and still moves with its ancestor.
    expect(child.frame).toEqual({ x: 0, y: 5, width: 10, height: 10 });
    expect(child.painted).toEqual({ x: 20, y: -195, width: 10, height: 10 });
    root.unmount();
  });

  it('agrees with the hit path: a press at the painted center lands', async () => {
    const root = createTestRoot(300, 300);
    let pressed = false;
    root.render(
      <Pressable
        testID="target"
        onPress={() => {
          pressed = true;
        }}
        style={{ width: 60, height: 60, transform: [{ translateY: 150 }] }}
      />
    );
    await root.flush();
    const p = findNode(root.getLayoutTree(), (x) => x.testID === 'target')!.painted!;
    root.dispatchPointerEvent('down', { x: p.x + p.width / 2, y: p.y + p.height / 2 });
    root.dispatchPointerEvent('up', { x: p.x + p.width / 2, y: p.y + p.height / 2 });
    await root.flush();
    expect(pressed).toBe(true);
    root.unmount();
  });

  it('scales about the center, and calls a rotation what it is', async () => {
    const root = createTestRoot(300, 300);
    root.render(
      <View style={{ paddingTop: 100 }}>
        <View testID="scaled" style={{ width: 100, height: 100, transform: [{ scale: 2 }] }} />
        <View testID="turned" style={{ width: 100, height: 100, transform: [{ rotate: '45deg' }] }} />
      </View>
    );
    await root.flush();
    const tree = root.getLayoutTree();
    expect(findNode(tree, (x) => x.testID === 'scaled')!.painted).toEqual({ x: -50, y: 50, width: 200, height: 200 });
    // A rotated box has no honest axis-aligned rectangle: the answer is the
    // bounding box, and it says so rather than pretending otherwise.
    const turned = findNode(tree, (x) => x.testID === 'turned')!.painted!;
    expect(turned.rotated).toBe(true);
    expect(turned.width).toBeCloseTo(Math.SQRT2 * 100, 3);
    root.unmount();
  });

  it('does not double-count a scroll offset', async () => {
    // Scroll is already subtracted from `frame` by the tree walk. It must not
    // also land in the transform chain, or a scrolled node reports twice the
    // offset and every driver misses it.
    const root = createTestRoot(200, 200);
    root.render(
      <ScrollView testID="sv" style={{ width: 200, height: 200 }}>
        <View testID="row" style={{ height: 60 }} />
        <View testID="row2" style={{ height: 60 }} />
        <View style={{ height: 600 }} />
      </ScrollView>
    );
    await root.flush();
    root.dispatchPointerEvent('wheel', { x: 100, y: 100, deltaX: 0, deltaY: 100 });
    await root.flush();
    const row2 = findNode(root.getLayoutTree(), (n) => n.testID === 'row2')!;
    expect(row2.painted).toBeUndefined();
    expect(row2.frame.y).toBeLessThan(60);
    root.unmount();
  });

  it('composes a transform inside a scrolled container', async () => {
    const root = createTestRoot(200, 200);
    root.render(
      <ScrollView style={{ width: 200, height: 200 }}>
        <View style={{ height: 60 }} />
        <View testID="moved" style={{ height: 60, transform: [{ translateY: -30 }] }} />
        <View style={{ height: 600 }} />
      </ScrollView>
    );
    await root.flush();
    const moved = findNode(root.getLayoutTree(), (n) => n.testID === 'moved')!;
    expect(moved.frame.y).toBe(60);
    expect(moved.painted).toEqual({ x: 0, y: 30, width: 200, height: 60 });
    root.unmount();
  });
});
