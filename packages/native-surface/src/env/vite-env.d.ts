declare module '*.wasm?url' {
  const url: string;
  export default url;
}
declare module '*.otf?url' {
  const url: string;
  export default url;
}
declare module 'canvaskit-wasm/bin/canvaskit.js' {
  import type { CanvasKitInitOptions, CanvasKit } from 'canvaskit-wasm';
  const init: (opts?: CanvasKitInitOptions) => Promise<CanvasKit>;
  export default init;
}
declare module 'canvaskit-wasm/bin/canvaskit.wasm?url' {
  const url: string;
  export default url;
}
