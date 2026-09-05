/**
 * Browser (Vite) asset resolution. Only ever imported from the browser branch
 * of env/index.ts — never under Node/vitest.
 */
import CanvasKitInit from 'canvaskit-wasm/bin/canvaskit.js';
import ckWasmUrl from 'canvaskit-wasm/bin/canvaskit.wasm?url';
import interRegular from '../../assets/fonts/Inter-Regular.otf?url';
import interMedium from '../../assets/fonts/Inter-Medium.otf?url';
import interSemiBold from '../../assets/fonts/Inter-SemiBold.otf?url';
import interBold from '../../assets/fonts/Inter-Bold.otf?url';
import type { CanvasKit } from 'canvaskit-wasm';
import type { LoadedFont } from './index';

export async function loadCanvasKitBrowser(wasmUrlOverride?: string): Promise<CanvasKit> {
  const url = wasmUrlOverride ?? ckWasmUrl;
  return (CanvasKitInit as (opts: { locateFile: (f: string) => string }) => Promise<CanvasKit>)({
    locateFile: () => url,
  });
}

/** Pinned Noto COLRv1 (~5MB). Skia/CanvasKit paints COLR; the CBDT
 *  `NotoColorEmoji.ttf` often registers cmap coverage but still tofu's. */
const EMOJI_URL =
  'https://cdn.jsdelivr.net/gh/googlefonts/noto-emoji@v2.047/fonts/Noto-COLRv1.ttf';
const COLOR_EMOJI_FAMILY = 'Noto Color Emoji';

async function loadEmojiFont(): Promise<LoadedFont | null> {
  try {
    const res = await fetch(EMOJI_URL, {
      signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(15_000) : undefined,
    });
    if (!res.ok) return null;
    return { family: COLOR_EMOJI_FAMILY, data: await res.arrayBuffer(), weight: 400 };
  } catch {
    return null; // CORS / offline / timeout — Inter still loads
  }
}

export async function loadDefaultFontsBrowser(): Promise<LoadedFont[]> {
  const entries: Array<[string, number]> = [
    [interRegular, 400],
    [interMedium, 500],
    [interSemiBold, 600],
    [interBold, 700],
  ];
  const [inter, emoji] = await Promise.all([
    Promise.all(
      entries.map(async ([url, weight]) => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`native-surface: failed to load bundled font ${url}: ${res.status}`);
        return { family: 'Inter', data: await res.arrayBuffer(), weight };
      })
    ),
    loadEmojiFont(),
  ]);
  return emoji ? [...inter, emoji] : inter;
}
