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
        for (const f of extra) {
          eng.fontProvider.registerFont(f.data, f.family);
          eng.families.add(f.family);
        }
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
      for (const f of fonts) {
        // TextInput's DOM overlay renders in the page, not on the canvas —
        // register the same bytes as a document font so the two match.
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
    if (e.status === 'loaded') e.image.delete();
  }
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
      imageCache.set(uri, { status: 'loaded', image, refs: 0 });
      return image;
    } catch (err) {
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
