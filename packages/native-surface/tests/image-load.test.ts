import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureEngine, loadImage, type ImageEntry } from '../src/engine/init';

/** onSettled is the only completion signal loadImage exposes (fresh loads and cache hits alike). */
function load(uri: string): Promise<ImageEntry> {
  return new Promise((resolve) => void loadImage(uri, resolve));
}

// Smallest valid PNG (1x1 transparent) — exercises the real CanvasKit decoder.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

const spyOnWarn = () => vi.spyOn(console, 'warn').mockImplementation(() => {});

describe('loadImage failure diagnostics', () => {
  let warn: ReturnType<typeof spyOnWarn>;
  const firstWarn = () => String(warn.mock.calls[0]?.[0]);

  // Warm the engine with the real fetch in place: tests below stub fetch, and
  // loadImage awaits ensureEngine() mid-load.
  beforeAll(() => ensureEngine());

  beforeEach(() => {
    warn = spyOnWarn();
  });

  afterEach(() => {
    warn.mockRestore();
    vi.unstubAllGlobals();
  });

  it('warns once with the uri on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })));
    const uri = 'https://img.test/missing.png';
    const entry = await load(uri);
    expect(entry).toMatchObject({ status: 'error', error: 'HTTP 404' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(firstWarn()).toContain(uri);
    expect(firstWarn()).toContain('HTTP 404');
  });

  it('hints at CORS when fetch itself rejects', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      })
    );
    const entry = await load('https://cdn.test/cors.png');
    expect(entry).toMatchObject({ status: 'error', error: 'Failed to fetch' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(firstWarn()).toContain('Access-Control-Allow-Origin');
  });

  it('calls out SVG as unsupported when decoding a .svg uri fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<svg xmlns="http://www.w3.org/2000/svg"/>', { status: 200, headers: { 'content-type': 'image/svg+xml' } }))
    );
    const entry = await load('https://img.test/logo.svg');
    expect(entry.status).toBe('error');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(firstWarn()).toContain('SVG is not a supported encoding');
  });

  it('detects SVG by Content-Type when the uri has no extension', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<svg xmlns="http://www.w3.org/2000/svg"/>', { status: 200, headers: { 'content-type': 'image/svg+xml; charset=utf-8' } }))
    );
    const entry = await load('https://img.test/asset/12345');
    expect(entry.status).toBe('error');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(firstWarn()).toContain('SVG is not a supported encoding');
  });

  it('does not warn again when the same failed uri is requested twice', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })));
    const uri = 'https://img.test/repeat.png';
    await load(uri);
    expect(warn).toHaveBeenCalledTimes(1);
    const entry = await load(uri);
    expect(entry.status).toBe('error');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('stays silent on a successful load', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(PNG_1X1, { status: 200, headers: { 'content-type': 'image/png' } })));
    const entry = await load('https://img.test/ok.png');
    expect(entry.status).toBe('loaded');
    expect(warn).not.toHaveBeenCalled();
  });
});
