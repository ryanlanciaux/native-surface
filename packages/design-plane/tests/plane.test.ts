import { describe, expect, it } from 'vitest';
import {
  clampZoom,
  fitRect,
  hitNode,
  hitPath,
  jumpId,
  layoutFrames,
  MAX_ZOOM,
  MIN_ZOOM,
  screenToWorld,
  zoomAt,
  type HitNode,
} from '../src/plane';

function node(partial: Partial<HitNode> & { type: string }): HitNode {
  return {
    frame: { x: 0, y: 0, width: 100, height: 100 },
    children: [],
    ...partial,
  };
}

describe('hitPath', () => {
  const tree = node({
    type: 'View',
    testID: 'home',
    children: [
      node({
        type: 'Pressable',
        testID: 'profile',
        frame: { x: 10, y: 10, width: 40, height: 20 },
        children: [node({ type: 'Text', text: 'Open', frame: { x: 12, y: 12, width: 30, height: 16 } })],
      }),
    ],
  });

  it('returns the deepest node under the point', () => {
    const path = hitPath(tree, 20, 15);
    expect(path.map((n) => n.type)).toEqual(['View', 'Pressable', 'Text']);
    expect(hitNode(tree, 20, 15)?.text).toBe('Open');
  });

  it('misses outside the tree', () => {
    expect(hitPath(tree, 400, 400)).toEqual([]);
  });

  it('prefers painted over frame', () => {
    const moved = node({
      type: 'View',
      frame: { x: 0, y: 0, width: 10, height: 10 },
      painted: { x: 50, y: 50, width: 10, height: 10 },
      children: [],
    });
    expect(hitNode(moved, 5, 5)).toBeNull();
    expect(hitNode(moved, 55, 55)?.type).toBe('View');
  });
});

describe('jumpId', () => {
  it('picks the innermost matching testID', () => {
    const path = [
      node({ type: 'View', testID: 'home' }),
      node({ type: 'Pressable', testID: 'profile' }),
      node({ type: 'Text' }),
    ];
    expect(jumpId(path, ['home', 'profile'])).toBe('profile');
    expect(jumpId(path, ['home'])).toBe('home');
    expect(jumpId(path, ['other'])).toBeNull();
  });
});

describe('layout + camera', () => {
  it('lays frames out in a row', () => {
    const frames = layoutFrames([{ width: 100, height: 10 }, { width: 50, height: 10 }], 20);
    expect(frames).toEqual([
      { x: 0, y: 0, width: 100, height: 10 },
      { x: 120, y: 0, width: 50, height: 10 },
    ]);
  });

  it('zooms about the cursor', () => {
    const next = zoomAt(100, 100, 0, 0, 1, 2);
    expect(next.zoom).toBe(2);
    const world = screenToWorld(100, 100, next.panX, next.panY, next.zoom);
    expect(world).toEqual({ x: 100, y: 100 });
  });

  it('clamps zoom', () => {
    expect(clampZoom(0)).toBe(MIN_ZOOM);
    expect(clampZoom(99)).toBe(MAX_ZOOM);
  });

  it('fits a rect in the viewport', () => {
    const cam = fitRect({ x: 0, y: 0, width: 200, height: 100 }, 400, 400, 0);
    expect(cam.zoom).toBe(2);
    expect(cam.panX).toBe(0);
    expect(cam.panY).toBe(100);
  });
});
