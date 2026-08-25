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
import { nativeSurface, nativeSurfaceAliases, rnCjsInteropPlugin, type NativeSurfaceAlias } from '../src/vite';
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

  it('drops includes that do not resolve (unresolvable entries make Vite log failures)', () => {
    const { include } = runConfig({ resolveFrom: emptyRoot }).optimizeDeps;
    expect(include).not.toContain('react-reconciler');
    expect(include).not.toContain('canvaskit-wasm/bin/canvaskit.js');
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
