/**
 * The engine's env seam (src/env/index) forced onto its Node loaders, for the
 * tests that run under jsdom.
 *
 * jsdom supplies a `window`, so the real module decides it is in a browser and
 * tries to fetch CanvasKit's wasm and the Inter fonts over HTTP. Every jsdom
 * test needs the same override, so it lives here rather than being pasted into
 * each one.
 *
 * Use it as the (hoisted, therefore lazy) vi.mock factory:
 *
 *   vi.mock('../src/env/index', async () => (await import('./nodeEnvMock')).nodeEnvMock());
 */
export async function nodeEnvMock() {
  const { createRequire } = await import('node:module');
  const fs = await import('node:fs');
  const path = await import('node:path');
  // import.meta.url is unreliable under the jsdom environment — anchor on the
  // package dir instead (vitest runs with the package as cwd; the workspace
  // root is the fallback).
  const pkgDir = [process.cwd(), path.join(process.cwd(), 'packages/native-surface')].find((d) =>
    fs.existsSync(path.join(d, 'assets/fonts'))
  )!;
  const req = createRequire(path.join(pkgDir, 'package.json'));
  return {
    isNode: true,
    loadCanvasKit: async () => {
      const CanvasKitInit = req('canvaskit-wasm/bin/canvaskit.js') as (opts: {
        wasmBinary: Uint8Array;
      }) => Promise<unknown>;
      const buf = fs.readFileSync(
        req.resolve('canvaskit-wasm/bin/canvaskit.js').replace(/canvaskit\.js$/, 'canvaskit.wasm')
      );
      return CanvasKitInit({ wasmBinary: new Uint8Array(buf) });
    },
    loadDefaultFonts: async () => {
      const entries: Array<[string, number]> = [
        ['Inter-Regular.otf', 400],
        ['Inter-Medium.otf', 500],
        ['Inter-SemiBold.otf', 600],
        ['Inter-Bold.otf', 700],
      ];
      return entries.map(([file, weight]) => {
        const buf = fs.readFileSync(path.join(pkgDir, 'assets/fonts', file));
        return { family: 'Inter', data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), weight };
      });
    },
    scheduleFrame: (cb: () => void) => {
      const id = setTimeout(cb, 0);
      return () => clearTimeout(id);
    },
    now: () => Date.now(),
  };
}
