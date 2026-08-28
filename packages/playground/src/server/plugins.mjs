// The two host-facing Vite plugins behind `native-surface playground`:
// story discovery (virtual:host-stories) and the import-audit stub that turns
// unresolvable native imports into per-story errors instead of dead servers.
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { createStoryMatcher, findStoryFiles } from './glob.mjs';

const VIRTUAL_ID = 'virtual:host-stories';
const RESOLVED_ID = '\0virtual:host-stories';

/**
 * Serves `virtual:host-stories`: `{ hostMode: true, modules }` where modules
 * maps host-relative story paths to lazy importers. Watches the glob base
 * dirs; a story file appearing or disappearing invalidates the module and
 * full-reloads (content edits ride normal HMR through the import chain).
 */
export function hostStoriesPlugin({ hostRoot, globs }) {
  const matcher = createStoryMatcher(hostRoot, globs);
  return {
    name: 'native-surface-playground:host-stories',
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : null;
    },
    load(id) {
      if (id !== RESOLVED_ID) return null;
      const files = findStoryFiles(matcher);
      const entries = files.map((file) => {
        const key = relative(hostRoot, file).replace(/\\/g, '/');
        return `  ${JSON.stringify(key)}: () => import(${JSON.stringify(`/@fs${file}`)}),`;
      });
      return `export const hostMode = true;\nexport const modules = {\n${entries.join('\n')}\n};\n`;
    },
    configureServer(server) {
      for (const dir of matcher.baseDirs) server.watcher.add(dir);
      const onFsEvent = (file) => {
        if (!matcher.match(file)) return;
        const mod = server.moduleGraph.getModuleById(RESOLVED_ID);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: 'full-reload' });
      };
      server.watcher.on('add', onFsEvent);
      server.watcher.on('unlink', onFsEvent);
    },
  };
}

const STUB_PREFIX = '\0ns-stub:';

/** True for `pkg`, `@scope/pkg`, `pkg/deep` — not relative/absolute paths,
 *  rollup-virtual ids, or scheme-prefixed ids (virtual:, node:, data:). */
function isBareSpecifier(source) {
  if (source.startsWith('.') || source.startsWith('/') || source.startsWith('\0')) return false;
  if (/^[a-zA-Z][\w+.-]*:/.test(source)) return false;
  return true;
}

/**
 * ESM named imports are linked by the browser, so the stub must actually
 * export every name the importer asks for — best-effort lexed from the
 * importer's source. Namespace/dynamic imports need no names.
 */
export function namedImportsFrom(code, specifier) {
  const names = new Set();
  const spec = specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const clauseRe = new RegExp(`(?:import|export)\\s+([^;'"]+?)\\s*from\\s*(['"])${spec}\\2`, 'g');
  for (const match of code.matchAll(clauseRe)) {
    const clause = match[1];
    const braces = clause.match(/{([^}]*)}/);
    if (!braces) continue;
    for (const item of braces[1].split(',')) {
      // `type X`, `X as Y` → the EXPORTED name is X; `default as Y` is covered
      // by the default export.
      const name = item.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]?.trim();
      if (name && name !== 'default' && /^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  return [...names];
}

function stubModuleCode(specifier, names) {
  const message = `${specifier} has no web bridge yet (native-surface)`;
  return [
    `const __message = ${JSON.stringify(message)};`,
    // Props read by module interop / React's element machinery return
    // undefined instead of throwing, so the failure lands on USE (render,
    // call, method access), inside the story's error boundary.
    `const __safe = new Set(['then', '__esModule', '$$typeof', 'prototype', 'displayName', 'name', 'length', 'defaultProps', 'propTypes', 'contextTypes', 'isReactComponent', 'toJSON']);`,
    `function __fail() { throw new Error(__message); }`,
    `function __makeStub() {`,
    `  return new Proxy(function NativeSurfaceStub() { __fail(); }, {`,
    `    get(_target, prop) {`,
    `      if (typeof prop === 'symbol' || __safe.has(prop)) return undefined;`,
    `      __fail();`,
    `    },`,
    `    apply: __fail,`,
    `    construct: __fail,`,
    `  });`,
    `}`,
    `export default __makeStub();`,
    ...names.map((name) => `export const ${name} = __makeStub();`),
    '',
  ].join('\n');
}

/**
 * Post-resolver: any bare import nothing else could resolve becomes a stub
 * module whose default and named exports throw "<pkg> has no web bridge yet"
 * on use — the import itself succeeds, so the failure is per-story, not a
 * 500ing dev server. Every stub is recorded in `audit` (a Map the caller
 * owns) and served as JSON at /__ns_audit.
 */
export function importAuditPlugin({ hostRoot, audit }) {
  return {
    name: 'native-surface-playground:import-audit',
    enforce: 'post',
    resolveId(source, importer) {
      if (!importer || !isBareSpecifier(source)) return null;
      const importerFile = importer.split('?')[0];
      if (importerFile.includes('/.vite/')) return null;
      const shownImporter = importerFile.startsWith(hostRoot)
        ? relative(hostRoot, importerFile).replace(/\\/g, '/')
        : importerFile;
      const key = `${source}\0${shownImporter}`;
      if (!audit.has(key)) {
        audit.set(key, { specifier: source, importer: shownImporter, firstSeen: new Date().toISOString() });
      }
      return `${STUB_PREFIX}${source}\0${importerFile}`;
    },
    load(id) {
      if (!id.startsWith(STUB_PREFIX)) return null;
      const [specifier, importerFile] = id.slice(STUB_PREFIX.length).split('\0');
      let names = [];
      try {
        names = namedImportsFrom(readFileSync(importerFile, 'utf8'), specifier);
      } catch {
        // Importer unreadable (itself virtual): default + namespace still work.
      }
      return stubModuleCode(specifier, names);
    },
    configureServer(server) {
      server.middlewares.use('/__ns_audit', (_req, res) => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ entries: [...audit.values()] }));
      });
    },
  };
}
