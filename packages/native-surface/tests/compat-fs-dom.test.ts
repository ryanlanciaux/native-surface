// @vitest-environment jsdom
/**
 * Storage/media compat pack, DOM half: the two shims whose whole implementation
 * IS a browser API.
 *
 * media-library's only real capability is handing the user a file, so the test
 * is that an `<a download>` really is created, pointed at a blob the shim
 * minted itself, clicked, and revoked — plus the honest fallback when the
 * source cannot be read into a blob at all.
 *
 * image-manipulator draws for real, but jsdom ships no 2D rasterizer (its
 * `getContext('2d')` returns null), so a pixel assertion is not available
 * here. Instead the canvas context and `toBlob` are stubbed as recorders and
 * the REAL pipeline runs over them: the recorded draw calls are the action
 * composition order and the exact source/destination rectangles each action
 * computed, which is the part of the module that can actually be wrong. Pixel
 * fidelity is left to the browser's own rasterizer.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { __resetFileSystem, cacheDirectory, Paths, writeAsStringAsync } from '../../compat/src/file-system';
import * as MediaLibrary from '../../compat/src/media-library';
import { FlipType, ImageManipulator, manipulateAsync, SaveFormat } from '../../compat/src/image-manipulator';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface AnchorClick {
  href: string;
  download: string;
}

function recordAnchorClicks(): AnchorClick[] {
  const clicks: AnchorClick[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicks.push({ href: this.href, download: this.download });
  });
  return clicks;
}

function recordObjectUrls(): { created: Blob[]; revoked: string[] } {
  const created: Blob[] = [];
  const revoked: string[] = [];
  // jsdom does not always expose these; define before spying so the spy sticks.
  const target = URL as unknown as Record<string, unknown>;
  target.createObjectURL ??= () => '';
  target.revokeObjectURL ??= () => {};
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob: Blob | MediaSource) => {
    created.push(blob as Blob);
    return `blob:http://localhost/${created.length}`;
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url: string) => void revoked.push(url));
  return { created, revoked };
}

/** Lets the `setTimeout(..., 0)` that defers revocation past the click run. */
function flushTimers(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

interface DrawOp {
  op: string;
  args: number[];
  /** Dimensions of the source canvas/bitmap a draw sampled from. */
  from?: string;
}

/**
 * A recording 2D context plus a toBlob that answers with the requested type.
 * The real action pipeline runs over these, so every recorded rectangle is one
 * the shim computed.
 */
function installCanvasRecorder(): DrawOp[] {
  const ops: DrawOp[] = [];
  const context = {
    imageSmoothingEnabled: false,
    imageSmoothingQuality: 'low',
    fillStyle: '',
    drawImage: (source: { width: number; height: number }, ...args: number[]) =>
      void ops.push({ op: 'drawImage', from: `${source.width}x${source.height}`, args }),
    translate: (x: number, y: number) => void ops.push({ op: 'translate', args: [x, y] }),
    rotate: (radians: number) => void ops.push({ op: 'rotate', args: [radians] }),
    scale: (x: number, y: number) => void ops.push({ op: 'scale', args: [x, y] }),
    fillRect: (...args: number[]) => void ops.push({ op: 'fillRect', args }),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => context) as never);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(((
    callback: BlobCallback,
    type?: string
  ) => callback(new Blob(['encoded'], { type: type ?? 'image/png' }))) as never);
  return ops;
}

function stubImageSource(width: number, height: number): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, blob: async () => new Blob(['source']) }))
  );
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width, height, close: () => {} }))
  );
}

