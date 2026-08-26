/**
 * nativeSurface() preset config contract: reanimated auto-detection, cache
 * scoping, alias ordering, and standard-boundary optimizeDeps ownership.
 * Everything here asserts on the RETURNED config — the config plugin's hook
 * is invoked directly with a fake user config + env, no Vite server involved.
 * "Resolvable root" is examples/embed-demo (reanimated + the engine's CJS
 * leaves all resolve from it); a fresh temp dir is the unresolvable root.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  nativeSurface,
  nativeSurfaceAliases,
  rnCjsInteropPlugin,
  rnRequirePlugin,
  type NativeSurfaceAlias,
} from '../src/vite';
import type { NativeSurfacePresetOptions } from '../src/vite';

const EMBED_ROOT = fileURLToPath(new URL('../../../examples/embed-demo', import.meta.url));

interface PresetConfig {
  cacheDir?: string;
  define: Record<string, string>;
  resolve: { conditions: string[]; dedupe: string[]; alias: NativeSurfaceAlias[] };
  optimizeDeps: { exclude: string[]; include: string[] };
}

function runConfig(
  opts: NativeSurfacePresetOptions = {},
  user: { root?: string; cacheDir?: string } | undefined = {}
): PresetConfig {
  const plugins = nativeSurface(opts) as Array<{
    name?: string;
    config?: (user: unknown, env: { mode: string; command: string }) => PresetConfig;
  }>;
  const configPlugin = plugins.find((p) => p?.name === 'native-surface:config');
  expect(configPlugin?.config).toBeTypeOf('function');
  return configPlugin!.config!(user, { mode: 'development', command: 'serve' });
}

const findAlias = (aliases: NativeSurfaceAlias[], probe: (a: NativeSurfaceAlias) => boolean): number =>
  aliases.findIndex(probe);
const isLibrariesRegex = (a: NativeSurfaceAlias): boolean =>
  a.find instanceof RegExp && a.find.test('react-native/Libraries/Renderer/shims/ReactFabric');
const isScreensAlias = (a: NativeSurfaceAlias): boolean =>
  a.find instanceof RegExp && a.find.test('react-native-screens');
const isReanimatedAlias = (a: NativeSurfaceAlias): boolean => a.find === 'react-native-reanimated';

let emptyRoot: string;
beforeAll(() => {
  // No node_modules anywhere up from tmpdir, so nothing bare resolves here.
  emptyRoot = mkdtempSync(join(tmpdir(), 'native-surface-preset-'));
});
afterAll(() => {
  rmSync(emptyRoot, { recursive: true, force: true });
});

describe('reanimated mode auto-detection', () => {
  it('defaults to real when react-native-reanimated resolves from the app root', () => {
    const cfg = runConfig({ resolveFrom: EMBED_ROOT });
    expect(cfg.optimizeDeps.exclude).toContain('react-native-reanimated');
    expect(findAlias(cfg.resolve.alias, isReanimatedAlias)).toBe(-1);
  });

  it('defaults to shim when it does not resolve', () => {
    const cfg = runConfig({ resolveFrom: emptyRoot });
    expect(cfg.optimizeDeps.exclude).not.toContain('react-native-reanimated');
    expect(findAlias(cfg.resolve.alias, isReanimatedAlias)).toBeGreaterThanOrEqual(0);
  });

  it('explicit shim wins over a resolvable package', () => {
    const cfg = runConfig({ reanimated: 'shim', resolveFrom: EMBED_ROOT });
    expect(cfg.optimizeDeps.exclude).not.toContain('react-native-reanimated');
    expect(findAlias(cfg.resolve.alias, isReanimatedAlias)).toBeGreaterThanOrEqual(0);
  });

  it('explicit real wins over an unresolvable package', () => {
    const cfg = runConfig({ reanimated: 'real', resolveFrom: emptyRoot });
    expect(cfg.optimizeDeps.exclude).toContain('react-native-reanimated');
    expect(findAlias(cfg.resolve.alias, isReanimatedAlias)).toBe(-1);
  });
});

describe('cacheDir scoping', () => {
  it('scopes the optimizer cache to the detected mode when the user set none', () => {
    expect(runConfig({ resolveFrom: EMBED_ROOT }).cacheDir).toBe('node_modules/.vite-native-surface-real');
    expect(runConfig({ resolveFrom: emptyRoot }).cacheDir).toBe('node_modules/.vite-native-surface-shim');
  });

  it('never overrides a user-set cacheDir (plugin scalars win in the merge)', () => {
    const cfg = runConfig({ resolveFrom: EMBED_ROOT }, { cacheDir: 'node_modules/.custom' });
    expect('cacheDir' in cfg).toBe(false);
  });
});

describe('alias set', () => {
  it('puts the Libraries and screens regexes before the react-native find', () => {
    const aliases = nativeSurfaceAliases();
    const rn = findAlias(aliases, (a) => a.find === 'react-native');
    const libs = findAlias(aliases, isLibrariesRegex);
    const screens = findAlias(aliases, isScreensAlias);
    expect(rn).toBeGreaterThanOrEqual(0);
    expect(libs).toBeGreaterThanOrEqual(0);
    expect(screens).toBeGreaterThanOrEqual(0);
    expect(libs).toBeLessThan(rn);
    expect(screens).toBeLessThan(rn);
  });

  it('matches screens subpath imports too', () => {
    const aliases = nativeSurfaceAliases();
    const screens = aliases[findAlias(aliases, isScreensAlias)]!;
    expect((screens.find as RegExp).test('react-native-screens/native-stack')).toBe(true);
    // Anchored: no swallowing of lookalike package names.
    expect((screens.find as RegExp).test('not-react-native-screens')).toBe(false);
  });

  it("screens: 'off' removes the screens alias (directly and through the preset)", () => {
    expect(findAlias(nativeSurfaceAliases({ screens: 'off' }), isScreensAlias)).toBe(-1);
    const cfg = runConfig({ screens: 'off', resolveFrom: EMBED_ROOT });
    expect(findAlias(cfg.resolve.alias, isScreensAlias)).toBe(-1);
  });

  it('fabric stub and screens shim replacements point at existing files', () => {
    const aliases = nativeSurfaceAliases();
    const libs = aliases[findAlias(aliases, isLibrariesRegex)]!;
    const screens = aliases[findAlias(aliases, isScreensAlias)]!;
    expect(existsSync(libs.replacement)).toBe(true);
    expect(existsSync(screens.replacement)).toBe(true);
  });
});

describe('rnRequirePlugin', () => {
  const PAPER = '/x/node_modules/react-native-paper/lib/module/components/Appbar/AppbarBackIcon.js';
  /** Call the transform with a chosen plugin context (Vite supplies one with
   *  `resolve`; a bare call gets none, which must stay permissive). */
  const transformWith = (
    ctx: unknown,
    code: string,
    id: string
  ): Promise<{ code: string; map: null } | null> =>
    rnRequirePlugin().transform.call(ctx as never, code, id);
  const importLines = (code: string): string[] => code.split('\n').filter((l) => l.startsWith('import '));

  it('hoists a real require and ignores the identical-looking ones in comments', async () => {
    // Paper ships all four shapes in one package: a render-time asset require,
    // a JSDoc example naming a file that does not exist, a line comment, and
    // strings/regexes carrying the characters a naive strip would trip on.
    const code = [
      '/**',
      " * <Avatar.Image source={require('../assets/avatar.png')} />",
      ' */',
      "// source is a module, e.g. - require('image')",
      "const slashes = /\\/\\/x/.test(s) || 'https://example.com//p';",
      "const spec = { source: require('../../assets/back-chevron.png') };",
    ].join('\n');
    const out = await transformWith(undefined, code, PAPER);
    expect(out).not.toBeNull();
    expect(importLines(out!.code)).toEqual(['import __rnReq0 from "../../assets/back-chevron.png";']);
    expect(out!.code).toContain('Object.freeze({ uri: __rnReq0, scale: 1 })');
    // Comments and strings survive verbatim — only the real call was rewritten.
    expect(out!.code).toContain("<Avatar.Image source={require('../assets/avatar.png')} />");
    expect(out!.code).toContain("// source is a module, e.g. - require('image')");
    expect(out!.code).toContain("'https://example.com//p'");
  });

  it('leaves an unresolvable bare require literal so the library try/catch still degrades', async () => {
    // paper's icon loader try-requires three packages; hoisting an uninstalled
    // one would turn its caught ReferenceError into a dead import — or, under
    // a host that answers every bare id with a virtual not-bridged stub, into
    // a poisoned first candidate that wins over the installed second.
    const ctx = {
      resolve: async (spec: string) =>
        spec === '@expo/vector-icons/MaterialCommunityIcons'
          ? { id: fileURLToPath(import.meta.url) } // a real file on disk
          : { id: `\0ns-stub:${spec}` },
    };
    const code = [
      "try { return require('@react-native-vector-icons/material-design-icons').default; }",
      "catch (e) { return require('@expo/vector-icons/MaterialCommunityIcons').default; }",
    ].join('\n');
    const out = await transformWith(ctx, code, PAPER);
    expect(out).not.toBeNull();
    expect(out!.code).toContain("require('@react-native-vector-icons/material-design-icons')");
    expect(importLines(out!.code)).toEqual([
      'import * as __rnReq0 from "@expo/vector-icons/MaterialCommunityIcons";',
    ]);
    expect(out!.code).toContain('__rnReq0.default');
  });

  it('applies to react-native-paper by default and to no other node_modules package', async () => {
    const code = "const x = require('./thing.png');";
    expect(await transformWith(undefined, code, PAPER)).not.toBeNull();
    expect(await transformWith(undefined, code, '/x/node_modules/some-lib/index.js')).toBeNull();
  });
});

