import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { Image, View } from '../src/index';
import { ensureEngine, getImageCacheStats, loadImage, type ImageEntry } from '../src/engine/init';
import { createTestRoot } from './helpers';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);
const entryOf = (uri: string): Promise<ImageEntry> => new Promise((r) => void loadImage(uri, r));

/**
 * The LRU cannot reclaim a RETAINED image, so a reference that is never
 * released makes its entry immortal and the cache unbounded — which ends in
 * CanvasKit exhausting its WASM heap and calling abort(). That surfaces as
 * `RuntimeError: Aborted()`, uncatchable and naming nothing, so the invariant
 * has to be held here instead: when a node goes away, its reference goes with
 * it, on every path INCLUDING the async one.
 */
describe('image ref accounting across unmount', () => {
  beforeAll(() => ensureEngine());
  afterEach(() => vi.unstubAllGlobals());

  it('a node unmounted WHILE ITS IMAGE IS LOADING must not leave a ref behind', async () => {
    // Hold the fetch open so the node is destroyed mid-load, then release it.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        await gate;
        return new Response(PNG_1X1, { status: 200 });
      })
    );

    const uri = 'https://img.test/inflight.png';
    const root = createTestRoot(100, 100);
    root.render(
      <View>
        <Image source={{ uri }} style={{ width: 10, height: 10 }} />
      </View>
    );
    await root.flush();

    // Unmount before the bytes arrive, then let the load finish.
    root.unmount();
    release();
    const entry = await entryOf(uri);

    expect(entry.status).toBe('loaded');
    // refs must be 0: nothing displays this image any more, so the LRU has to
    // be able to evict it. A stuck ref makes the entry immortal.
    expect((entry as { refs: number }).refs).toBe(0);
  });

  it('a node unmounted AFTER its image loaded releases its ref too', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(PNG_1X1, { status: 200 })));
    const uri = 'https://img.test/settled.png';
    const root = createTestRoot(100, 100);
    root.render(
      <View>
        <Image source={{ uri }} style={{ width: 10, height: 10 }} />
      </View>
    );
    await root.flush();
    const loaded = await entryOf(uri);
    expect((loaded as { refs: number }).refs).toBeGreaterThan(0);

    root.unmount();
    expect((loaded as { refs: number }).refs).toBe(0);
  });

  it('destroy is idempotent — freeing a WASM handle twice aborts the runtime', async () => {
    const root = createTestRoot(100, 100);
    let node: { destroy(): void; destroyed: boolean } | null = null;
    root.render(
      <View
        ref={(n) => {
          node = n as never;
        }}
        style={{ width: 10, height: 10 }}
      />
    );
    await root.flush();
    expect(node).not.toBeNull();

    node!.destroy();
    expect(node!.destroyed).toBe(true);
    // A second free of the same yoga node would not throw — it would abort the
    // whole WASM runtime, so this must be a no-op rather than a repeat.
    expect(() => node!.destroy()).not.toThrow();
    root.unmount();
  });

  it('reports cache occupancy, so a leak is diagnosable before the heap dies', async () => {
    const stats = getImageCacheStats();
    expect(stats.size).toBeGreaterThanOrEqual(stats.retained);
    expect(stats).toHaveProperty('loading');
  });
});