beforeEach(() => {
  __resetFileSystem();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  __resetFileSystem();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// media-library
// ---------------------------------------------------------------------------

describe('media-library compat shim: saving is a download', () => {
  test('saveToLibraryAsync clicks an <a download> pointing at a blob it minted itself', async () => {
    const clicks = recordAnchorClicks();
    const urls = recordObjectUrls();
    await writeAsStringAsync(`${cacheDirectory}shot.png`, 'pixels');

    await MediaLibrary.saveToLibraryAsync(`${cacheDirectory}shot.png`);

    expect(clicks).toHaveLength(1);
    expect(clicks[0]?.download).toBe('shot.png');
    expect(clicks[0]?.href).toBe('blob:http://localhost/1');
    // The blob carries the file's own bytes and mime type, not the uri.
    expect(urls.created).toHaveLength(1);
    expect(urls.created[0]?.type).toBe('image/png');
    expect(await urls.created[0]?.text()).toBe('pixels');
    // The anchor is transient: nothing is left in the document.
    expect(document.querySelectorAll('a')).toHaveLength(0);

    await flushTimers();
    expect(urls.revoked).toEqual(['blob:http://localhost/1']);
  });

  test("saving a caller's object URL revokes only the shim's own copy", async () => {
    const clicks = recordAnchorClicks();
    const urls = recordObjectUrls();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      }))
    );

    await MediaLibrary.saveToLibraryAsync('blob:http://localhost/caller-owned');
    await flushTimers();

    expect(clicks[0]?.href).toBe('blob:http://localhost/1');
    // The caller's uri is never passed to revokeObjectURL.
    expect(urls.revoked).toEqual(['blob:http://localhost/1']);
    expect(urls.revoked).not.toContain('blob:http://localhost/caller-owned');
  });

  test('createAssetAsync downloads and describes what it handed over', async () => {
    recordAnchorClicks();
    recordObjectUrls();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 640, height: 480, close: () => {} }))
    );
    await writeAsStringAsync(`${cacheDirectory}photo.jpg`, 'jpeg bytes');

    const asset = await MediaLibrary.createAssetAsync(`${cacheDirectory}photo.jpg`);

    expect(asset).toBeInstanceOf(MediaLibrary.Asset);
    expect(asset.filename).toBe('photo.jpg');
    expect(asset.uri).toBe(`${cacheDirectory}photo.jpg`);
    expect(asset.width).toBe(640);
    expect(asset.height).toBe(480);
    // The legacy field speaks the legacy vocabulary; the class API's getter its own.
    expect(asset.mediaType).toBe(MediaLibrary.MediaType.photo);
    expect(await asset.getMediaType()).toBe(MediaLibrary.MediaType.IMAGE);
    // ...and it is a description, not a handle: the "library" is still empty.
    expect(await asset.getAlbums()).toEqual([]);
    expect(await MediaLibrary.getAssetsAsync()).toMatchObject({ assets: [], totalCount: 0 });
  });

  test('an unreadable source falls back to a raw anchor and says why', async () => {
    const clicks = recordAnchorClicks();
    recordObjectUrls();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      })
    );

    await MediaLibrary.saveToLibraryAsync('https://cdn.example.test/no-cors.jpg');

    expect(clicks[0]?.href).toBe('https://cdn.example.test/no-cors.jpg');
    expect(warn.mock.calls.flat().join(' ')).toMatch(/cross-origin without CORS/);
  });
});

// ---------------------------------------------------------------------------
// image-manipulator
// ---------------------------------------------------------------------------

