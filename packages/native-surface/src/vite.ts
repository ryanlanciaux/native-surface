import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
// Type-only (erased at build): the preset must not import vite at runtime —
// it resolves the consumer's own vite instance from their app root instead.
import type { PluginOption } from 'vite';

// Alias replacements are ABSOLUTE paths: Vite resolves a bare-specifier
// replacement from the importing file, and files outside this workspace's
// dependents (e.g. an example app's own sources) cannot see
// native-surface packages. Absolute paths are importer-independent.
/**
 * This module runs on Node in two homes: as TS source at <pkg>/src/vite.ts
 * (workspace dev — Vite's config bundler handles the TS) and as compiled JS
 * at <pkg>/dist/vite.mjs (the published tarball — Node refuses to type-strip
 * TS inside node_modules, so the Node-facing entry ships compiled). All
 * engine paths are therefore package-root-relative, never file-relative.
 */
const selfRequire = createRequire(import.meta.url);
const PKG_ROOT = ((): string => {
  try {
    // Self-referencing resolution through our own exports map — identical
    // from src/ and dist/, in-workspace and installed.
    return fileURLToPath(new URL('.', `file://${selfRequire.resolve('native-surface/package.json')}`));
  } catch {
    // src/ and dist/ both sit directly under the package root.
    return fileURLToPath(new URL('..', import.meta.url));
  }
})();

const ENGINE_ENTRY = `${PKG_ROOT}src/index.ts`;

/**
 * Absolute path of a compat-shim module. Installed from npm, the shims live
 * in the @native-surface/compat package (a dependency of this one), resolved
 * through its exports map; inside the development workspace the sibling
 * package directory is the fallback before the workspace has been linked.
 */
const compat = (file: string): string => {
  const subpath = file.replace(/\.tsx?$/, '');
  try {
    return selfRequire.resolve(`@native-surface/compat/${subpath}`);
  } catch {
    return `${PKG_ROOT}../compat/src/${file}`;
  }
};

/**
 * Vite helper: alias `react-native` imports to native-surface so unmodified RN
 * component source runs on the canvas renderer.
 *
 *   import { reactNativeAlias } from 'native-surface/vite'
 *   export default defineConfig({ resolve: { alias: [reactNativeAlias()] } })
 */
export function reactNativeAlias(): { find: string; replacement: string } {
  return { find: 'react-native', replacement: ENGINE_ENTRY };
}

/**
 * Full alias set for apps using third-party RN libraries: `react-native` plus
 * the compat shims (@native-surface/compat) — reanimated / gesture-handler /
 * screens / the react-native/Libraries/* fabric stub, and friends.
 * Rollup-style string finds match the exact id or `<find>/subpath`, so the
 * `react-native` entry does NOT swallow `react-native-reanimated` — but it
 * DOES match `react-native/Libraries/…`, which is why the regex finds sit
 * first in the returned array. Order is semantic; consumers appending their
 * own entries should append, not sort.
 *
 *   import { nativeSurfaceAliases } from 'native-surface/vite'
 *   export default defineConfig({ resolve: { alias: nativeSurfaceAliases() } })
 */
export interface NativeSurfaceAliasOptions {
  /**
   * 'shim': reanimated resolves to the compat shim.
   * 'real': reanimated resolves to the actual react-native-reanimated package,
   * whose web mode (`shouldBeUseWeb()`) drives our hosts via `setNativeProps`.
   * Requires the consumer app to also define `process.env.JEST_WORKER_ID` and
   * exclude 'react-native-reanimated' from optimizeDeps (it imports the
   * aliased 'react-native') — the nativeSurface() preset does both.
   *
   * Default: REAL-FIRST. The project's standing position is that the real
   * package beats a shim wherever its JS path can run, so the nativeSurface()
   * preset picks 'real' whenever react-native-reanimated resolves from the
   * app root (detected inside its config hook — the root is only known
   * there). The shim is strictly the fallback for installs without the
   * package, where 'real' cannot work at all. An explicit option always
   * wins. Calling nativeSurfaceAliases() directly keeps its historical
   * 'shim' default — à la carte callers don't get the preset's excludes and
   * defines that 'real' depends on.
   */
  reanimated?: 'shim' | 'real';
  /**
   * 'shim' (default): react-native-screens — subpath imports included —
   * resolves to the compat shim. npm installs the real package as a peer of
   * the navigators, and its `react-native` export condition + platform
   * extensions resolve native entries (Tabs/TabsScreen/TabsHost) that don't
   * exist in a usable web build, killing production builds.
   * 'off': leave resolution alone — escape hatch, because navigators branch
   * to screens-enabled code paths once the import resolves at all.
   */
  screens?: 'shim' | 'off';
}

