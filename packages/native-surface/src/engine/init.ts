import { Errata, loadYoga } from 'yoga-layout/load';
import type { Config, Yoga } from 'yoga-layout/load';
import type { CanvasKit, TypefaceFontProvider, Image as CKImage } from 'canvaskit-wasm';
import { loadCanvasKit, loadDefaultFonts, type LoadedFont } from '../env/index';
import type { InitOptions } from '../types';

export interface Engine {
  ck: CanvasKit;
  yoga: Yoga;
  /** Shared node config matching React Native's Yoga setup (Errata.All). */
  yogaConfig: Config;
  fontProvider: TypefaceFontProvider;
  /** Families registered with the provider (for diagnostics). */
  families: Set<string>;
}

let engine: Engine | null = null;
let initPromise: Promise<Engine> | null = null;
const pendingFonts: LoadedFont[] = [];

export function getEngine(): Engine {
  if (!engine) {
    throw new Error(
      'native-surface: engine not initialized. Rendering entry points await initEngine() internally; ' +
        'if you hit this, something used the engine synchronously before the first flush.'
    );
  }
  return engine;
}

export function getEngineIfReady(): Engine | null {
  return engine;
}

async function resolveFontSpecs(specs: NonNullable<InitOptions['fonts']>): Promise<LoadedFont[]> {
  const out: LoadedFont[] = [];
  for (const spec of specs) {
    let data = spec.data;
    if (!data && spec.url) {
      const res = await fetch(spec.url);
      if (!res.ok) throw new Error(`native-surface: failed to fetch font ${spec.url}: ${res.status}`);
      data = await res.arrayBuffer();
    }
    if (data) out.push({ family: spec.family, data, weight: spec.weight ?? 400, italic: spec.style === 'italic' });
  }
  return out;
}

/**
 * Single registration path for every font, whenever it arrives (initial load
 * or post-init, e.g. expo-font's lazy loadAsync). TextInput's DOM overlay
 * renders in the page, not on the canvas — register the same bytes as a
 * document font so the two match.
 */
function registerEngineFont(fontProvider: TypefaceFontProvider, families: Set<string>, f: LoadedFont): void {
  if (typeof document !== 'undefined' && typeof FontFace !== 'undefined') {
    try {
      const face = new FontFace(f.family, f.data.slice(0));
      document.fonts.add(face);
      void face.load().catch(() => {});
    } catch {
      /* overlay falls back to the CSS stack */
    }
  }
  fontProvider.registerFont(f.data, f.family);
  families.add(f.family);
}

let warnedYogaUrl = false;

export function ensureEngine(opts?: InitOptions): Promise<Engine> {
  if (opts?.yogaWasmUrl && !warnedYogaUrl) {
    warnedYogaUrl = true;
    console.warn(
      'native-surface: InitOptions.yogaWasmUrl has no effect — yoga-layout 3.x inlines its WASM binary and exposes no URL hook.'
    );
  }
  if (initPromise) {
    // Engine already initializing/initialized: a later call may still register
    // additional fonts (initEngine is idempotent, not first-call-wins for fonts).
    if (opts?.fonts?.length) {
      const fonts = opts.fonts;
      return initPromise.then(async (eng) => {
        const extra = await resolveFontSpecs(fonts);
        for (const f of extra) registerEngineFont(eng.fontProvider, eng.families, f);
        return eng;
      });
    }
    return initPromise;
  }
  initPromise = (async () => {
    const [ck, yoga, defaultFonts] = await Promise.all([loadCanvasKit(opts?.canvasKitWasmUrl), loadYoga(), loadDefaultFonts()]);
    if (typeof ck.ParagraphBuilder?.MakeFromFontProvider !== 'function') {
      throw new Error('native-surface: loaded CanvasKit build lacks the Paragraph API; use the default or full build of canvaskit-wasm');
    }
    const fontProvider = ck.TypefaceFontProvider.Make();
    const families = new Set<string>();
    const registerAll = (fonts: LoadedFont[]) => {
      for (const f of fonts) registerEngineFont(fontProvider, families, f);
    };
    registerAll(defaultFonts);

    if (opts?.fonts) registerAll(await resolveFontSpecs(opts.fonts));
    registerAll(pendingFonts);
    pendingFonts.length = 0;

    // Match React Native's Yoga configuration: RN creates its nodes with
    // errata = All (legacy stretch behaviour among others). Parity with the
    // on-device layout engine is the whole point of this renderer.
    const yogaConfig = yoga.Config.create();
    yogaConfig.setErrata(Errata.All);

    engine = { ck, yoga, yogaConfig, fontProvider, families };
    return engine;
  })();
  // A failed init must not poison every later attempt (transient WASM/font
  // fetch errors): reset so the next ensureEngine() retries from scratch.
  initPromise = initPromise.catch((err) => {
    initPromise = null;
    throw err;
  });
  return initPromise;
}