describe('standard-boundary optimizeDeps ownership', () => {
  it('excludes the ESM ecosystem packages unconditionally', () => {
    const { exclude } = runConfig({ resolveFrom: emptyRoot }).optimizeDeps;
    for (const pkg of [
      '@react-navigation/native',
      '@react-navigation/core',
      '@react-navigation/elements',
      '@react-navigation/stack',
      '@react-navigation/bottom-tabs',
      '@react-navigation/routers',
      'react-native-screens',
      'react-native-safe-area-context',
      'react-native-gesture-handler',
      '@expo/vector-icons',
      'react-native-paper',
    ]) {
      expect(exclude).toContain(pkg);
    }
  });

  it('includes the engine and nav CJS leaves that resolve from the app root', () => {
    const { include } = runConfig({ resolveFrom: EMBED_ROOT }).optimizeDeps;
    for (const id of [
      'react-reconciler',
      'react-reconciler/constants',
      'scheduler',
      'canvaskit-wasm',
      'canvaskit-wasm/bin/canvaskit.js',
      'react-is',
      'use-latest-callback',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
    ]) {
      expect(include).toContain(id);
    }
  });

  it('drops ECOSYSTEM includes that do not resolve (unresolvable entries make Vite log failures)', () => {
    // Both roots empty: an id no tree can resolve has nothing to prebundle.
    const { include } = runConfig({ resolveFrom: emptyRoot }, { root: emptyRoot }).optimizeDeps;
    expect(include).not.toContain('query-string');
    expect(include).not.toContain('use-latest-callback');
  });

  it("always includes the ENGINE's own CJS leaves, resolved from the engine", () => {
    // react-reconciler and canvaskit are dependencies of native-surface, not
    // of the served app: under a strict (pnpm) install they are nested inside
    // the engine's own tree and resolve from NEITHER the app root nor Vite's.
    // Filtering them by either root left the surface unable to mount.
    const cfg = runConfig({ resolveFrom: emptyRoot });
    expect(cfg.optimizeDeps.include).toContain('react-reconciler');
    expect(cfg.optimizeDeps.include).toContain('react-reconciler/constants');
    expect(cfg.optimizeDeps.include).toContain('canvaskit-wasm/bin/canvaskit.js');
    // …and each is pinned to an absolute path so resolution cannot depend on
    // which root asks for it.
    const pinned = cfg.resolve.alias.filter(
      (a) => a.find instanceof RegExp && a.find.test('react-reconciler/constants')
    );
    expect(pinned.length).toBeGreaterThan(0);
    expect(existsSync(pinned[0]!.replacement)).toBe(true);
  });

  it('wraps bare CJS leaves of interop packages as ESM with aliased named exports', () => {
    const plugin = rnCjsInteropPlugin();
    const file =
      '/x/node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/lib/object-utils.js';
    const cjs = 'const pick = () => {};\nconst omit = () => {};\nmodule.exports = { pick, omit };\n';
    const out = plugin.transform(cjs, file);
    expect(out).not.toBeNull();
    expect(out!.code).toContain('const module = { exports: {} }');
    expect(out!.code).toContain('export default module.exports;');
    // Aliased bindings: direct `export { pick }` would collide with the
    // file's own top-level consts.
    expect(out!.code).toContain('export { __cjsX0 as pick, __cjsX1 as omit };');
    // ESM files interop through the graph already; other packages are out of scope.
    expect(plugin.transform(`import x from './x.js';\nmodule.exports = {};`, file)).toBeNull();
    expect(plugin.transform(cjs, '/x/node_modules/some-lib/utils.js')).toBeNull();
    // Dep-cache chunks are prebundled output, never wrap targets.
    expect(plugin.transform(cjs, '/x/node_modules/.vite/deps/chunk.js')).toBeNull();
  });

  it('dedupes the nav singletons alongside react and reanimated', () => {
    const { dedupe } = runConfig({ resolveFrom: EMBED_ROOT }).resolve;
    for (const pkg of [
      'react',
      'react-dom',
      'react-native-reanimated',
      '@react-navigation/native',
      '@react-navigation/core',
      '@react-navigation/elements',
      '@react-navigation/stack',
      '@react-navigation/bottom-tabs',
      '@react-navigation/routers',
      'use-latest-callback',
    ]) {
      expect(dedupe).toContain(pkg);
    }
  });
});