/**
 * Metro-parity module resolution: RN libraries that ship both web- and
 * native-targeted files select them via the `react-native` exports condition
 * (Metro resolves it first). Without it, Vite's browser-default conditions
 * pick web files whose styles assume DOM CSS (e.g. react-native-drawer-layout's
 * `min(calc(100% - 56px), 360px)` drawer width reaching Yoga). Spread FIRST
 * into resolve.conditions, keeping Vite's defaults after:
 *
 *   import { defaultClientConditions } from 'vite'
 *   resolve: { conditions: [...nativeSurfaceConditions(), ...defaultClientConditions] }
 *
 * Packages that don't declare the condition are unaffected.
 */
export function nativeSurfaceConditions(): string[] {
  return ['react-native'];
}

/**
 * Metro platform-extension resolution: RN packages split files as
 * `Foo.ios.js` / `Foo.android.js` / `Foo.native.js` / `Foo.js` (web last),
 * and Metro picks by platform suffix — react-native-drawer-layout's
 * `Drawer.js` is its WEB implementation, `Drawer.native.js` the RN one.
 * This resolver re-checks every default-resolved `.js/.ts(x)` file for a
 * platform-suffixed sibling and prefers it, matching Metro's order:
 * `.{platform}.` → `.native.` → plain.
 */
export function rnPlatformExtensionsPlugin(opts: { platform?: 'ios' | 'android' } = {}): {
  name: string;
  enforce: 'pre';
  resolveId(source: string, importer: string | undefined, options: unknown): Promise<string | null>;
} {
  const platform = opts.platform ?? 'ios';
  const SUFFIXABLE = /\.(js|jsx|ts|tsx|mjs)$/;
  const ALREADY = new RegExp(`\\.(${platform}|native|android|ios|web)\\.(js|jsx|ts|tsx|mjs)$`);

  return {
    name: 'native-surface:rn-platform-extensions',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      const resolved = await (
        this as unknown as {
          resolve(s: string, i: string | undefined, o: object): Promise<{ id: string } | null>;
        }
      ).resolve(source, importer, { ...(options as object), skipSelf: true });
      if (!resolved) return null;
      const [file, query] = resolved.id.split('?') as [string, string | undefined];
      if (!SUFFIXABLE.test(file) || ALREADY.test(file) || file.includes('/.vite/')) return null;
      const ext = file.slice(file.lastIndexOf('.'));
      const base = file.slice(0, -ext.length);
      for (const suffix of [`.${platform}`, '.native']) {
        const candidate = `${base}${suffix}${ext}`;
        if (existsSync(candidate)) return query ? `${candidate}?${query}` : candidate;
      }
      return null;
    },
  };
}

/** One resolve.alias entry. Regex finds carry subtree redirects (deep
 *  react-native/Libraries/* imports) that string finds can't express. */
export interface NativeSurfaceAlias {
  find: string | RegExp;
  replacement: string;
}