export function initEngine(opts?: InitOptions): Promise<void> {
  return ensureEngine(opts).then(() => undefined);
}

// ---------------------------------------------------------------------------
// Image cache (uri -> decoded CanvasKit image)
// ---------------------------------------------------------------------------

export type ImageEntry =
  | { status: 'loading'; promise: Promise<CKImage | null> }
  | { status: 'loaded'; image: CKImage; refs: number }
  | { status: 'error'; error: string };

/** Called by nodes when they stop displaying an entry (uri change / destroy). */
export function releaseImageEntry(entry: ImageEntry | null): void {
  if (entry && entry.status === 'loaded' && entry.refs > 0) entry.refs--;
}

export function retainImageEntry(entry: ImageEntry | null): void {
  if (entry && entry.status === 'loaded') entry.refs++;
}

const IMAGE_CACHE_MAX = 64;
const imageCache = new Map<string, ImageEntry>();

// URIs whose failure was already reported. The cache dedupes repeat loads,
// but error entries can be evicted (LRU) and re-fetched — warn once per uri,
// not once per attempt.
const warnedImageUris = new Set<string>();

/**
 * How far past the cap the cache may grow on retained entries alone before we
 * say something. Exceeding the cap is legitimate — a long feed can genuinely
 * display more than IMAGE_CACHE_MAX images at once, and evicting one still on
 * screen would blank it — so this is deliberately generous.
 */
const RETAINED_LEAK_FACTOR = 4;
let warnedRetainedLeak = false;

/** Move-to-end on access; evict (and .delete()) least-recently-used settled entries. */
function touchImageEntry(uri: string, entry: ImageEntry): void {
  imageCache.delete(uri);
  imageCache.set(uri, entry);
  if (imageCache.size <= IMAGE_CACHE_MAX) return;
  for (const [key, e] of imageCache) {
    if (imageCache.size <= IMAGE_CACHE_MAX) break;
    if (e.status === 'loading') continue; // never evict in-flight loads
    if (e.status === 'loaded' && e.refs > 0) continue; // still displayed by a node
    imageCache.delete(key);
    // An evicted pixel key must be re-registered by its producer (loadImage
    // would otherwise wait forever for an insert that is not coming).
    pixelKeys.delete(key);
    if (e.status === 'loaded') e.image.delete();
  }

  /**
   * Nothing above can reclaim a RETAINED entry, so a reference that is never
   * released makes its image immortal and the cache unbounded. That ends in
   * CanvasKit exhausting its WASM heap and calling `abort()` — surfacing as
   * `RuntimeError: Aborted()`, which is not catchable and names nothing.
   *
   * One warning, so the failure has a cause attached before the runtime dies.
   */
  if (!warnedRetainedLeak && imageCache.size > IMAGE_CACHE_MAX * RETAINED_LEAK_FACTOR) {
    warnedRetainedLeak = true;
    let retained = 0;
    for (const e of imageCache.values()) if (e.status === 'loaded' && e.refs > 0) retained++;
    console.warn(
      `native-surface: image cache holds ${imageCache.size} entries (${retained} still referenced) ` +
        `against a cap of ${IMAGE_CACHE_MAX}. Retained entries cannot be evicted, so this grows until ` +
        `CanvasKit aborts. If the app is not really displaying that many images at once, a node is ` +
        `holding a reference it never released.`
    );
  }
}

