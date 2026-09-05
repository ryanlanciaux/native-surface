import { describe, expect, it } from 'vitest';
import {
  clampZoom,
  DEFAULT_FRAME,
  fitRect,
  hitNode,
  hitPath,
  jumpId,
  frameBigEnough,
  frameLive,
  layoutFrames,
  layoutGroups,
  layoutWrap,
  MAX_LIVE,
  MAX_ZOOM,
  MIN_ZOOM,
  pickLive,
  routeIdFromHash,
  screenToWorld,
  worldView,
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

describe('virtualize', () => {
  it('wraps frames onto the next row', () => {
    const frames = layoutWrap(
      [{ width: 100, height: 10 }, { width: 100, height: 10 }, { width: 100, height: 10 }],
      { gap: 10, wrapWidth: 220 }
    );
    expect(frames.map((f) => [f.x, f.y])).toEqual([[0, 0], [110, 0], [0, 20]]);
  });

  it('unmounts frames outside the overscanned view', () => {
    const view = worldView(0, 0, 1, 200, 200, 0);
    expect(frameLive({ x: 0, y: 0, width: 50, height: 50 }, view)).toBe(true);
    expect(frameLive({ x: 500, y: 0, width: 50, height: 50 }, view)).toBe(false);
  });
});

describe('layoutGroups', () => {
  it('puts variants of one screen in a row under a header', () => {
    const { frames, boxes } = layoutGroups(
      [
        { title: 'Home', items: [{ width: 100, height: 50 }, { width: 100, height: 50 }] },
        { title: 'Profile', items: [{ width: 80, height: 40 }] },
      ],
      { gap: 10, groupGap: 20, header: 20 }
    );
    expect(boxes.map((b) => b.title)).toEqual(['Home', 'Profile']);
    expect(frames[0]).toEqual({ x: 0, y: 20, width: 100, height: 50 });
    expect(frames[1]).toEqual({ x: 110, y: 20, width: 100, height: 50 });
    expect(frames[2]?.y).toBe(20 + 50 + 20 + 20);
  });

  it('uses fallback size for items without width/height', () => {
    const { frames } = layoutGroups([{ title: 'A', items: [{}] }], {
      fallback: { width: 390, height: 844 },
      header: 0,
    });
    expect(frames[0]).toEqual({ x: 0, y: 0, width: 390, height: 844 });
  });
});

describe('route hash', () => {
  it('reads /plane#/<route-id>', () => {
    expect(routeIdFromHash('#/home')).toBe('home');
    expect(routeIdFromHash('#/a%2Fb')).toBe('a/b');
    expect(routeIdFromHash('#/')).toBeNull();
    expect(routeIdFromHash('')).toBeNull();
    expect(routeIdFromHash('#story/home')).toBeNull();
  });
});

describe('live size + cap', () => {
  it('keeps DEFAULT_FRAME at 390×720', () => {
    expect(DEFAULT_FRAME).toEqual({ width: 390, height: 720 });
  });

  it('parks frames smaller than min CSS px', () => {
    expect(frameBigEnough({ width: 80, height: 80 }, 1)).toBe(true);
    expect(frameBigEnough({ width: 79, height: 80 }, 1)).toBe(false);
    expect(frameBigEnough({ width: 390, height: 720 }, 0.1)).toBe(false);
    expect(frameBigEnough({ width: 390, height: 720 }, 0.3)).toBe(true);
  });

  it('parks overlapping frames that are too small on screen', () => {
    const view = { x: 0, y: 0, width: 1000, height: 1000 };
    const live = pickLive([{ id: 'a', frame: { x: 0, y: 0, width: 390, height: 720 } }], view, 0.1);
    expect(live.size).toBe(0);
  });

  it('does not live-mount off-screen frames even if under cap', () => {
    const view = { x: 0, y: 0, width: 200, height: 200 };
    const live = pickLive(
      [
        { id: 'on', frame: { x: 0, y: 0, width: 100, height: 100 } },
        { id: 'off', frame: { x: 500, y: 0, width: 100, height: 100 } },
      ],
      view,
      1
    );
    expect([...live]).toEqual(['on']);
  });

  it('picks nearest to view center when capped', () => {
    const view = { x: 0, y: 0, width: 100, height: 100 };
    const live = pickLive(
      [
        { id: 'far', frame: { x: 0, y: 0, width: 40, height: 40 } },
        { id: 'near', frame: { x: 30, y: 30, width: 40, height: 40 } },
      ],
      view,
      1,
      { max: 1, minPx: 10 }
    );
    expect([...live]).toEqual(['near']);
  });

  it('keeps at most MAX_LIVE concurrent surfaces', () => {
    const view = { x: 0, y: 0, width: 2000, height: 2000 };
    const frames = Array.from({ length: 20 }, (_, i) => ({
      id: String(i),
      frame: { x: i * 10, y: 0, width: 100, height: 100 },
    }));
    expect(pickLive(frames, view, 1).size).toBe(MAX_LIVE);
  });
});
