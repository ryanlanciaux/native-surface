/**
 * nativeSurface() preset config contract: reanimated auto-detection, cache
 * scoping, alias ordering, and standard-boundary optimizeDeps ownership.
 * Everything here asserts on the RETURNED config — the config plugin's hook
 * is invoked directly with a fake user config + env, no Vite server involved.
 * "Resolvable root" is examples/embed-demo (reanimated + the engine's CJS
 * leaves all resolve from it); a fresh temp dir is the unresolvable root.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  nativeSurface,
  nativeSurfaceAliases,
  rnCjsInteropPlugin,
  rnRequirePlugin,
  rnWorkletsJsSyncPlugin,
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
    expect(findAlias(cfg.resolve.alias, isReanimatedAlias)).toBeGreaterThanOrEqual(0);
  });

  it('explicit shim wins over a resolvable package', () => {
    const cfg = runConfig({ reanimated: 'shim', resolveFrom: EMBED_ROOT });
    expect(findAlias(cfg.resolve.alias, isReanimatedAlias)).toBeGreaterThanOrEqual(0);
  });

  /**
   * The ALIAS is the mode signal, not the exclude. Reanimated is excluded from
   * prebundling in BOTH modes and that is deliberate: in 'real' mode the
   * package imports the aliased 'react-native', and in 'shim' mode the alias
   * points at compat's shim — which must not be frozen into a dep chunk any
   * more than the engine itself. Asserting the mode through the exclude list
   * (as these tests once did) conflated the two.
   */
  it('excludes reanimated from prebundling in both modes', () => {
    expect(runConfig({ reanimated: 'real', resolveFrom: EMBED_ROOT }).optimizeDeps.exclude).toContain(
      'react-native-reanimated'
    );
    expect(runConfig({ reanimated: 'shim', resolveFrom: EMBED_ROOT }).optimizeDeps.exclude).toContain(
      'react-native-reanimated'
    );
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

  /**
   * Every alias replacement, not a named few: an alias pointing at a file that
   * is not there fails the import from the CONSUMER's source, naming a path
   * inside node_modules the app never wrote. `nativeSurfaceAliases` now filters
   * those out rather than claiming them, so this asserts the invariant the
   * filter maintains.
   */
  it('every alias replacement resolves to a file that exists on disk', () => {
    for (const alias of nativeSurfaceAliases()) {
      expect(existsSync(alias.replacement), `${String(alias.find)} → ${alias.replacement}`).toBe(true);
    }
  });

  /**
   * The other half of that invariant, and the one with teeth: the filter must
   * not be silently eating the alias set. Every package the preset claims to
   * bridge has to still be claimed — a broken compat resolution would drop
   * them all, and the test above would pass on an empty list.
   */
  it('claims every package it bridges (the existence filter drops nothing here)', () => {
    const aliases = nativeSurfaceAliases({ jsStackAvailable: true });
    const matches = (id: string): NativeSurfaceAlias | undefined =>
      aliases.find((a) => (a.find instanceof RegExp ? a.find.test(id) : a.find === id || id.startsWith(`${a.find}/`)));
    for (const pkg of [
      'react-native',
      'react-native/Libraries/Renderer/shims/ReactFabric',
      'react-native-screens',
      'react-native-gesture-handler',
      'react-native-safe-area-context',
      'react-native-mmkv',
      'react-native-keyboard-controller',
      'react-native-edge-to-edge',
      '@react-navigation/native-stack',
      'expo',
      'expo-modules-core',
      'expo-font',
      'expo-linking',
      'expo-localization',
      'expo-application',
      'expo-splash-screen',
      'expo-system-ui',
      'expo-haptics',
      'expo-constants',
      'expo-clipboard',
      'expo-image-picker',
      'expo-notifications',
      'expo-image',
      'expo-linear-gradient',
      'expo-blur',
      'expo-web-browser',
      'expo-sharing',
      'expo-location',
      'expo-device',
      'expo-keep-awake',
      'expo-screen-orientation',
      'expo-updates',
      'react-native-svg',
      'react-native-webview',
      'react-native-pager-view',
      'react-native-vector-icons',
      'react-native-device-info',
      'react-native-permissions',
      'react-native-share',
      'react-native-fast-image',
      'react-native-linear-gradient',
      'react-native-image-picker',
      '@react-native-async-storage/async-storage',
      '@react-native-community/netinfo',
      '@react-native-community/blur',
      '@react-native-clipboard/clipboard',
      '@react-native-masked-view/masked-view',
      'reactotron-react-native',
    ]) {
      expect(matches(pkg), `no alias claims ${pkg}`).toBeDefined();
    }
  });

  /**
   * Anchored regexes, so a shim alias claims its own package and its subpaths
   * and nothing else. The bare `expo` string find is the hazard: Rollup string
   * finds also match `<find>/subpath`, and an unanchored `expo` entry ahead of
   * these would swallow every `expo-*` package into the wrong shim.
   */
  it('the browser-API expo shims claim their own package without colliding', () => {
    const aliases = nativeSurfaceAliases();
    const matches = (id: string): NativeSurfaceAlias | undefined =>
      aliases.find((a) => (a.find instanceof RegExp ? a.find.test(id) : a.find === id || id.startsWith(`${a.find}/`)));
    for (const [pkg, file] of [
      ['expo-web-browser', 'web-browser'],
      ['expo-sharing', 'sharing'],
      ['expo-location', 'location'],
      ['expo-device', 'device'],
      ['expo-keep-awake', 'keep-awake'],
      ['expo-screen-orientation', 'screen-orientation'],
      ['expo-updates', 'updates'],
      ['expo-file-system', 'file-system'],
      ['expo-media-library', 'media-library'],
      ['expo-image-manipulator', 'image-manipulator'],
      ['expo-video', 'video'],
      ['expo-video-thumbnails', 'video-thumbnails'],
    ] as const) {
      expect(matches(pkg)?.replacement, pkg).toContain(file);
      // Subpath imports must land on the same shim file, not `<file>/subpath`.
      expect(matches(`${pkg}/build/index.js`)?.replacement, `${pkg} subpath`).toContain(file);
    }
    // ...and none of them steals the bare `expo` package or expo-modules-core.
    expect(matches('expo')?.replacement).toContain('expo.tsx');
    expect(matches('expo-modules-core')?.replacement).toContain('expo-modules-core');
  });

  /**
   * The alias list and the prebundling exclude list must agree.
   *
   * Vite's optimizer sees the id the APP imports, not the file the alias sends
   * it to — so an aliased package that is not excluded gets a frozen copy of
   * our own shim sealed into a dep chunk, which then survives edits to the
   * shim (the optimizer cache is keyed on the app's dependencies, and those
   * did not change). That failure looks exactly like "my fix didn't apply".
   */
  /**
   * `react-native` is the entry most easily missed, because it is aliased to
   * the ENGINE rather than to a compat shim — so a check that only looks at
   * compat replacements skips it. Prebundling it freezes a copy of the engine,
   * and its deep `Libraries/*` imports are discovered LAZILY, which re-runs the
   * optimizer mid-session and 404s the running page's chunks.
   */
  /**
   * The inverse of the rule above, and it must stay that way. `react-native`
   * is aliased to the engine, so it LOOKS like it belongs in the exclude list
   * — but Vite matches excludes against the package name, so excluding it also
   * excludes every deep `react-native/...` id, and prebundled CJS packages
   * reach those through a runtime require (@sentry/react-native wants
   * `react-native/Libraries/Promise`). esbuild cannot resolve a require to an
   * external, so it emits a stub that throws `Dynamic require of "..." is not
   * supported` and the app does not boot.
   */
  it('does NOT exclude react-native — that breaks CJS deps that require its internals', () => {
    const { exclude } = runConfig({ resolveFrom: EMBED_ROOT }).optimizeDeps;
    expect(exclude).not.toContain('react-native');
  });

  it('excludes every package it aliases onto a compat shim from prebundling', () => {
    const { exclude } = runConfig({ resolveFrom: EMBED_ROOT }).optimizeDeps;
    const aliases = nativeSurfaceAliases({ jsStackAvailable: true });
    for (const alias of aliases) {
      if (!alias.replacement.includes('/compat/')) continue;
      // Recover the package id this entry claims, then require an exclude.
      const probe = String(alias.find)
        .replace(/^\/\^?/, '')
        .replace(/\(\\\/\.\*\)\?\$\/$/, '')
        .replace(/\/$/, '')
        .replace(/\\/g, '');
      if (!probe || probe.includes('*')) continue;
      expect(exclude, `${probe} is aliased to a shim but not excluded`).toContain(probe);
    }
  });

  /**
   * Prefix-sharing package names. `expo-image` / `expo-image-manipulator` and
   * `expo-video` / `expo-video-thumbnails` differ only by a suffix, so the
   * shorter entry must not capture the longer one — which is exactly what a
   * Rollup STRING find would do, and why every shim alias is an anchored
   * regex. `expo-file-system/legacy`, by contrast, must land on the same file
   * as its parent: one module serves both SDK-57 surfaces.
   */
  it('prefix-sharing package names resolve to their own shim', () => {
    const aliases = nativeSurfaceAliases();
    const matches = (id: string): NativeSurfaceAlias | undefined =>
      aliases.find((a) => (a.find instanceof RegExp ? a.find.test(id) : a.find === id || id.startsWith(`${a.find}/`)));
    expect(matches('expo-image')?.replacement).toContain('image.tsx');
    expect(matches('expo-image-manipulator')?.replacement).toContain('image-manipulator');
    expect(matches('expo-image-picker')?.replacement).toContain('image-picker');
    expect(matches('expo-video')?.replacement).toContain('video.tsx');
    expect(matches('expo-video-thumbnails')?.replacement).toContain('video-thumbnails');
    // Subpaths of one package share its module, including the legacy surface.
    expect(matches('expo-file-system/legacy')?.replacement).toContain('file-system');
    expect(matches('expo-media-library/next')?.replacement).toContain('media-library');
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

  it('lets CJS reassign exports (semver/internal/re.js)', () => {
    const plugin = rnCjsInteropPlugin();
    const file = '/x/node_modules/semver/internal/re.js';
    const out = plugin.transform('exports = module.exports = {};\nexports.re = [];\n', file)!;
    const runnable = out.code.replace(/\nexport .*/g, '');
    expect(() => new Function(runnable)()).not.toThrow();
  });

  it('esbuild-bundles semver /@fs CJS to ESM (circular + exports reassignment)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ns-semver-'));
    try {
      const pkg = join(root, 'node_modules', 'semver');
      mkdirSync(join(pkg, 'internal'), { recursive: true });
      mkdirSync(join(pkg, 'classes'), { recursive: true });
      writeFileSync(join(pkg, 'internal/re.js'), 'exports = module.exports = {};\nexports.re = [/x/];\n');
      writeFileSync(
        join(pkg, 'classes/comparator.js'),
        'const semver = require("../index");\nmodule.exports = function Comparator() { return semver.clean(); };\n'
      );
      writeFileSync(
        join(pkg, 'index.js'),
        'const Comparator = require("./classes/comparator");\nmodule.exports = { Comparator, clean: () => 1 };\n'
      );
      const plugin = rnCjsInteropPlugin();
      const code = await plugin.load(join(pkg, 'index.js'));
      expect(code).toBeTruthy();
      expect(code!).toMatch(/export/);
      expect(code!).not.toMatch(/const exports = module\.exports/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('forces SHOULD_BE_USE_WEB so reanimated 4 takes the JS mapper on ios', () => {
    const plugin = rnWorkletsJsSyncPlugin();
    const src =
      'export const SHOULD_BE_USE_WEB: boolean = IS_JEST || IS_WEB || IS_WINDOWS;\n' +
      'export function shouldBeUseWeb() { return isJest() || isWeb(); }\n';
    const out = plugin.transform(src, '/x/node_modules/react-native-worklets/src/PlatformChecker.ts');
    expect(out).not.toBeNull();
    expect(out!.code).toContain('SHOULD_BE_USE_WEB: boolean = true');
    expect(out!.code).toContain('function shouldBeUseWeb() { return true; }');
  });

  it('shims worklets runOnUISync / executeOnUIRuntimeSync onto the JS thread', () => {
    const plugin = rnWorkletsJsSyncPlugin();
    const src = `
export function runOnUISync() {
  throw new WorkletsError('\`runOnUISync\` is not supported on web.');
}
export function executeOnUIRuntimeSync() {
  throw new WorkletsError('\`executeOnUIRuntimeSync\` is not supported on web.');
}
`;
    const out = plugin.transform(src, '/x/node_modules/react-native-worklets/src/threads.ts');
    expect(out).not.toBeNull();
    expect(out!.code).not.toMatch(/not supported on web/);
    const runOnUISync = new Function(
      `${out!.code.replace(/export /g, '')}; return { runOnUISync, executeOnUIRuntimeSync };`
    )() as {
      runOnUISync: (fn: (...a: number[]) => number, ...a: number[]) => number;
      executeOnUIRuntimeSync: (fn: (...a: number[]) => number) => (...a: number[]) => number;
    };
    expect(runOnUISync.runOnUISync((a: number, b: number) => a + b, 2, 3)).toBe(5);
    expect(runOnUISync.executeOnUIRuntimeSync((a: number) => a * 2)(4)).toBe(8);
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

/**
 * The `.web.*` inversion (FINDINGS F12) is version-dependent, so the preset
 * detects it instead of asking every app to configure it. Reanimated 3's
 * default path drives views through setNativeProps — which this engine
 * implements — so inverting it there would swap a working implementation for
 * a worse one; only from 4, where the native path builds a Fabric TurboModule
 * that cannot exist here, does the web variant become the faithful one.
 */
describe('web-variant auto-detection', () => {
  let fixtureRoot: string;

  /** A package tree with plain/.native/.web siblings, at a given version. */
  const writePackage = (root: string, name: string, version: string): string => {
    const dir = join(root, 'node_modules', ...name.split('/'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version, main: 'index.js' }));
    for (const file of ['index.js', 'thing.js', 'thing.native.js', 'thing.web.js']) {
      writeFileSync(join(dir, file), '// fixture\n');
    }
    return dir;
  };

  /** Runs the preset's config hook (which is what populates the list), then
   *  asks the platform-extension resolver where a plain `.js` file lands. */
  const resolveThrough = async (opts: NativeSurfacePresetOptions, file: string): Promise<string | null> => {
    const plugins = nativeSurface(opts) as Array<{
      name?: string;
      config?: (user: unknown, env: { mode: string; command: string }) => unknown;
      resolveId?: (source: string, importer: string | undefined, options: unknown) => Promise<string | null>;
    }>;
    plugins.find((p) => p?.name === 'native-surface:config')?.config?.({}, { mode: 'development', command: 'serve' });
    const resolver = plugins.find((p) => p?.name === 'native-surface:rn-platform-extensions');
    // The plugin re-resolves through the container; stand in for it.
    const ctx = { resolve: async () => ({ id: file }) };
    return resolver!.resolveId!.call(ctx as never, file, undefined, {});
  };

  beforeAll(() => {
    fixtureRoot = mkdtempSync(join(tmpdir(), 'native-surface-webvariant-'));
    writePackage(fixtureRoot, 'react-native-reanimated', '4.5.3');
    writePackage(fixtureRoot, 'react-native-worklets', '0.11.3');
    writePackage(fixtureRoot, 'expo-paste-input', '0.2.1');
  });
  afterAll(() => rmSync(fixtureRoot, { recursive: true, force: true }));

  it('prefers the .web sibling for reanimated 4 and its worklets runtime', async () => {
    const rea = join(fixtureRoot, 'node_modules', 'react-native-reanimated', 'thing.js');
    expect(await resolveThrough({ resolveFrom: fixtureRoot }, rea)).toBe(rea.replace(/\.js$/, '.web.js'));
    const worklets = join(fixtureRoot, 'node_modules', 'react-native-worklets', 'thing.js');
    expect(await resolveThrough({ resolveFrom: fixtureRoot }, worklets)).toBe(worklets.replace(/\.js$/, '.web.js'));
  });

  it('prefers the .web sibling for expo-paste-input (its native view is a passthrough on web)', async () => {
    const paste = join(fixtureRoot, 'node_modules', 'expo-paste-input', 'thing.js');
    expect(await resolveThrough({ resolveFrom: fixtureRoot }, paste)).toBe(paste.replace(/\.js$/, '.web.js'));
  });

  it('a web-variant package with no .web sibling keeps the resolved file, never .native', async () => {
    // The unsuffixed file IS the web build in Metro's convention, so falling
    // through to `.native` would hand back the implementation the inversion
    // exists to avoid — react-native-worklets' NativeWorklets.native.js pulls
    // in native-only modules that do not exist and fails the whole optimize.
    const root = mkdtempSync(join(tmpdir(), 'native-surface-nowebsib-'));
    try {
      const dir = join(root, 'node_modules', 'react-native-reanimated');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'react-native-reanimated', version: '4.5.3' }));
      // plain + .native only — no .web sibling
      for (const f of ['NativeThing.js', 'NativeThing.native.js']) writeFileSync(join(dir, f), '// fixture\n');
      const file = join(dir, 'NativeThing.js');
      expect(await resolveThrough({ resolveFrom: root }, file)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('leaves reanimated 3 on the Metro-parity .native path', async () => {
    const root = mkdtempSync(join(tmpdir(), 'native-surface-rea3-'));
    try {
      writePackage(root, 'react-native-reanimated', '3.19.5');
      const file = join(root, 'node_modules', 'react-native-reanimated', 'thing.js');
      expect(await resolveThrough({ resolveFrom: root }, file)).toBe(file.replace(/\.js$/, '.native.js'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('an explicit webVariantPackages entry ADDS to the detected set, it does not replace it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'native-surface-both-'));
    try {
      writePackage(root, 'react-native-reanimated', '4.5.3');
      writePackage(root, 'some-other-lib', '1.0.0');
      const other = join(root, 'node_modules', 'some-other-lib', 'thing.js');
      const rea = join(root, 'node_modules', 'react-native-reanimated', 'thing.js');
      const opts = { resolveFrom: root, webVariantPackages: ['some-other-lib'] };
      expect(await resolveThrough(opts, other)).toBe(other.replace(/\.js$/, '.web.js'));
      expect(await resolveThrough(opts, rea)).toBe(rea.replace(/\.js$/, '.web.js'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('adds nothing for an app that has none of them installed', async () => {
    const file = join(emptyRoot, 'anything', 'thing.js');
    expect(await resolveThrough({ resolveFrom: emptyRoot }, file)).toBeNull();
  });
});