describe('image-manipulator compat shim: action composition', () => {
  test('actions compose in array order, each sampling the previous result', async () => {
    const ops = installCanvasRecorder();
    recordObjectUrls();
    stubImageSource(100, 200);

    const result = await manipulateAsync(
      'https://example.test/source.png',
      [{ resize: { width: 50 } }, { crop: { originX: 0, originY: 0, width: 20, height: 10 } }],
      { format: SaveFormat.PNG }
    );

    expect(ops.filter((op) => op.op === 'drawImage')).toEqual([
      // Decoded source painted onto its own canvas.
      { op: 'drawImage', from: '100x200', args: [0, 0, 100, 200] },
      // resize: only a width was given, so the height follows the 1:2 ratio.
      { op: 'drawImage', from: '100x200', args: [0, 0, 100, 200, 0, 0, 50, 100] },
      // crop: samples the RESIZED canvas, proving the order held.
      { op: 'drawImage', from: '50x100', args: [0, 0, 20, 10, 0, 0, 20, 10] },
      // renderAsync copies the final canvas so saveAsync can re-encode it.
      { op: 'drawImage', from: '20x10', args: [0, 0] },
    ]);
    expect(result).toMatchObject({ uri: 'blob:http://localhost/2', width: 20, height: 10 });
    expect(result.base64).toBeUndefined();
  });

  test('reversing the actions reverses the geometry', async () => {
    const ops = installCanvasRecorder();
    recordObjectUrls();
    stubImageSource(100, 200);

    const result = await manipulateAsync(
      'https://example.test/source.png',
      [{ crop: { originX: 10, originY: 20, width: 40, height: 40 } }, { resize: { width: 20 } }],
      { format: SaveFormat.PNG }
    );

    expect(ops.filter((op) => op.op === 'drawImage')).toEqual([
      { op: 'drawImage', from: '100x200', args: [0, 0, 100, 200] },
      // crop first, off the full-size source
      { op: 'drawImage', from: '100x200', args: [10, 20, 40, 40, 0, 0, 40, 40] },
      // then resize the 40x40 crop: square, so height follows width
      { op: 'drawImage', from: '40x40', args: [0, 0, 40, 40, 0, 0, 20, 20] },
      { op: 'drawImage', from: '20x20', args: [0, 0] },
    ]);
    expect(result).toMatchObject({ width: 20, height: 20 });
  });

  test('rotate sizes the canvas to the rotated bounding box', async () => {
    const ops = installCanvasRecorder();
    recordObjectUrls();
    stubImageSource(100, 200);

    const result = await manipulateAsync('https://example.test/source.png', [{ rotate: 90 }], {
      format: SaveFormat.PNG,
    });

    expect(ops.map((op) => op.op)).toEqual(['drawImage', 'translate', 'rotate', 'drawImage', 'drawImage']);
    // Origin moves to the centre of the NEW canvas, which is the 200x100 box.
    expect(ops[1]).toEqual({ op: 'translate', args: [100, 50] });
    expect(ops[2]?.args[0]).toBeCloseTo(Math.PI / 2);
    expect(ops[3]).toEqual({ op: 'drawImage', from: '100x200', args: [-50, -100, 100, 200] });
    expect(result).toMatchObject({ width: 200, height: 100 });
  });

  test('flip mirrors on the requested axis only', async () => {
    const ops = installCanvasRecorder();
    recordObjectUrls();
    stubImageSource(100, 200);

    await manipulateAsync('https://example.test/source.png', [{ flip: FlipType.Horizontal }], {
      format: SaveFormat.PNG,
    });
    expect(ops.find((op) => op.op === 'scale')).toEqual({ op: 'scale', args: [-1, 1] });

    ops.length = 0;
    await manipulateAsync('https://example.test/source.png', [{ flip: FlipType.Vertical }], {
      format: SaveFormat.PNG,
    });
    expect(ops.find((op) => op.op === 'scale')).toEqual({ op: 'scale', args: [1, -1] });
  });

  test('extent fills the new frame and offsets a negative origin into it', async () => {
    const ops = installCanvasRecorder();
    recordObjectUrls();
    stubImageSource(100, 200);

    const result = await manipulateAsync(
      'https://example.test/source.png',
      [{ extent: { width: 120, height: 200, originX: -10, backgroundColor: '#ffffff' } }],
      { format: SaveFormat.PNG }
    );

    expect(ops.find((op) => op.op === 'fillRect')).toEqual({ op: 'fillRect', args: [0, 0, 120, 200] });
    // A negative originX shifts the DESTINATION right rather than sampling
    // outside the source, so sx stays 0 and dx becomes 10.
    expect(ops.filter((op) => op.op === 'drawImage')[1]).toEqual({
      op: 'drawImage',
      from: '100x200',
      args: [0, 0, 100, 200, 10, 0, 100, 200],
    });
    expect(result).toMatchObject({ width: 120, height: 200 });
  });

  test('the contextual API chains the same pipeline and saveAsync can emit base64', async () => {
    const ops = installCanvasRecorder();
    recordObjectUrls();
    stubImageSource(100, 200);

    const context = ImageManipulator.manipulate('https://example.test/source.png')
      .resize({ width: 50 })
      .flip(FlipType.Horizontal);
    const image = await context.renderAsync();

    expect(image.width).toBe(50);
    expect(image.height).toBe(100);
    expect(image.uri).toBe('blob:http://localhost/1');

    const saved = await image.saveAsync({ format: SaveFormat.PNG, base64: true, compress: 0.8 });
    expect(saved).toMatchObject({ uri: 'blob:http://localhost/2', width: 50, height: 100 });
    // 'encoded' is what the stubbed encoder produced.
    expect(Buffer.from(saved.base64 ?? '', 'base64').toString()).toBe('encoded');
    expect(ops.filter((op) => op.op === 'drawImage')).toHaveLength(4);

    // reset() drops the queued transformations and re-loads the source.
    const reset = await context.reset().renderAsync();
    expect(reset.width).toBe(100);
    expect(reset.height).toBe(200);
  });

  test('a format the browser cannot encode is reported, not silently substituted', async () => {
    installCanvasRecorder();
    recordObjectUrls();
    stubImageSource(10, 10);
    // A browser without WEBP support answers toBlob with a PNG.
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(((callback: BlobCallback) =>
      callback(new Blob(['png'], { type: 'image/png' }))) as never);

    await expect(
      manipulateAsync('https://example.test/source.png', [], { format: SaveFormat.WEBP })
    ).rejects.toThrow(/cannot encode "image\/webp".*produced "image\/png"/);
  });

  test('a tainted canvas is reported as the CORS problem it is', async () => {
    installCanvasRecorder();
    recordObjectUrls();
    stubImageSource(10, 10);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((() => {
      throw Object.assign(new Error('Tainted canvases may not be exported.'), { name: 'SecurityError' });
    }) as never);

    await expect(manipulateAsync('https://example.test/source.png', [])).rejects.toThrow(
      /tainted by a cross-origin source/
    );
  });

  test('a source the browser refuses to fetch names CORS rather than failing blank', async () => {
    installCanvasRecorder();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      })
    );
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 1, height: 1, close: () => {} }))
    );

    await expect(manipulateAsync('https://cdn.example.test/no-cors.png', [])).rejects.toThrow(
      /Access-Control-Allow-Origin/
    );
  });
});

describe('file-system compat shim in a DOM realm', () => {
  test('the virtual filesystem persists into the page localStorage namespace', async () => {
    await writeAsStringAsync(`${cacheDirectory}dom.txt`, 'from jsdom');
    expect(localStorage.getItem('rn-file-system:f:/native-surface/cache/dom.txt')).toContain('"data"');
    expect(Paths.cache.list().map((entry) => entry.name)).toEqual(['dom.txt']);
  });
});
