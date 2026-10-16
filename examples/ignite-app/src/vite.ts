/**
 * native-surface adapter: the Vite half of what Ignite's Metro/Babel config
 * provides, scoped to this package's files so a host app's own aliases are
 * never touched.
 *
 *   import { igniteDemo } from 'ignite-demo/vite'
 *   plugins: [igniteDemo(), ...nativeSurface({ platform: 'ios' }), react(...)]
 *
 * List it BEFORE nativeSurface(): its `@assets/` rewrite then lands ahead of
 * the preset's require() hoist, which picks the @2x/@3x variants from the
 * relative path (after it, images still load, at 1x).
 *
 * - `@/…` → `app/…` and `@assets/…` → `assets/…` (Ignite's tsconfig/babel
 *   path aliases), rewritten to relative specifiers inside this package only.
 * - `apisauce` imported by `app/services/api` → the bundled RSS fixture
 *   transport (`src/adapter/apisauce-fixture.ts`): no network, same Api class.
 * - The Showroom's two remote demo images (GitHub user-images, no CORS
 *   headers, so a browser canvas can't read them) → bundled copies in
 *   `assets/remote/`, swapped at the string literal; the source is unchanged.
 */
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP_DIR = `${PKG_ROOT}/app`;
const ASSETS_DIR = `${PKG_ROOT}/assets`;
const API_DIR = `${APP_DIR}/services/api`;
const APISAUCE_FIXTURE = `${PKG_ROOT}/src/adapter/apisauce-fixture.ts`;

// `from "@/x"`, `import("@/x")`, `require("@assets/x.png")`, `import "@/x"`.
const SPECIFIER_RE = /(\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)(["'])@(assets)?\/([^"'\n]+)\2/g;

// https://user-images.githubusercontent.com/<user>/<file>.png → assets/remote/<file>.png
const REMOTE_IMAGE_RE = /(["'])https:\/\/user-images\.githubusercontent\.com\/\d+\/([\w-]+\.png)\1/g;

const isOwnSource = (file: string): boolean =>
  file.startsWith(`${PKG_ROOT}/`) && !file.includes('/node_modules/') && /\.(ts|tsx|js|jsx)$/.test(file);

function target(kind: string | undefined, rest: string): string {
  return `${kind === 'assets' ? ASSETS_DIR : APP_DIR}/${rest}`;
}

function relativeSpecifier(fromFile: string, to: string): string {
  const rel = relative(dirname(fromFile), to);
  return rel.startsWith('.') ? rel : `./${rel}`;
}

export function igniteDemo(): Plugin {
  return {
    name: 'ignite-demo:adapter',
    enforce: 'pre',
    transform(code, id) {
      const file = id.split('?')[0]!;
      if (!isOwnSource(file)) return null;
      let changed = false;
      let out = code.replace(SPECIFIER_RE, (_m, lead: string, q: string, kind: string | undefined, rest: string) => {
        changed = true;
        return `${lead}${q}${relativeSpecifier(file, target(kind, rest))}${q}`;
      });
      const imports: string[] = [];
      out = out.replace(REMOTE_IMAGE_RE, (_m, _q: string, name: string) => {
        const ident = `__igniteRemote${imports.length}`;
        imports.push(`import ${ident} from ${JSON.stringify(relativeSpecifier(file, `${ASSETS_DIR}/remote/${name}`))};`);
        changed = true;
        return ident;
      });
      if (imports.length) out = `${imports.join('\n')}\n${out}`;
      return changed ? { code: out, map: null } : null;
    },
    async resolveId(source, importer, options) {
      if (!importer) return null;
      const from = importer.split('?')[0]!;
      if (!isOwnSource(from)) return null;
      if (source === 'apisauce' && from.startsWith(`${API_DIR}/`)) return APISAUCE_FIXTURE;
      // Fallback for specifiers that reached resolution unrewritten (e.g. a
      // require() hoisted by a plugin that ran before this one).
      const m = /^@(assets)?\/(.+)$/.exec(source);
      if (!m) return null;
      return this.resolve(target(m[1], m[2]!), importer, { ...options, skipSelf: true });
    },
  };
}
