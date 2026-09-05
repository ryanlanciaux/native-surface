import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { ensureEngine, putImagePixels, hasImage } from '../src/engine/init';
import { Image as NsImage, View } from '../src/components/primitives';
import { Image, ImageBackground } from '../../compat/src/image';
import FastImage from '../../compat/src/image';
import { base64ToBytes, decodeBlurhash, isBlurhashString, thumbHashToRGBA } from '../../compat/src/blurhash';
import { asImpl, createTestRoot, sleep } from './helpers';

// The woltapp/blurhash reference example (green landscape under a blue sky).
const KNOWN_BLURHASH = 'LEHV6nWB2yk8pyo0adR*.7kCMdnj';

/** Encode a solid-color PNG through the real engine (same trick as fixes.test). */
async function makePng(w: number, h: number, color: string): Promise<Uint8Array> {
  const src = createTestRoot(w, h);
  src.render(<View style={{ width: w, height: h, backgroundColor: color }} />);
  await src.flush();
  const png = asImpl(src).encodePNG();
  src.unmount();
  return png;
}

const pngResponse = (png: Uint8Array) =>
  new Response(Buffer.from(png), { status: 200, headers: { 'content-type': 'image/png' } });

describe('expo-image compat', () => {
  // Warm the engine with the real fetch in place: tests below stub fetch, and
  // loadImage awaits ensureEngine() mid-load.
  beforeAll(() => ensureEngine());

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('decodes a known blurhash into plausible non-uniform opaque RGBA', () => {
    expect(isBlurhashString(KNOWN_BLURHASH)).toBe(true);
    expect(isBlurhashString('https://img.test/photo.png')).toBe(false);

    const px = decodeBlurhash(KNOWN_BLURHASH, 32, 32);
    expect(px.length).toBe(32 * 32 * 4);
    let allOpaque = true;
    for (let i = 3; i < px.length; i += 4) if (px[i] !== 255) allOpaque = false;
    expect(allOpaque).toBe(true);

    const topLeft = [px[0], px[1], px[2]];
    const brOffset = (31 * 32 + 31) * 4;
    const bottomRight = [px[brOffset], px[brOffset + 1], px[brOffset + 2]];
    expect(topLeft).not.toEqual(bottomRight); // sky vs ground: a gradient, not a flat fill
  });

  it('decodes thumbhash bytes to a dimensioned RGBA thumbnail', () => {
    const bytes = base64ToBytes('1QcSHQRnh493V4dIh4eXh1h4kJUI');
    const { w, h, rgba } = thumbHashToRGBA(bytes);
    expect(w).toBeGreaterThan(0);
    expect(h).toBeGreaterThan(0);
    expect(w).toBeLessThanOrEqual(32);
    expect(h).toBeLessThanOrEqual(32);
    expect(rgba.length).toBe(w * h * 4);
  });

  it('putImagePixels registers pixels an engine Image paints', async () => {
    const key = 'pixels:red-4x4';
    const px = new Uint8Array(4 * 4 * 4);
    for (let i = 0; i < px.length; i += 4) {
      px[i] = 255;
      px[i + 3] = 255;
    }
    putImagePixels(key, px, 4, 4);
    expect(hasImage(key)).toBe(true); // engine is up: the insert is synchronous

    const root = createTestRoot(40, 40);
    root.render(
      <View style={{ flex: 1, backgroundColor: '#ffffff' }}>
        <NsImage source={{ uri: key }} resizeMode="stretch" style={{ width: 40, height: 40 }} />
      </View>
    );
    await root.flush();
    await sleep(20);
    await root.flush();
    const p = asImpl(root).readPixel(20, 20);
    expect(p.r).toBeGreaterThan(200);
    expect(p.g).toBeLessThan(50);
    expect(p.b).toBeLessThan(50);
    root.unmount();
  });

  it('paints a fetched PNG source; contentFit "fill" stretches', async () => {
    const png = await makePng(8, 4, '#00a2ff');
    vi.stubGlobal('fetch', vi.fn(async () => pngResponse(png)));

    const root = createTestRoot(60, 60);
    root.render(
      <View style={{ flex: 1, backgroundColor: '#ffffff' }}>
        <Image source={{ uri: 'https://img.test/blue.png' }} contentFit="fill" style={{ width: 40, height: 40 }} />
      </View>
    );
    await root.flush();
    await sleep(30);
    await root.flush();
    const impl = asImpl(root);
    const center = impl.readPixel(20, 20);
    expect(center.b).toBeGreaterThan(180);
    expect(center.r).toBeLessThan(100);
    // fill stretches the 8x4 bitmap over the whole 40x40 box: the top strip is
    // image; contain would letterbox it to the white background instead.
    const top = impl.readPixel(20, 2);
    expect(top.b).toBeGreaterThan(180);
    expect(top.r).toBeLessThan(100);
    root.unmount();
  });

  it('paints the blurhash placeholder while the source is pending, the source after', async () => {
    const png = await makePng(8, 8, '#ff00ff');
    let releaseFetch!: () => void;
    const gate = new Promise<void>((r) => (releaseFetch = r));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        await gate;
        return pngResponse(png);
      })
    );

    const root = createTestRoot(40, 40);
    root.render(
      <View style={{ flex: 1, backgroundColor: '#ffffff' }}>
        <Image
          source={{ uri: 'https://img.test/slow.png' }}
          placeholder={{ blurhash: KNOWN_BLURHASH }}
          style={{ width: 40, height: 40 }}
        />
      </View>
    );
    await root.flush();
    await sleep(30); // placeholder decode + register + state flip
    await root.flush();
    const impl = asImpl(root);
    const pending = impl.readPixel(20, 20);
    const isWhite = pending.r > 240 && pending.g > 240 && pending.b > 240;
    const isMagenta = pending.r > 200 && pending.b > 200 && pending.g < 60;
    expect(isWhite).toBe(false); // blurhash underlay painted, not the background
    expect(isMagenta).toBe(false); // and definitely not the still-pending source

    releaseFetch();
    await sleep(30);
    await root.flush();
    const settled = impl.readPixel(20, 20);
    expect(settled.r).toBeGreaterThan(200);
    expect(settled.b).toBeGreaterThan(200);
    expect(settled.g).toBeLessThan(60);
    root.unmount();
  });

  it('FastImage maps resizeMode "contain" (letterboxes a wide bitmap)', async () => {
    const png = await makePng(8, 4, '#ff8800');
    vi.stubGlobal('fetch', vi.fn(async () => pngResponse(png)));

    expect(FastImage.resizeMode.contain).toBe('contain');
    expect(FastImage.priority.high).toBe('high');

    const root = createTestRoot(40, 40);
    root.render(
      <View style={{ flex: 1, backgroundColor: '#ffffff' }}>
        <FastImage source={{ uri: 'https://img.test/orange.png' }} resizeMode="contain" style={{ width: 40, height: 40 }} />
      </View>
    );
    await root.flush();
    await sleep(30);
    await root.flush();
    const impl = asImpl(root);
    const center = impl.readPixel(20, 20);
    expect(center.r).toBeGreaterThan(200); // orange band through the middle
    expect(center.b).toBeLessThan(80);
    const top = impl.readPixel(20, 2); // letterbox: background shows through
    expect(top.r).toBeGreaterThan(240);
    expect(top.g).toBeGreaterThan(240);
    expect(top.b).toBeGreaterThan(240);
    root.unmount();
  });

  it('fires onLoadStart → onLoad (with dimensions) → onLoadEnd; onError on failure', async () => {
    const png = await makePng(8, 4, '#123456');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown) =>
        String(url).includes('ok') ? pngResponse(png) : new Response('nope', { status: 404 })
      )
    );

    const events: string[] = [];
    let dims = { width: 0, height: 0 };
    const root = createTestRoot(40, 40);
    root.render(
      <Image
        source="https://img.test/ok.png"
        style={{ width: 20, height: 20 }}
        onLoadStart={() => events.push('start')}
        onLoad={(e) => {
          dims = { width: e.source.width, height: e.source.height };
          events.push('load');
        }}
        onLoadEnd={() => events.push('end')}
      />
    );
    await root.flush();
    await sleep(30);
    expect(events).toEqual(['start', 'load', 'end']);
    expect(dims).toEqual({ width: 8, height: 4 });
    root.unmount();

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onError = vi.fn();
    const root2 = createTestRoot(40, 40);
    root2.render(
      <Image source={{ uri: 'https://img.test/missing.png' }} style={{ width: 20, height: 20 }} onError={onError} />
    );
    await root2.flush();
    await sleep(30);
    expect(onError).toHaveBeenCalledWith({ error: 'HTTP 404' });
    warn.mockRestore();
    root2.unmount();
  });

  it('ImageBackground lays children out above the image', async () => {
    const png = await makePng(8, 8, '#00c853');
    vi.stubGlobal('fetch', vi.fn(async () => pngResponse(png)));

    const root = createTestRoot(40, 40);
    root.render(
      <View style={{ flex: 1, backgroundColor: '#ffffff' }}>
        <ImageBackground source={{ uri: 'https://img.test/green.png' }} style={{ width: 40, height: 40 }}>
          <View style={{ width: 10, height: 10, backgroundColor: '#000000' }} />
        </ImageBackground>
      </View>
    );
    await root.flush();
    await sleep(30);
    await root.flush();
    const impl = asImpl(root);
    const child = impl.readPixel(5, 5); // child overlays the image
    expect(child.r).toBeLessThan(30);
    expect(child.g).toBeLessThan(30);
    const bg = impl.readPixel(30, 30); // image shows elsewhere
    expect(bg.g).toBeGreaterThan(150);
    expect(bg.r).toBeLessThan(100);
    root.unmount();
  });

  it('fires onLoad with fallback size when getSize fails', async () => {
    const png = await makePng(8, 4, '#123456');
    vi.stubGlobal('fetch', vi.fn(async () => pngResponse(png)));
    const spy = vi.spyOn(NsImage, 'getSize').mockImplementation((_uri, _ok, fail) => {
      fail?.(new Error('nope'));
    });
    const onLoad = vi.fn();
    const root = createTestRoot(20, 20);
    root.render(<Image source="https://img.test/ok.png" style={{ width: 20, height: 20 }} onLoad={onLoad} />);
    await root.flush();
    await sleep(30);
    expect(onLoad).toHaveBeenCalledWith(
      expect.objectContaining({ source: expect.objectContaining({ url: 'https://img.test/ok.png', width: 1, height: 1 }) })
    );
    spy.mockRestore();
    root.unmount();
  });
});