/** Test/diagnostic seam: cache occupancy and how much of it is unreclaimable. */
export function getImageCacheStats(): { size: number; retained: number; loading: number } {
  let retained = 0;
  let loading = 0;
  for (const e of imageCache.values()) {
    if (e.status === 'loading') loading++;
    else if (e.status === 'loaded' && e.refs > 0) retained++;
  }
  return { size: imageCache.size, retained, loading };
}

// ---------------------------------------------------------------------------
// Raw-pixel image registration (blurhash/thumbhash placeholders, generated
// bitmaps). Entries live in the same cache under a synthetic uri key, with
// the same refcount/eviction semantics as fetched entries.
// ---------------------------------------------------------------------------

// Keys claimed by putImagePixels. A synthetic key is not fetchable: loadImage
// waits for the pixel insert instead of fetching it, and a fetch already in
// flight when the claim lands must not clobber (or warn about) the pixel entry.
const pixelKeys = new Set<string>();
const pixelWaiters = new Map<string, { promise: Promise<void>; resolve: () => void }>();

/** Resolves once the claimed key's insert has settled (loaded or error). */
function waitForPixelInsert(key: string): Promise<void> {
  const existing = pixelWaiters.get(key);
  if (existing) return existing.promise;
  const e = imageCache.get(key);
  if (e && e.status !== 'loading') return Promise.resolve();
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  pixelWaiters.set(key, { promise, resolve });
  return promise;
}

function settlePixelWaiters(key: string): void {
  const w = pixelWaiters.get(key);
  if (!w) return;
  pixelWaiters.delete(key);
  w.resolve();
}

/**
 * True when `key` currently resolves to a decoded image in the cache — an
 * Image mounted with that uri paints immediately, no load or decode needed.
 * Useful to skip re-decoding before putImagePixels; false also after the LRU
 * evicts an unreferenced entry, in which case the producer must re-register.
 */
export function hasImage(key: string): boolean {
  return imageCache.get(key)?.status === 'loaded';
}

/**
 * Register unpremultiplied sRGB RGBA pixels under `key`: any Image whose
 * source uri equals the key paints them through the normal cache path.
 *
 * The key is an arbitrary synthetic uri chosen by the caller (compat layers
 * use namespaced ones like `blurhash:<hash>@32x32`); it shares the fetched
 * images' cache, so pick keys that cannot collide with real uris. The entry
 * gets identical refcount/eviction semantics to a fetched entry: nodes
 * displaying it hold refs, and once unreferenced it can be LRU-evicted —
 * after which the key must be re-registered before its next use (a stale
 * mount without re-registration degrades to the normal fetch-error path).
 * Registering an already-registered key replaces the entry; nodes still
 * painting the old pixels keep them until their source changes.
 *
 * Safe to call before the engine is ready (the insert queues on init, and a
 * concurrent load of the key waits for it); callers that need a paint-ready
 * guarantee should `await initEngine()` first — once the engine is up the
 * insert is synchronous.
 */
export function putImagePixels(
  key: string,
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number
): void {
  pixelKeys.add(key); // claim synchronously: concurrent loadImage(key) must wait, not fetch
  const insert = (eng: Engine) => {
    const image = eng.ck.MakeImage(
      {
        width,
        height,
        colorType: eng.ck.ColorType.RGBA_8888,
        alphaType: eng.ck.AlphaType.Unpremul,
        colorSpace: eng.ck.ColorSpace.SRGB,
      },
      pixels,
      width * 4
    );
    const prev = imageCache.get(key);
    if (!image) {
      imageCache.set(key, { status: 'error', error: 'MakeImage returned null' });
      if (!warnedImageUris.has(key)) {
        warnedImageUris.add(key);
        console.warn(
          `native-surface: putImagePixels(${key}): MakeImage returned null (${width}x${height} wants ${width * height * 4} RGBA bytes, got ${pixels.length}).`
        );
      }
    } else {
      touchImageEntry(key, { status: 'loaded', image, refs: 0 });
    }
    // Nodes still painting a replaced entry hold their own reference; the old
    // image is deleted only once nothing displays it.
    if (prev?.status === 'loaded' && prev.refs === 0) prev.image.delete();
    settlePixelWaiters(key);
  };
  const eng = getEngineIfReady();
  if (eng) insert(eng);
  else
    void ensureEngine().then(insert, () => {
      imageCache.set(key, { status: 'error', error: 'engine init failed' });
      settlePixelWaiters(key);
    });
}

