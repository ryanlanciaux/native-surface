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

export async function loadDefaultFontsBrowser(): Promise<LoadedFont[]> {
  const entries: Array<[string, number]> = [
    [interRegular, 400],
    [interMedium, 500],
    [interSemiBold, 600],
    [interBold, 700],
  ];
  return Promise.all(
    entries.map(async ([url, weight]) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`native-surface: failed to load bundled font ${url}: ${res.status}`);
      return { family: 'Inter', data: await res.arrayBuffer(), weight };
    })
  );
}
