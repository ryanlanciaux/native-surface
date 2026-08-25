/**
 * Environment seam. Everything above this module is environment-free: the
 * engine core never touches the DOM or Node APIs directly, which is what lets
 * the full pipeline run in vitest (Node) and the browser identically.
 */
import type { CanvasKit } from 'canvaskit-wasm';

export interface LoadedFont {
  family: string;
  data: ArrayBuffer;
  weight: number;
  italic?: boolean;
}

export const isNode: boolean =
  typeof process !== 'undefined' && !!(process as { versions?: { node?: string } }).versions?.node && typeof window === 'undefined';

export async function loadCanvasKit(wasmUrlOverride?: string): Promise<CanvasKit> {
  if (isNode) {
    const { createRequire } = await import(/* @vite-ignore */ 'node' + ':module');
    const require = createRequire(import.meta.url);
    const CanvasKitInit = require('canvaskit-wasm/bin/canvaskit.js') as (opts: {
      locateFile: (f: string) => string;
    }) => Promise<CanvasKit>;
    const wasmPath =
      wasmUrlOverride ?? (require.resolve('canvaskit-wasm/bin/canvaskit.js') as string).replace(/canvaskit\.js$/, 'canvaskit.wasm');
    return CanvasKitInit({ locateFile: () => wasmPath });
  }
  const mod = await import('./assets.browser');
  return mod.loadCanvasKitBrowser(wasmUrlOverride);
}

export async function loadDefaultFonts(): Promise<LoadedFont[]> {
  if (isNode) {
    const fs = await import(/* @vite-ignore */ 'node' + ':fs');
    const entries: Array<[string, number]> = [
      ['Inter-Regular.otf', 400],
      ['Inter-Medium.otf', 500],
      ['Inter-SemiBold.otf', 600],
      ['Inter-Bold.otf', 700],
    ];
    return entries.map(([file, weight]) => {
      const url = new URL(`../../assets/fonts/${file}`, import.meta.url);
      const buf = fs.readFileSync(url);
      return { family: 'Inter', data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), weight };
    });
  }
  const mod = await import('./assets.browser');
  return mod.loadDefaultFontsBrowser();
}

/** rAF in the browser, setImmediate-ish in Node. */
export function scheduleFrame(cb: () => void): () => void {
  if (!isNode && typeof requestAnimationFrame === 'function') {
    const id = requestAnimationFrame(() => cb());
    return () => cancelAnimationFrame(id);
  }
  const id = setTimeout(cb, 0);
  return () => clearTimeout(id);
}

export function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