export function loadImage(uri: string, onSettled: (entry: ImageEntry) => void): ImageEntry {
  const existing = imageCache.get(uri);
  if (existing) {
    touchImageEntry(uri, existing);
    if (existing.status === 'loading') existing.promise.then(() => onSettled(imageCache.get(uri) ?? existing));
    // Settled cache hit: onLoad/onError must still fire (async, like a real load).
    else queueMicrotask(() => onSettled(existing));
    return existing;
  }
  if (pixelKeys.has(uri)) {
    // Pixel-registered key whose insert hasn't landed yet (engine still
    // initializing): wait for it instead of fetching a synthetic uri.
    const promise = waitForPixelInsert(uri).then(() => {
      const e = imageCache.get(uri);
      return e?.status === 'loaded' ? e.image : null;
    });
    const entry: ImageEntry = { status: 'loading', promise };
    touchImageEntry(uri, entry);
    void promise.then(() => onSettled(imageCache.get(uri) ?? entry));
    return entry;
  }
  const promise = (async (): Promise<CKImage | null> => {
    // Which stage failed (and what the server called the payload) drives the
    // diagnostic below — neither survives into the Error we catch.
    let stage: 'fetch' | 'read' | 'decode' = 'fetch';
    let contentType: string | null = null;
    try {
      const res = await fetch(uri);
      stage = 'read';
      contentType = res.headers.get('content-type');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bytes = await res.arrayBuffer();
      const eng = await ensureEngine();
      stage = 'decode';
      const image = eng.ck.MakeImageFromEncoded(bytes);
      if (!image) throw new Error('unsupported image data');
      if (pixelKeys.has(uri)) {
        // putImagePixels claimed this key mid-fetch; it owns the cache slot.
        image.delete();
        await waitForPixelInsert(uri);
        const e = imageCache.get(uri);
        return e?.status === 'loaded' ? e.image : null;
      }
      imageCache.set(uri, { status: 'loaded', image, refs: 0 });
      return image;
    } catch (err) {
      if (pixelKeys.has(uri)) {
        // putImagePixels claimed this key while the fetch was in flight: the
        // synthetic uri was never fetchable — settle on the pixel entry
        // instead of recording (and warning about) a bogus failure.
        await waitForPixelInsert(uri);
        const e = imageCache.get(uri);
        return e?.status === 'loaded' ? e.image : null;
      }
      const message = err instanceof Error ? err.message : String(err);
      imageCache.set(uri, { status: 'error', error: message });
      if (!warnedImageUris.has(uri)) {
        warnedImageUris.add(uri);
        let hint = '';
        if (stage === 'fetch') {
          // fetch() itself rejected: network failure or a missing CORS header.
          hint =
            ' If the host is cross-origin it must send Access-Control-Allow-Origin: Skia decodes raw bytes via fetch(), ' +
            'not an <img> tag, so CORS blocks hosts an <img> would have displayed.';
        } else if (stage === 'decode' && (/\.svg([?#]|$)/i.test(uri) || (contentType ?? '').toLowerCase().includes('image/svg+xml'))) {
          hint = ' SVG is not a supported encoding (PNG/JPEG/WEBP/GIF only).';
        }
        console.warn(`native-surface: failed to load image ${uri}: ${message}.${hint}`);
      }
      return null;
    }
  })();
  const entry: ImageEntry = { status: 'loading', promise };
  touchImageEntry(uri, entry);
  promise.then(() => onSettled(imageCache.get(uri)!));
  return entry;
}