export function nativeSurfaceAliases(opts: NativeSurfaceAliasOptions = {}): NativeSurfaceAlias[] {
  const aliases: NativeSurfaceAlias[] = [
    // MUST precede the 'react-native' string find below: string finds also
    // match `<find>/subpath`, which would rewrite deep Libraries imports
    // (reanimated's fabric probes, lazy try/catch'd on web) onto the engine
    // FILE — dev shrugs, but a production build resolves eagerly and dies
    // with UNLOADABLE_DEPENDENCY / "Not a directory".
    { find: /^react-native\/Libraries\/.*/, replacement: compat('fabric.ts') },
  ];
  if (opts.screens !== 'off') {
    // Regex so subpath imports also land on the shim (see the screens option
    // doc for why the real package breaks web builds).
    aliases.push({ find: /^react-native-screens(\/.*)?$/, replacement: compat('screens.tsx') });
  }
  if (opts.reanimated !== 'real') {
    aliases.push({ find: 'react-native-reanimated', replacement: compat('reanimated.tsx') });
  }
  aliases.push(
    { find: 'react-native-gesture-handler', replacement: compat('gesture-handler.tsx') },
    { find: 'react-native-safe-area-context', replacement: compat('safe-area.tsx') },
    // Expo-app boundary (docs/compat-strategy.md). Alias-only — apps that
    // never import these are unaffected.
    { find: 'react-native-mmkv', replacement: compat('mmkv.ts') },
    { find: 'react-native-keyboard-controller', replacement: compat('keyboard-controller.tsx') },
    { find: 'react-native-edge-to-edge', replacement: compat('edge-to-edge.tsx') },
    { find: '@react-navigation/native-stack', replacement: compat('native-stack.tsx') },
    { find: 'expo-font', replacement: compat('expo.tsx') },
    { find: 'expo-linking', replacement: compat('expo.tsx') },
    { find: 'expo-localization', replacement: compat('expo.tsx') },
    { find: 'expo-application', replacement: compat('expo.tsx') },
    { find: 'expo-splash-screen', replacement: compat('expo.tsx') },
    { find: 'expo-system-ui', replacement: compat('expo.tsx') },
    { find: 'expo', replacement: compat('expo.tsx') },
    { find: 'reactotron-react-native-mmkv', replacement: compat('reactotron.tsx') },
    { find: 'reactotron-react-native', replacement: compat('reactotron.tsx') },
    { find: 'reactotron-react-js', replacement: compat('reactotron.tsx') },
    { find: 'reactotron-core-client', replacement: compat('reactotron.tsx') },
    // Bridge queue (docs/plays/next-bridges.md). Anchored regexes: these
    // replacements are FILES, so a string find would map `pkg/subpath` onto
    // `<file>/subpath` — the whole id must land on the shim instead.
    { find: /^react-native-svg(\/.*)?$/, replacement: compat('svg.tsx') },
    { find: /^@react-native-async-storage\/async-storage(\/.*)?$/, replacement: compat('async-storage.ts') },
    { find: /^@react-native-community\/netinfo(\/.*)?$/, replacement: compat('netinfo.ts') },
    { find: /^expo-haptics(\/.*)?$/, replacement: compat('haptics.ts') },
    { find: /^react-native-device-info(\/.*)?$/, replacement: compat('device-info.ts') },
    { find: /^expo-constants(\/.*)?$/, replacement: compat('constants.ts') },
    { find: /^@react-native-clipboard\/clipboard(\/.*)?$/, replacement: compat('clipboard.ts') },
    { find: /^expo-clipboard(\/.*)?$/, replacement: compat('clipboard.ts') },
    { find: /^react-native-share(\/.*)?$/, replacement: compat('share.ts') },
    { find: /^expo-image-picker(\/.*)?$/, replacement: compat('image-picker.tsx') },
    { find: /^react-native-image-picker(\/.*)?$/, replacement: compat('image-picker.tsx') },
    { find: /^react-native-permissions(\/.*)?$/, replacement: compat('permissions.ts') },
    { find: /^expo-notifications(\/.*)?$/, replacement: compat('notifications.ts') },
    { find: /^react-native-vector-icons(\/.*)?$/, replacement: compat('vector-icons.tsx') },
    { find: /^expo-image(\/.*)?$/, replacement: compat('image.tsx') },
    { find: /^react-native-fast-image(\/.*)?$/, replacement: compat('image.tsx') },
    { find: /^expo-linear-gradient(\/.*)?$/, replacement: compat('linear-gradient.tsx') },
    { find: /^react-native-linear-gradient(\/.*)?$/, replacement: compat('linear-gradient.tsx') },
    { find: /^expo-blur(\/.*)?$/, replacement: compat('blur.tsx') },
    { find: /^@react-native-community\/blur(\/.*)?$/, replacement: compat('blur.tsx') },
    { find: /^@react-native-masked-view\/masked-view(\/.*)?$/, replacement: compat('masked-view.tsx') },
    { find: /^react-native-webview(\/.*)?$/, replacement: compat('webview.tsx') },
    { find: /^react-native-pager-view(\/.*)?$/, replacement: compat('pager-view.tsx') },
    reactNativeAlias()
  );
  return aliases;
}

/**
 * Vite plugin: rewrites CommonJS `require("...")` calls that RN/Expo source
 * uses for static assets and side-effect imports into hoisted ESM imports.
 *
 *   require("@assets/icons/back.png")  → import __rnReq0 from "..." (URL)
 *   require("./300Light/Font.ttf")     → import __rnReq1 from "..." (URL)
 *   require("expo-system-ui")          → import * as __rnReq2 from "..."
 *
 * Boundary-general: Metro resolves `require()` everywhere; Vite does not.
 * Applies to app source and (by default) `@expo-google-fonts/*` packages,
 * whose modules mix `export const` with `require('./*.ttf')`.
 *
 * NOTE: hoisting makes conditional requires (`if (__DEV__) require(x)`)
 * unconditional. Acceptable at this boundary — such modules are dev tooling
 * that must already be inert/aliased on this platform.
 */
export interface RnRequireOptions {
  /** node_modules package prefixes the transform also applies to. */
  includePackages?: string[];
  /** Extra asset extensions to treat as URL imports. */
  assetExtensions?: string[];
  /** Alias prefixes (e.g. {'@assets/': '/abs/path/assets/'}) so @Nx sibling
   *  probing can resolve aliased asset paths on disk. */
  assetAliases?: Record<string, string>;
}

