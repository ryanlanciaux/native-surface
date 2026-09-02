import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const VIRTUAL_ID = 'virtual:design-plane';
const RESOLVED_ID = '\0virtual:design-plane';
const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const UI_ENTRY = join(PACKAGE_ROOT, 'src/ui/main.tsx');

function planeHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Design plane</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/@fs${UI_ENTRY}"></script>
  </body>
</html>
`;
}

function virtualModule(hostRoot) {
  const plane = join(hostRoot, '.native-surface/plane.tsx');
  const wrapper = join(hostRoot, '.native-surface/wrapper.tsx');
  const hasPlane = existsSync(plane);
  const hasWrapper = existsSync(wrapper);
  const lines = [
    hasPlane
      ? `export { routes } from ${JSON.stringify(plane)};`
      : 'export const routes = [];',
    hasWrapper
      ? `export { Wrapper } from ${JSON.stringify(wrapper)};`
      : 'export function Wrapper(props) { return props.children; }',
  ];
  return lines.join('\n');
}

/**
 * Vite plugin: `/plane` canvas + `virtual:design-plane` from
 * `.native-surface/plane.tsx` and `wrapper.tsx` in `hostRoot`.
 */
export function designPlane({ hostRoot }) {
  if (!hostRoot) throw new Error('designPlane() needs { hostRoot }');
  const html = planeHtml();
  return {
    name: 'native-surface-design-plane',
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : null;
    },
    load(id) {
      if (id !== RESOLVED_ID) return null;
      const plane = join(hostRoot, '.native-surface/plane.tsx');
      const wrapper = join(hostRoot, '.native-surface/wrapper.tsx');
      if (existsSync(plane)) this.addWatchFile(plane);
      if (existsSync(wrapper)) this.addWatchFile(wrapper);
      return virtualModule(hostRoot);
    },
    config: () => ({
      server: { fs: { allow: [PACKAGE_ROOT, hostRoot] } },
    }),
    configureServer(server) {
      server.watcher.add(join(hostRoot, '.native-surface'));
      const onFs = (file) => {
        if (!file.replace(/\\/g, '/').includes('/.native-surface/')) return;
        const mod = server.moduleGraph.getModuleById(RESOLVED_ID);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: 'full-reload' });
      };
      server.watcher.on('add', onFs);
      server.watcher.on('unlink', onFs);
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0];
        if (url !== '/plane' && url !== '/plane/') return next();
        res.setHeader('content-type', 'text/html; charset=utf-8');
        res.end(html);
      });
    },
  };
}