export function rnRequirePlugin(opts: RnRequireOptions = {}): {
  name: string;
  enforce: 'pre';
  transform(code: string, id: string): { code: string; map: null } | null;
} {
  // @expo/vector-icons: FontAwesome5/6 entries carry `require('./….ttf')`
  // (the other sets use ESM ttf imports Vite already treats as assets).
  const includePackages = opts.includePackages ?? ['@expo-google-fonts/', '@expo/vector-icons/'];
  const assetAliases = opts.assetAliases ?? {};
  const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);
  const assetExts = new Set(
    (opts.assetExtensions ?? []).concat(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ttf', 'otf', 'woff', 'woff2'])
  );
  const REQUIRE_RE = /require\(\s*(['"])([^'"\n]+)\1\s*\)/g;

  /** Metro asset resolution: prefer the densest @Nx sibling on disk and carry
   *  its scale, so `require('icon.png')` yields `{uri, scale}` like RN's
   *  resolveAssetSource (a 90px @3x icon lays out at 30pt and stays crisp). */
  const resolveVariant = (spec: string, importerDir: string): { spec: string; scale: number } | null => {
    let fsPath: string | null = null;
    if (spec.startsWith('.')) fsPath = `${importerDir}/${spec}`;
    else {
      for (const [prefix, dir] of Object.entries(assetAliases)) {
        if (spec.startsWith(prefix)) fsPath = dir + spec.slice(prefix.length);
      }
    }
    if (!fsPath) return null;
    const dot = spec.lastIndexOf('.');
    for (const n of [3, 2]) {
      const variantSpec = `${spec.slice(0, dot)}@${n}x${spec.slice(dot)}`;
      const variantFs = `${fsPath.slice(0, fsPath.lastIndexOf('.'))}@${n}x${fsPath.slice(fsPath.lastIndexOf('.'))}`;
      if (existsSync(variantFs)) return { spec: variantSpec, scale: n };
    }
    return null;
  };

  return {
    name: 'native-surface:rn-require',
    enforce: 'pre',
    transform(code: string, id: string) {
      const file = id.split('?')[0]!;
      if (!/\.(ts|tsx|js|jsx|mjs)$/.test(file)) return null;
      if (file.includes('node_modules') && !includePackages.some((p) => file.includes(`node_modules/${p}`)))
        return null;
      if (!code.includes('require(')) return null;

      const imports: string[] = [];
      let n = 0;
      const importerDir = file.slice(0, file.lastIndexOf('/'));
      const out = code.replace(REQUIRE_RE, (whole, _q: string, spec: string) => {
        const ext = spec.split('.').pop()?.toLowerCase() ?? '';
        const ident = `__rnReq${n++}`;
        if (IMAGE_EXTS.has(ext)) {
          const variant = resolveVariant(spec, importerDir);
          if (variant) {
            imports.push(`import ${ident} from ${JSON.stringify(variant.spec)};`);
            return `Object.freeze({ uri: ${ident}, scale: ${variant.scale} })`;
          }
          imports.push(`import ${ident} from ${JSON.stringify(spec)};`);
          return `Object.freeze({ uri: ${ident}, scale: 1 })`;
        }
        if (assetExts.has(ext)) {
          imports.push(`import ${ident} from ${JSON.stringify(spec)};`);
          return ident;
        }
        if (!spec.startsWith('.') && !spec.startsWith('/')) {
          imports.push(`import * as ${ident} from ${JSON.stringify(spec)};`);
          return ident;
        }
        // Relative non-asset require (dev-tooling side effects): hoisted
        // namespace import; value rarely used.
        imports.push(`import * as ${ident} from ${JSON.stringify(spec)};`);
        return ident;
      });
      if (imports.length === 0) return null;
      return { code: `${imports.join('\n')}\n${out}`, map: null };
    },
  };
}

/**
 * Vite helper: Metro-parity workletization of RN libraries in node_modules.
 *
 * Metro runs `react-native-reanimated/plugin` over EVERY file, node_modules
 * included; published RN libraries rely on that and ship un-workletized code.
 * Without the plugin, a bare `useDerivedValue(fn)` / `useAnimatedStyle(fn)`
 * has no `__closure`, so on web its mapper registers zero inputs and the
 * value goes inert after the initial evaluation (reanimated's documented
 * behavior: explicit deps arrays are "only relevant without the Babel plugin
 * on the Web"). @vitejs/plugin-react applies the plugin to app source only —
 * this plugin covers the node_modules half of the toolchain.
 *
 * Scope: node_modules JS that mentions worklets or reanimated, excluding
 * reanimated itself (its lib ships its own web runtime and is handled by the
 * consumer's JSX transform). Babel and the reanimated plugin resolve from the
 * consumer app's root so the plugin version matches the runtime version.
 */
export function rnWorkletsPlugin(opts: PresetResolveOptions = {}): {
  name: string;
  configResolved(config: { root?: string }): void;
  transform(code: string, id: string): Promise<{ code: string; map: unknown } | null>;
} {
  const rooted = rootedRequire(opts.resolveFrom);
  let babel: typeof import('@babel/core') | null = null;
  let reanimatedPlugin: string | null = null;
  let unavailable = false;
  return {
    name: 'native-surface:rn-worklets',
    configResolved(config) {
      rooted.onConfigResolved(config);
    },
    async transform(code: string, id: string) {
      const file = id.split('?')[0]!;
      if (!file.includes('node_modules')) return null;
      // Vite dep-cache chunks are prebundled output, never workletization
      // targets (react-dom's dev bundle even contains the string "worklet").
      if (file.includes('/.vite/') || file.includes('/.vite-')) return null;
      if (file.includes('react-native-reanimated')) return null;
      if (!/\.[cm]?js$/.test(file)) return null;
      if (!code.includes('worklet') && !code.includes('react-native-reanimated')) return null;
      if (unavailable) return null;
      try {
        babel ??= rooted.req('@babel/core') as typeof import('@babel/core');
        reanimatedPlugin ??= rooted.req.resolve('react-native-reanimated/plugin');
      } catch {
        // Project doesn't ship reanimated (or babel): the plugin goes inert
        // instead of 500ing every module — un-workletized libraries then
        // behave exactly as they would without this plugin.
        unavailable = true;
        return null;
      }
      const result = await babel.transformAsync(code, {
        filename: file,
        configFile: false,
        babelrc: false,
        compact: false,
        plugins: [reanimatedPlugin],
        sourceMaps: true,
      });
      if (!result?.code) return null;
      return { code: result.code, map: result.map };
    },
  };
}

/**
 * Package resolution for the preset's build-time dependencies (vite, babel,
 * reanimated's babel plugin). These live in the CONSUMER's tree, not ours, so
 * a plain import would fail under pnpm. Resolution starts at `resolveFrom`
 * (default cwd) and re-roots itself at Vite's resolved project root — cwd is
 * not the project root in programmatic servers (test sandboxes, tools that
 * spawn Vite from elsewhere).
 */
interface RootedRequire {
  req: NodeJS.Require;
  onConfigResolved(config: { root?: string }): void;
}

function rootedRequire(resolveFrom?: string): RootedRequire {
  const holder: RootedRequire = {
    req: createRequire(`${resolveFrom ?? process.cwd()}/`),
    onConfigResolved(config) {
      if (!resolveFrom && config?.root) holder.req = createRequire(`${config.root}/`);
    },
  };
  return holder;
}

/** Vite's default client conditions (Vite 6+): setting resolve.conditions
 *  REPLACES these, so any config layer contributing conditions must restate
 *  them. Used when `vite` itself cannot be resolved for the live list. */
const DEFAULT_CLIENT_CONDITIONS = ['module', 'browser', 'development|production'];

export interface PresetResolveOptions {
  /** Directory whose node_modules supplies vite/babel/reanimated (default:
   *  cwd, re-rooted at Vite's project root once config resolves). */
  resolveFrom?: string;
}

/** Structural view of the consumer's vite module: which transformer it
 *  exposes varies by version (Vite ≤7 bundles esbuild; Vite 8 / rolldown-vite
 *  drops it and exposes oxc instead), so both are optional and feature-
 *  detected — a nominal `typeof import('vite')` would pin us to one. */
interface ViteTransformers {
  transformWithEsbuild?: (
    code: string,
    filename: string,
    options?: object
  ) => Promise<{ code: string; map: unknown }>;
  transformWithOxc?: (
    code: string,
    filename: string,
    options?: object
  ) => Promise<{ code: string; map?: unknown }>;
}

/** RN-ecosystem packages that ship raw JSX inside plain .js files: Metro runs
 *  Babel over everything, so publishing untranspiled JSX is normal there —
 *  reanimated does it, and @expo/vector-icons' build/ + vendored
 *  react-native-vector-icons do too. Matched as path substrings, which holds
 *  under both flat and pnpm node_modules layouts. */
const RAW_JSX_LIB_PREFIXES = ['react-native-reanimated', '@expo/vector-icons'];

/**
 * Vite helper: some RN libraries ship raw JSX inside .js files (Metro runs
 * Babel over everything; Rollup/esbuild do not) — see RAW_JSX_LIB_PREFIXES.
 * Parse those files as JSX.
 * Part of the `nativeSurface()` preset; exported for à-la-carte configs.
 *
 * Transformer choice: prefers `transformWithOxc` when the consumer's vite
 * exposes it (Vite 8 / rolldown-vite), falling back to `transformWithEsbuild`.
 * Vite 8 no longer ships esbuild as a dependency, so its transformWithEsbuild
 * throws "requires esbuild to be installed" at call time — that case is
 * rethrown with the actual fix (install esbuild, or upgrade to an oxc vite).
 */
export function rnLibJsxPlugin(opts: PresetResolveOptions = {}): {
  name: string;
  enforce: 'pre';
  configResolved(config: { root?: string }): void;
  transform(code: string, id: string): Promise<{ code: string; map: null } | null>;
} {
  const rooted = rootedRequire(opts.resolveFrom);
  return {
    name: 'native-surface:rn-lib-jsx',
    enforce: 'pre',
    configResolved(config) {
      rooted.onConfigResolved(config);
    },
    async transform(code: string, id: string) {
      // Dev-server ids carry `?v=<hash>` — match on the query-stripped path
      // (build ids have no query, so this covers both modes).
      const path = id.split('?')[0] ?? id;
      if (path.includes('/.vite/')) return null;
      if (RAW_JSX_LIB_PREFIXES.some((p) => path.includes(p)) && path.endsWith('.js')) {
        let vite: ViteTransformers;
        try {
          vite = rooted.req('vite') as ViteTransformers;
        } catch {
          // A raw-JSX library file reached this transform, so the project
          // needs it: failing loud beats a cryptic esbuild JSX parse error
          // downstream.
          throw new Error(
            `native-surface: cannot resolve 'vite' from the project root to JSX-transform ${path}; ` +
              `pass rnLibJsxPlugin({ resolveFrom }) pointing at the app's directory`
          );
        }
        if (typeof vite.transformWithOxc === 'function') {
          try {
            const out = await vite.transformWithOxc(code, path, {
              lang: 'jsx',
              jsx: { runtime: 'automatic' },
            });
            return { code: out.code, map: (out.map ?? null) as null };
          } catch {
            // Defensive: the oxc option shape is vite's, not ours — on drift
            // (or a missing native binding) fall through to esbuild rather
            // than 500 every raw-JSX library module.
          }
        }
        if (typeof vite.transformWithEsbuild !== 'function') {
          throw new Error(
            `native-surface: this vite exposes neither transformWithOxc nor transformWithEsbuild; ` +
              `cannot JSX-transform ${path}`
          );
        }
        try {
          const out = await vite.transformWithEsbuild(code, path, { loader: 'jsx', jsx: 'automatic' });
          // esbuild's SourceMap type and rollup's SourceMapInput disagree structurally
          return { code: out.code, map: out.map as unknown as null };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          // Vite 8 keeps transformWithEsbuild but lazy-loads esbuild, which is
          // no longer a vite dependency — surface the actual fix instead of
          // its "Failed to load" message.
          if (/esbuild/i.test(msg) && /install|resolv|found|load/i.test(msg)) {
            throw new Error(
              `native-surface: JSX-transforming ${path} needs esbuild, which this vite no longer bundles — ` +
                `run \`npm i -D esbuild\` in the app (or use a vite version exposing transformWithOxc). ` +
                `Original error: ${msg}`
            );
          }
          throw err;
        }
      }
      return null;
    },
  };
}

/** Packages from the excluded (raw-served) RN-lib set whose trees contain
 *  bare CJS leaves that sibling files import with ESM named imports — e.g.
 *  @expo/vector-icons' vendored object-utils.js (`module.exports = { pick,
 *  omit }`) imported by icon-button.js as `import { pick, omit }`. Metro
 *  interops CJS/ESM per file; Vite's dev server serves excluded packages raw,
 *  so the browser dies with "does not provide an export named …". */
const CJS_INTEROP_PACKAGES = ['@expo/vector-icons'];

/**
 * Vite helper: ESM-wrap bare CJS files inside CJS_INTEROP_PACKAGES so their
 * named imports bind in dev. Build mode never strictly needs it
 * (rollup-commonjs interops there), but the transform applies in both modes
 * so dev and build serve one shape. Files with any ESM syntax of their own
 * are left alone — they already interop through the module graph.
 * Part of the `nativeSurface()` preset; exported for à-la-carte configs.
 */
export function rnCjsInteropPlugin(): {
  name: string;
  enforce: 'pre';
  transform(code: string, id: string): { code: string; map: null } | null;
} {
  return {
    name: 'native-surface:rn-cjs-interop',
    enforce: 'pre',
    transform(code: string, id: string) {
      const path = id.split('?')[0] ?? id;
      if (path.includes('/.vite/') || path.includes('/.vite-')) return null;
      if (!/\.c?js$/.test(path)) return null;
      if (!CJS_INTEROP_PACKAGES.some((p) => path.includes(p))) return null;
      if (!code.includes('module.exports')) return null;
      if (/^\s*(import|export)\b/m.test(code)) return null;
      // Named bindings come from the LAST `module.exports = { … }` object
      // literal; through aliased intermediates, because `export { pick }`
      // directly would collide with the file's own top-level declarations.
      const assignments = [...code.matchAll(/module\.exports\s*=\s*\{([^{}]*)\}/g)];
      const names: string[] = [];
      const body = assignments[assignments.length - 1]?.[1];
      if (body) {
        for (const entry of body.split(',')) {
          const name = entry.split(':')[0]!.trim();
          if (/^[A-Za-z_$][\w$]*$/.test(name)) names.push(name);
        }
      }
      let tail = '\nexport default module.exports;';
      if (names.length > 0) {
        tail +=
          `\n${names.map((n, i) => `const __cjsX${i} = module.exports[${JSON.stringify(n)}];`).join('\n')}` +
          `\nexport { ${names.map((n, i) => `__cjsX${i} as ${n}`).join(', ')} };`;
      }
      return {
        code: `const module = { exports: {} }; const exports = module.exports;\n${code}${tail}`,
        map: null,
      };
    },
  };
}

export interface NativeSurfacePresetOptions extends NativeSurfaceAliasOptions, PresetResolveOptions {
  /** Platform whose file extensions and Platform.OS the surface reports. */
  platform?: 'ios' | 'android';
  /** Alias prefixes for `require('<prefix>/asset.png')` @Nx sibling probing
   *  (see RnRequireOptions.assetAliases). */
  assetAliases?: Record<string, string>;
  /** node_modules package prefixes rnRequirePlugin should also transform. */
  requireIncludePackages?: string[];
}

/** Standard-boundary ESM packages that import the aliased 'react-native':
 *  prebundling would freeze a private copy of the engine inside the dep chunk
 *  (stale code + duplicated singletons). Excluding a package that isn't
 *  installed is harmless, so the list is unconditional. */
const RN_ECOSYSTEM_EXCLUDES = [
  '@react-navigation/native',
  '@react-navigation/core',
  '@react-navigation/elements',
  '@react-navigation/stack',
  '@react-navigation/bottom-tabs',
  '@react-navigation/routers',
  'react-native-screens',
  'react-native-safe-area-context',
  'react-native-gesture-handler',
  // Also raw JSX in .js files: the dep scanner (raw esbuild, runs before the
  // plugin pipeline, so rnLibJsxPlugin can't help it) dies parsing the
  // package unless it's marked external here.
  '@expo/vector-icons',
];

/** A second copy of any of these = raw-CJS imports outside the include list
 *  plus split navigation singletons. Deduping the uninstalled is harmless. */
const RN_ECOSYSTEM_DEDUPE = [
  '@react-navigation/native',
  '@react-navigation/core',
  '@react-navigation/elements',
  '@react-navigation/stack',
  '@react-navigation/bottom-tabs',
  '@react-navigation/routers',
  'use-latest-callback',
];

/** CJS leaves that MUST be prebundled: served raw, their named/default
 *  exports don't exist as ESM bindings. The engine's own (named bindings from
 *  react-reconciler/constants, the default from canvaskit.js — without them
 *  the canvas never mounts and the surface stays blank) plus the CJS deps of
 *  the excluded navigation packages. Filtered at config time to what actually
 *  resolves from the app root, because Vite logs a failure for every
 *  unresolvable include. The .wasm asset itself is fetched, never prebundled. */
const CJS_LEAF_INCLUDES = [
  'react-reconciler',
  'react-reconciler/constants',
  'scheduler',
  'canvaskit-wasm',
  'canvaskit-wasm/bin/canvaskit.js',
  'react-is',
  'use-latest-callback',
  'escape-string-regexp',
  'fast-deep-equal',
  'query-string',
  'nanoid/non-secure',
  'use-sync-external-store/shim',
  'use-sync-external-store/with-selector',
  'color',
  // rnLibJsxPlugin emits automatic-runtime JSX imports INTO node_modules
  // files, so the preset — not @vitejs/plugin-react, which some apps don't
  // use — must guarantee these CJS entries are interop-bundled.
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
];

/**
 * One-call preset: everything a Vite app needs to render React Native
 * component trees with <NativeSurface>. Composes the platform-extension
 * resolver, the raw-JSX loader, the require/asset transform, the CJS-interop
 * wrapper, the node_modules workletizer, and a config layer (react-native alias + compat
 * shims, Metro-parity resolve conditions, RN globals, react/reanimated
 * dedupe, reanimated un-prebundled).
 *
 *   import { nativeSurface } from 'native-surface/vite'
 *   import react from '@vitejs/plugin-react'
 *   export default defineConfig({
 *     plugins: [
 *       ...nativeSurface({ platform: 'ios', reanimated: 'real' }),
 *       // App-source worklets need reanimated's Babel plugin (Metro parity):
 *       react({ babel: { plugins: ['react-native-reanimated/plugin'] } }),
 *     ],
 *   })
 *
 * The preset owns the STANDARD boundary end to end: mode-scoped optimizer
 * cacheDir, optimizeDeps excludes/includes and dedupe for the react-navigation
 * ecosystem and the engine's own CJS leaves. App-specific concerns stay with
 * the consumer: optimizeDeps entries for the app's own libraries (e.g.
 * bottom-sheet), pnpm `>` nested-include chains (they encode the app's
 * dependency graph), and its own path aliases. Arrays returned here are
 * CONCATENATED with the user's by Vite's config merge, so both layers add up.
 */
export function nativeSurface(opts: NativeSurfacePresetOptions = {}): PluginOption[] {
  const configPlugin = {
    name: 'native-surface:config',
    config(user: { root?: string; cacheDir?: string } | undefined, env: { mode: string }) {
      // Resolve vite from the app's own root (cwd is wrong for programmatic
      // servers); when unresolvable, restate Vite's defaults ourselves —
      // setting resolve.conditions REPLACES them, so an empty fallback would
      // break every bare-specifier resolve.
      const req = createRequire(`${opts.resolveFrom ?? user?.root ?? process.cwd()}/`);
      const resolvable = (id: string): boolean => {
        try {
          req.resolve(id);
          return true;
        } catch {
          return false;
        }
      };
      // Reanimated mode: an explicit option always wins; otherwise detected
      // here, where the app root is known — 'real' iff the package resolves
      // from it, so apps without reanimated never chase a missing import.
      const reanimated = opts.reanimated ?? (resolvable('react-native-reanimated') ? 'real' : 'shim');
      let defaults: string[] = DEFAULT_CLIENT_CONDITIONS;
      try {
        const live = (req('vite') as typeof import('vite')).defaultClientConditions;
        if (live?.length) defaults = live as string[];
      } catch {
        /* fall back to the hardcoded list above */
      }
      return {
        // Scope the optimizer cache to the reanimated mode: the cache can
        // survive config-change restarts, and a stale cache from the other
        // mode silently serves the wrong reanimated. Plugin config results
        // are merged over the user config (scalars OVERRIDE), so an explicit
        // user cacheDir must win by us not setting one at all.
        ...(user?.cacheDir === undefined
          ? { cacheDir: `node_modules/.vite-native-surface-${reanimated}` }
          : {}),
        define: {
          // RN libraries expect Metro's compile-time __DEV__; JEST_WORKER_ID
          // keeps reanimated's isJest() probe off bare `process`.
          __DEV__: JSON.stringify(env.mode !== 'production'),
          global: 'globalThis',
          'process.env.JEST_WORKER_ID': 'undefined',
        },
        resolve: {
          conditions: [...nativeSurfaceConditions(), ...defaults],
          // Two Reacts = broken hooks; a second reanimated = two UI runtimes.
          dedupe: ['react', 'react-dom', 'react-native-reanimated', ...RN_ECOSYSTEM_DEDUPE],
          alias: nativeSurfaceAliases({ reanimated, screens: opts.screens }),
        },
        optimizeDeps: {
          // Reanimated stays conditional: in 'real' mode it imports the
          // aliased 'react-native' and must not be prebundled either.
          exclude: [...RN_ECOSYSTEM_EXCLUDES, ...(reanimated === 'real' ? ['react-native-reanimated'] : [])],
          include: CJS_LEAF_INCLUDES.filter(resolvable),
        },
      };
    },
  };
  // The plugin helpers type their hooks structurally (no vite value import),
  // so they don't satisfy vite's Plugin interface nominally — but each is a
  // valid plugin object at runtime.
  return [
    rnPlatformExtensionsPlugin({ platform: opts.platform ?? 'ios' }),
    rnLibJsxPlugin({ resolveFrom: opts.resolveFrom }),
    rnRequirePlugin({
      assetAliases: opts.assetAliases,
      includePackages: opts.requireIncludePackages,
    }),
    rnCjsInteropPlugin(),
    rnWorkletsPlugin({ resolveFrom: opts.resolveFrom }),
    configPlugin,
  ] as PluginOption[];
}

// ---------------------------------------------------------------------------
// Deprecated pre-rename API — kept so existing configs and integrations keep
// working; new code should use the nativeSurface* names above.
// ---------------------------------------------------------------------------

/** @deprecated Renamed — use {@link NativeSurfaceAliasOptions}. */
export type CanvasNativeAliasOptions = NativeSurfaceAliasOptions;
/** @deprecated Renamed — use {@link nativeSurfaceAliases}. */
export const canvasNativeAliases = nativeSurfaceAliases;
/** @deprecated Renamed — use {@link nativeSurfaceConditions}. */
export const canvasNativeConditions = nativeSurfaceConditions;
