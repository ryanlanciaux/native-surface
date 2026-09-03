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
  /**
   * Whether @react-navigation/stack resolves from the app. The native-stack
   * adapter is built on it, so when it is absent the adapter cannot be the
   * answer and the alias is dropped. The nativeSurface() preset detects this;
   * à-la-carte callers of nativeSurfaceAliases() may pass it explicitly.
   */
  jsStackAvailable?: boolean;
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

const SUFFIXABLE = /\.(js|jsx|ts|tsx|mjs)$/;

/**
 * Metro's platform-suffix preference for one already-resolved file:
 * `.{platform}.` → `.native.` → the file as given, inverted to `.web.` first
 * for the packages whose web build is the faithful one here.
 *
 * Returns null when the file is not suffixable, already carries a platform
 * suffix, or has no sibling — i.e. "leave this resolution alone".
 */
function platformSibling(file: string, platform: 'ios' | 'android', webVariantPackages: string[]): string | null {
  if (!SUFFIXABLE.test(file) || file.includes('/.vite/')) return null;
  if (new RegExp(`\\.(${platform}|native|android|ios|web)\\.(js|jsx|ts|tsx|mjs)$`).test(file)) return null;
  const ext = file.slice(file.lastIndexOf('.'));
  const base = file.slice(0, -ext.length);
  // Opt-in inversion: some libraries implement this platform's real
  // capabilities in their `.web.*` files (reanimated 4's web runtime is the
  // canonical case — its native path constructs a TurboModule that cannot
  // exist here). For those packages the WEB variant is the faithful one.
  //
  // Note there is NO fallback to `.{platform}`/`.native` here, and that is the
  // whole point rather than an omission. In Metro's convention the unsuffixed
  // file IS the web build — `.web.*` only exists where a package needed to
  // split web off from a shared default — so "no `.web` sibling" means the
  // resolved file is already the web one. Falling through to `.native` would
  // hand back exactly the native implementation the inversion exists to avoid:
  // react-native-worklets has `WorkletsModule/NativeWorklets.native.js` with no
  // `.web` sibling, and preferring it pulls in `../memory/valueUnpacker`, a
  // native-only module that does not exist at all.
  const suffixes = webVariantPackages.some((p) => file.includes(p))
    ? ['.web']
    : [`.${platform}`, '.native'];
  for (const suffix of suffixes) {
    const candidate = `${base}${suffix}${ext}`;
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Metro platform-extension resolution: RN packages split files as
 * `Foo.ios.js` / `Foo.android.js` / `Foo.native.js` / `Foo.js` (web last),
 * and Metro picks by platform suffix — react-native-drawer-layout's
 * `Drawer.js` is its WEB implementation, `Drawer.native.js` the RN one.
 * This resolver re-checks every default-resolved `.js/.ts(x)` file for a
 * platform-suffixed sibling and prefers it, matching Metro's order:
 * `.{platform}.` → `.native.` → plain.
 *
 * This covers the DEV/BUILD module graph. Dependency PREBUNDLING is a separate
 * resolver (esbuild's own) that never consults Vite plugins — see
 * {@link rnPlatformExtensionsEsbuildPlugin}, which the preset installs
 * alongside this one so both halves agree.
 */
export function rnPlatformExtensionsPlugin(
  opts: { platform?: 'ios' | 'android'; webVariantPackages?: string[] } = {}
): {
  name: string;
  enforce: 'pre';
  resolveId(source: string, importer: string | undefined, options: unknown): Promise<string | null>;
} {
  const platform = opts.platform ?? 'ios';
  // Held by REFERENCE, not copied: the nativeSurface() preset appends its
  // auto-detected entries from the `config` hook, which is the first moment
  // the app root is known — and `config` runs before any `resolveId`.
  const webVariantPackages = opts.webVariantPackages ?? [];

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
      const sibling = platformSibling(file, platform, webVariantPackages);
      if (!sibling) return null;
      return query ? `${sibling}?${query}` : sibling;
    },
  };
}

/** The subset of esbuild's plugin API this uses, typed structurally so the
 *  preset never has to import esbuild (it is not a dependency here). */
interface EsbuildPluginBuild {
  onResolve(
    options: { filter: RegExp },
    callback: (args: {
      path: string;
      importer: string;
      resolveDir: string;
      kind: string;
      namespace: string;
      pluginData?: unknown;
    }) => Promise<{ path?: string; external?: boolean; errors?: unknown[] } | null | undefined>
  ): void;
  resolve(
    path: string,
    options: { importer?: string; resolveDir?: string; kind?: string; pluginData?: unknown }
  ): Promise<{ path: string; external: boolean; errors: unknown[]; namespace: string }>;
}

export interface EsbuildPluginLike {
  name: string;
  setup(build: EsbuildPluginBuild): void;
}

/**
 * The same Metro platform preference, for the DEPENDENCY OPTIMIZER.
 *
 * Prebundling does its own resolution in esbuild and never runs Vite's plugin
 * pipeline, so `rnPlatformExtensionsPlugin` cannot see it: every prebundled
 * package gets its WEB file frozen into the dep chunk. That has been patched
 * one package at a time by adding names to `optimizeDeps.exclude`, which only
 * works for packages someone already tripped over — and excluding is a real
 * cost (raw-served CJS loses its named-export bindings, which is exactly why
 * some of these packages are prebundled on purpose).
 *
 * Two concrete cases this fixes rather than trades away: `@bsky.app/alf` ships
 * `platform/index.js` with `isWeb = true` next to `platform/index.native.js`,
 * and it MUST stay prebundled because its index re-exports through a runtime
 * `__exportStar` that only the optimizer's CJS analysis can resolve — so
 * excluding it is not available as a fix, and the frozen web build made an
 * entire app take web branches (`minHeight: '100dvh'`, which Yoga cannot
 * express) and collapse to zero height. Reanimated 4's worklets runtime is the
 * mirror image: prebundled, it froze the `.native` files the `.web` inversion
 * exists to avoid.
 */
export function rnPlatformExtensionsEsbuildPlugin(
  opts: { platform?: 'ios' | 'android'; webVariantPackages?: string[] } = {}
): EsbuildPluginLike {
  const platform = opts.platform ?? 'ios';
  const webVariantPackages = opts.webVariantPackages ?? [];
  return {
    name: 'native-surface:rn-platform-extensions-esbuild',
    setup(build) {
      build.onResolve({ filter: /.*/ }, async (args) => {
        // Re-entry guard: the build.resolve() below comes back through this
        // same callback, and without the marker it recurses forever.
        if ((args.pluginData as { nativeSurfaceResolved?: boolean } | undefined)?.nativeSurfaceResolved) return null;
        const resolved = await build.resolve(args.path, {
          importer: args.importer,
          resolveDir: args.resolveDir,
          kind: args.kind,
          pluginData: { nativeSurfaceResolved: true },
        });
        // Let esbuild own errors, externals and virtual modules unchanged;
        // this plugin only ever re-points a real file at its sibling.
        if (resolved.errors.length > 0 || resolved.external || resolved.namespace !== 'file') return null;
        const sibling = platformSibling(resolved.path, platform, webVariantPackages);
        return sibling ? { path: sibling } : { path: resolved.path };
      });
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
    // The adapter maps native-stack onto the JS stack, so it is only viable
    // when @react-navigation/stack is actually installed. An app that uses
    // native-stack WITHOUT the JS stack (a valid, common dependency set) must
    // not have this alias applied — it would turn a working install into an
    // unresolvable import. Those apps fall through to the real native-stack
    // over the screens shim.
    ...(opts.jsStackAvailable === false
      ? []
      : [{ find: '@react-navigation/native-stack', replacement: compat('native-stack.tsx') }]),
    { find: 'expo-font', replacement: compat('expo.tsx') },
    { find: 'expo-linking', replacement: compat('expo.tsx') },
    { find: 'expo-localization', replacement: compat('expo.tsx') },
    { find: 'expo-application', replacement: compat('expo.tsx') },
    { find: 'expo-splash-screen', replacement: compat('expo.tsx') },
    { find: 'expo-system-ui', replacement: compat('expo.tsx') },
    // Before the bare 'expo' find, which would otherwise swallow the subpath.
    { find: /^expo-modules-core(\/.*)?$/, replacement: compat('expo-modules-core.tsx') },
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
    // Browser-API-backed Expo modules. Each maps onto a real web API and
    // reports honestly where none exists (no geocoder, no background
    // location, no OTA channel) — see each shim's header for its ceiling.
    { find: /^expo-web-browser(\/.*)?$/, replacement: compat('web-browser.ts') },
    { find: /^expo-sharing(\/.*)?$/, replacement: compat('sharing.ts') },
    { find: /^expo-location(\/.*)?$/, replacement: compat('location.ts') },
    { find: /^expo-device(\/.*)?$/, replacement: compat('device.ts') },
    { find: /^expo-keep-awake(\/.*)?$/, replacement: compat('keep-awake.ts') },
    { find: /^expo-screen-orientation(\/.*)?$/, replacement: compat('screen-orientation.ts') },
    { find: /^expo-updates(\/.*)?$/, replacement: compat('updates.ts') },
    // One module serves both of expo-file-system's SDK-57 surfaces: the
    // `(\/.*)?$` group lands `expo-file-system/legacy` on the same file, so
    // the object API and the legacy function API share one virtual
    // filesystem. Same for expo-media-library's `/legacy` and `/next`.
    { find: /^expo-file-system(\/.*)?$/, replacement: compat('file-system.ts') },
    { find: /^expo-media-library(\/.*)?$/, replacement: compat('media-library.ts') },
    // Anchored, so this cannot be swallowed by the expo-image entry above:
    // that one requires `/` or end-of-string straight after `expo-image`.
    { find: /^expo-image-manipulator(\/.*)?$/, replacement: compat('image-manipulator.ts') },
    // Video rides the portal seam (a real <video> tracked to the node's
    // frame). Thumbnails are a sibling module so expo-video's namespace does
    // not carry a stray getThumbnailAsync.
    { find: /^expo-video(\/.*)?$/, replacement: compat('video.tsx') },
    { find: /^expo-video-thumbnails(\/.*)?$/, replacement: compat('video-thumbnails.ts') },
    // Its unlinked stub is a Proxy that THROWS on every property access, so an
    // app calling `clearCache()` at startup dies before it renders. The
    // metadata half is real here (a <video> knows its own dimensions and
    // duration); compression is not — see the shim.
    { find: /^react-native-compressor(\/.*)?$/, replacement: compat('compressor.ts') },
    /**
     * react-responsive resolves through `window.matchMedia`, which on this
     * host answers about the BROWSER WINDOW rather than the surface. An app
     * rendering a 390pt surface inside a 1400px window is then told it is on a
     * desktop and takes every desktop branch. On a device there is no
     * matchMedia at all, so the same code answers false and lays out for a
     * phone — which is the behaviour the shim restores.
     */
    { find: /^react-responsive(\/.*)?$/, replacement: compat('responsive.tsx') },
    reactNativeAlias()
  );
  return aliases.filter(shimExists);
}

/**
 * Drops an alias whose shim file is not on disk.
 *
 * `compat()` resolves each shim through @native-surface/compat's exports map
 * and falls back to a workspace-relative path when that fails. Both can miss
 * against a compat install older than the engine — a newer shim simply has no
 * export entry yet — and the result is an alias pointing at a file that does
 * not exist. Vite then fails the import from the APP's own source, naming a
 * path inside node_modules that the app never wrote, which is close to
 * undebuggable.
 *
 * Dropping it instead lets the real package resolve. That is strictly better:
 * the package may work, and where it needs a native module the registry's
 * inert policy already answers for it. Same reasoning as the native-stack
 * alias being dropped when @react-navigation/stack is absent — an alias that
 * cannot be honored must not be claimed.
 */
const missingShims = new Set<string>();
function shimExists(alias: NativeSurfaceAlias): boolean {
  // The engine entry is this package's own source, and assets/ paths are not
  // shim files; only compat replacements can go missing.
  if (alias.replacement === ENGINE_ENTRY || existsSync(alias.replacement)) return true;
  if (!missingShims.has(alias.replacement)) {
    missingShims.add(alias.replacement);
    console.warn(
      `native-surface: skipping the alias for ${String(alias.find)} — its compat shim is missing at ` +
        `${alias.replacement}. @native-surface/compat is probably older than native-surface; ` +
        `reinstall so the two match. The real package will be used instead.`
    );
  }
  return false;
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
 * that must already be inert/aliased on this platform. A bare specifier that
 * does NOT resolve is left as a literal `require()` instead: libraries probe
 * for OPTIONAL packages through try/catch'd requires (paper's icon loader
 * tries three icon packages), and hoisting an uninstalled one turns its
 * caught ReferenceError into an unresolvable import that kills the module.
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
  transform(code: string, id: string): Promise<{ code: string; map: null } | null>;
} {
  // @expo/vector-icons: FontAwesome5/6 entries carry `require('./….ttf')`
  // (the other sets use ESM ttf imports Vite already treats as assets).
  // react-native-paper: Appbar.BackIcon's ios branch does a RENDER-TIME
  // `require('../../assets/back-chevron.png')` — the only way that asset
  // reaches the surface is as a hoisted URL import.
  const includePackages = opts.includePackages ?? [
    '@expo-google-fonts/',
    '@expo/vector-icons/',
    'react-native-paper/',
  ];
  const assetAliases = opts.assetAliases ?? {};
  const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);
  const assetExts = new Set(
    (opts.assetExtensions ?? []).concat(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ttf', 'otf', 'woff', 'woff2'])
  );
  const REQUIRE_RE = /require\(\s*(['"])([^'"\n]+)\1\s*\)/g;

  /** Characters after which a `/` opens a regex literal rather than dividing. */
  const REGEX_AFTER = /[({[,;:=!&|?+\-*%~^<>]/;
  const REGEX_AFTER_KEYWORD = /(?:^|[^\w$.])(return|typeof|case|in|of|do|else|yield|await|delete|void|new|instanceof)\s*$/;

  /**
   * Comment text blanked to spaces, every other offset (and every newline)
   * left in place, so a match found in the masked copy indexes straight into
   * the original. Needed because RN library JSDoc is full of EXAMPLE requires:
   * paper's `<Avatar.Image source={require('../assets/avatar.png')} />` names
   * a file that doesn't exist, and hoisting it breaks the module.
   *
   * A lexer-lite, not a regex strip: strings and template literals must be
   * tracked or `'https://x'` would open a bogus line comment, and regex
   * literals must be too or `/a\/\/b/` would. Regex-vs-division uses the
   * classic previous-token heuristic; template `${…}` interiors are treated
   * as string body, so a require inside one stays un-hoisted (the safe way to
   * be wrong).
   */
  const maskComments = (code: string): string => {
    const out = code.split('');
    const n = code.length;
    let i = 0;
    let prev = '';
    const blank = (from: number, to: number): void => {
      for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' ';
    };
    while (i < n) {
      const c = code[i]!;
      const next = code[i + 1];
      if (c === '/' && next === '/') {
        let j = i + 2;
        while (j < n && code[j] !== '\n') j++;
        blank(i, j);
        i = j;
        continue;
      }
      if (c === '/' && next === '*') {
        let j = i + 2;
        while (j < n && !(code[j] === '*' && code[j + 1] === '/')) j++;
        j = Math.min(n, j + 2);
        blank(i, j);
        i = j;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') {
        let j = i + 1;
        while (j < n) {
          if (code[j] === '\\') {
            j += 2;
            continue;
          }
          if (code[j] === c) {
            j++;
            break;
          }
          j++;
        }
        i = j;
        prev = c;
        continue;
      }
      if (
        c === '/' &&
        (prev === '' || REGEX_AFTER.test(prev) || REGEX_AFTER_KEYWORD.test(code.slice(Math.max(0, i - 16), i)))
      ) {
        let j = i + 1;
        let inClass = false;
        while (j < n) {
          const d = code[j]!;
          if (d === '\\') {
            j += 2;
            continue;
          }
          if (d === '\n') break; // unterminated: it wasn't a regex after all
          if (d === '[') inClass = true;
          else if (d === ']') inClass = false;
          else if (d === '/' && !inClass) {
            j++;
            break;
          }
          j++;
        }
        i = j;
        prev = '/';
        continue;
      }
      if (!/\s/.test(c)) prev = c;
      i++;
    }
    return out.join('');
  };

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
    async transform(code: string, id: string) {
      const file = id.split('?')[0]!;
      if (!/\.(ts|tsx|js|jsx|mjs)$/.test(file)) return null;
      if (file.includes('node_modules') && !includePackages.some((p) => file.includes(`node_modules/${p}`)))
        return null;
      if (!code.includes('require(')) return null;

      // Optional-dependency probe: only hoist a bare specifier that actually
      // resolves. Uses the plugin container (aliases + conditions included);
      // where there is none, every specifier is assumed resolvable, which is
      // the pre-guard behavior.
      const ctx = this as unknown as {
        resolve?(s: string, i: string, o: object): Promise<{ id: string } | null>;
      };
      const resolves = async (spec: string): Promise<boolean> => {
        if (typeof ctx.resolve !== 'function') return true;
        try {
          const hit = await ctx.resolve(spec, file, { skipSelf: true });
          // A REAL module, not just an answer: a host tool may resolve every
          // bare specifier to a virtual stub (the playground's not-bridged
          // auditor does, so missing packages fail per story instead of 500ing
          // the server), and satisfying an optional-dependency probe with one
          // would make the library's FIRST candidate always win.
          return hit != null && existsSync(hit.id.split('?')[0]!);
        } catch {
          return false;
        }
      };

      const imports: string[] = [];
      let n = 0;
      const importerDir = file.slice(0, file.lastIndexOf('/'));
      const masked = maskComments(code);
      let out = '';
      let cursor = 0;
      // matchAll, not exec-in-a-loop: this loop awaits, and Vite transforms
      // files concurrently — a shared /g regex's lastIndex would interleave.
      for (const m of masked.matchAll(REQUIRE_RE)) {
        const spec = m[2]!;
        const ext = spec.split('.').pop()?.toLowerCase() ?? '';
        const bare = !spec.startsWith('.') && !spec.startsWith('/');
        let replacement: string;
        if (IMAGE_EXTS.has(ext)) {
          const ident = `__rnReq${n++}`;
          const variant = resolveVariant(spec, importerDir);
          imports.push(`import ${ident} from ${JSON.stringify(variant?.spec ?? spec)};`);
          replacement = `Object.freeze({ uri: ${ident}, scale: ${variant?.scale ?? 1} })`;
        } else if (assetExts.has(ext)) {
          const ident = `__rnReq${n++}`;
          imports.push(`import ${ident} from ${JSON.stringify(spec)};`);
          replacement = ident;
        } else if (bare && !(await resolves(spec))) {
          continue; // left literal: the library's own try/catch handles it
        } else {
          // Bare package or relative non-asset require (dev-tooling side
          // effects): hoisted namespace import; value rarely used.
          const ident = `__rnReq${n++}`;
          imports.push(`import * as ${ident} from ${JSON.stringify(spec)};`);
          replacement = ident;
        }
        out += code.slice(cursor, m.index) + replacement;
        cursor = m.index + m[0]!.length;
      }
      if (imports.length === 0) return null;
      out += code.slice(cursor);
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
  /** Directory `req` currently resolves from — for error messages. */
  root: string;
  onConfigResolved(config: { root?: string }): void;
}

function rootedRequire(resolveFrom?: string): RootedRequire {
  const holder: RootedRequire = {
    req: createRequire(`${resolveFrom ?? process.cwd()}/`),
    root: resolveFrom ?? process.cwd(),
    onConfigResolved(config) {
      if (!resolveFrom && config?.root) {
        holder.req = createRequire(`${config.root}/`);
        holder.root = config.root;
      }
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
          try {
            // Host-first, then OURS: the transformer only has to be a vite,
            // not the app's vite (unlike reanimated's babel plugin, which must
            // match the app's runtime version). A real RN host ships no vite
            // of its own — the playground drives one from outside the app —
            // so resolving from the preset's own location is what makes the
            // raw-JSX path work there at all.
            vite = selfRequire('vite') as ViteTransformers;
          } catch {
            // A raw-JSX library file reached this transform, so the project
            // needs it: failing loud beats a cryptic esbuild JSX parse error
            // downstream.
            throw new Error(
              `native-surface: cannot resolve 'vite' to JSX-transform ${path} — tried the project root ` +
                `(${rooted.root}) and the preset's own location (${PKG_ROOT}); ` +
                `pass rnLibJsxPlugin({ resolveFrom }) pointing at a directory whose node_modules has vite`
            );
          }
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
const CJS_INTEROP_PACKAGES = [
  '@expo/vector-icons',
  // reanimated 4 ships plain-CJS helpers (scripts/validate-worklets-version.js)
  // that its own ESM modules default-import. It is excluded from prebundling
  // in 'real' mode, so Vite serves those raw and the import has no binding.
  'react-native-reanimated',
  // reanimated's validate-worklets-version.js does `import satisfies from
  // 'semver/functions/satisfies.js'` — that file is CJS `module.exports = fn`.
  'semver',
];

/**
 * Vite helper: ESM-wrap bare CJS files inside CJS_INTEROP_PACKAGES so their
 * named imports bind in dev. Build mode never strictly needs it
 * (rollup-commonjs interops there), but the transform applies in both modes
 * so dev and build serve one shape. Files with any ESM syntax of their own
 * are left alone — they already interop through the module graph.
 * Part of the `nativeSurface()` preset; exported for à-la-carte configs.
 */
async function bundleCjsToEsm(file: string): Promise<string> {
  let esbuild: { build: (opts: object) => Promise<{ outputFiles?: Array<{ text: string }> }> };
  try {
    esbuild = await import('esbuild');
  } catch {
    esbuild = createRequire(`${process.cwd()}/`)('esbuild');
  }
  const result = await esbuild.build({
    entryPoints: [file],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    logLevel: 'silent',
  });
  const text = result.outputFiles?.[0]?.text;
  if (!text) throw new Error(`native-surface: esbuild produced no output for ${file}`);
  return text;
}

export function rnCjsInteropPlugin(extraPackages: string[] = []): {
  name: string;
  enforce: 'pre';
  load(id: string): Promise<string | null>;
  transform(code: string, id: string): { code: string; map: null } | null;
} {
  const packages = [...CJS_INTEROP_PACKAGES, ...extraPackages];
  return {
    name: 'native-surface:rn-cjs-interop',
    enforce: 'pre',
    // Per-file CJS wrap cannot handle semver: Vite still serves raw /@fs CJS
    // (`const exports` + `exports = module.exports`, circular __cjsReq TDZ).
    // optimizeDeps.include misses those deep imports from excluded RN libs.
    async load(id) {
      const path = (id.split('?')[0] ?? id).replace(/\\/g, '/');
      if (!path.includes('/node_modules/semver/') || !/\.c?js$/.test(path)) return null;
      try {
        return await bundleCjsToEsm(path);
      } catch {
        return null;
      }
    },
    transform(code: string, id: string) {
      const path = id.split('?')[0] ?? id;
      if (path.includes('/.vite/') || path.includes('/.vite-')) return null;
      if (!/\.c?js$/.test(path)) return null;
      if (!packages.some((p) => path.includes(p))) return null;
      const hasModuleExports = code.includes('module.exports');
      // tsc-compiled CJS — `exports.foo = …` with an __esModule marker — is
      // the commonest shape of all, and `export * from` such a file loses
      // every named binding when Vite serves it raw ("does not provide an
      // export named 'x'"). Handle it alongside `module.exports = {…}`.
      const namedExportAssignments = [...code.matchAll(/^\s*exports\.([A-Za-z_$][\w$]*)\s*=/gm)];
      if (!hasModuleExports && namedExportAssignments.length === 0) return null;
      if (/^\s*(import|export)\b/m.test(code)) return null;
      // Named bindings come from the LAST `module.exports = { … }` object
      // literal; through aliased intermediates, because `export { pick }`
      // directly would collide with the file's own top-level declarations.
      const assignments = [...code.matchAll(/module\.exports\s*=\s*\{([^{}]*)\}/g)];
      const names: string[] = [...new Set(namedExportAssignments.map((m) => m[1]!))].filter(
        (n) => n !== '__esModule' && n !== 'default'
      );
      const lastObjectLiteral = assignments[assignments.length - 1]?.[1];
      if (lastObjectLiteral) {
        for (const entry of lastObjectLiteral.split(',')) {
          const name = entry.split(':')[0]!.trim();
          if (/^[A-Za-z_$][\w$]*$/.test(name)) names.push(name);
        }
      }
      let tail = '\nexport default module.exports;';
      // Both collection paths can name the same binding; a duplicate would be
      // a syntax error in the emitted export clause.
      const unique = [...new Set(names)];
      if (unique.length > 0) {
        tail +=
          `\n${unique.map((n, i) => `const __cjsX${i} = module.exports[${JSON.stringify(n)}];`).join('\n')}` +
          `\nexport { ${unique.map((n, i) => `__cjsX${i} as ${n}`).join(', ')} };`;
      }
      // The wrapper supplies `module`/`exports`, but a bare-CJS file also
      // CALLS require() at runtime, which does not exist in an ES module.
      // Hoist each distinct specifier to a real import so the file executes.
      const requireImports: string[] = [];
      const seen = new Map<string, string>();
      const body = code.replace(/require\(\s*(['"])([^'"\n]+)\1\s*\)/g, (_whole, _q: string, spec: string) => {
        let ident = seen.get(spec);
        if (!ident) {
          ident = `__cjsReq${seen.size}`;
          seen.set(spec, ident);
          // `import x from` gives the CJS namespace through Vite's interop;
          // JSON and ESM leaves both arrive with their value on default.
          requireImports.push(`import ${ident} from ${JSON.stringify(spec)};`);
        }
        return ident;
      });
      return {
        code:
          `${requireImports.join('\n')}\n` +
          // `let` — CJS like semver/internal/re.js does `exports = module.exports = {}`.
          `const module = { exports: {} }; let exports = module.exports;\n${body}${tail}`,
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
  /**
   * Extra node_modules packages whose bare-CJS files should be ESM-wrapped
   * (see rnCjsInteropPlugin). Needed when an app depends on a compiled-CJS
   * package that its own ESM sources `export * from` — served raw, such a
   * star re-export loses every named binding.
   */
  cjsInteropPackages?: string[];
  /**
   * Packages whose `.web.*` files should be preferred over `.native`/`.ios`.
   * Use when a library's web implementation is the one that can actually run
   * here — reanimated 4, whose native path constructs a TurboModule, is the
   * canonical example. Boundary-general: it inverts resolution for the named
   * packages only.
   *
   * ADDITIVE. The preset already detects the known cases from what the app
   * has installed (see `detectWebVariantPackages`), so reanimated 4 and
   * expo-paste-input need no configuration; this option names packages the
   * preset does not know about.
   */
  webVariantPackages?: string[];
}

/** Standard-boundary ESM packages that import the aliased 'react-native':
 *  prebundling would freeze a private copy of the engine inside the dep chunk
 *  (stale code + duplicated singletons). Excluding a package that isn't
 *  installed is harmless, so the list is unconditional. */
/**
 * Every package the alias set redirects to a compat shim.
 *
 * These MUST be excluded from prebundling, for the same reason
 * 'native-surface' and '@native-surface/compat' are — and excluding those two
 * alone does not cover it. Vite's optimizer sees the id the APP imports
 * (`expo-notifications`), not the file our alias sends it to, so it happily
 * prebundles the alias target: a frozen copy of the shim, plus the engine code
 * the shim imports, sealed inside a dep chunk.
 *
 * Two failure modes, one of them near-undebuggable:
 * - **The shim goes stale.** The optimizer cache outlives edits to the shim
 *   (it is keyed on the app's dependencies, which did not change), so a fixed
 *   shim keeps serving its old code until someone thinks to delete the cache
 *   directory. This cost real time: a `Notifications.addPushTokenListener is
 *   not a function` crash survived the function being added, because the
 *   frozen chunk still had the old module.
 * - **Singletons split**, exactly as the note above describes.
 *
 * Kept as data next to the alias list, and `tests/vite-preset.test.ts` asserts
 * the two agree — every package that gets an alias also gets an exclude.
 */
const COMPAT_ALIASED_PACKAGES = [
  // NOT 'react-native'. It is aliased to the engine and its `Libraries/*`
  // subpaths to compat's fabric stub, so by the rule above it looks like it
  // belongs here — but excluding it BREAKS the app, and the reason is worth
  // recording so nobody re-adds it.
  //
  // Vite matches an exclude entry against the package name as well as the full
  // id, so 'react-native' also excludes every deep `react-native/...` import.
  // Prebundled CJS packages reach those internals through a RUNTIME require —
  // @sentry/react-native does `require('react-native/Libraries/Promise')` —
  // and esbuild cannot resolve a require to an external module, so it emits a
  // stub that throws `Dynamic require of "..." is not supported` and the app
  // never boots.
  //
  // The cost of leaving it optimizable is smaller and is handled elsewhere:
  // deep Libraries imports are reached lazily, so the optimizer can discover
  // one mid-session and re-run ("new dependencies optimized ... reloading"),
  // which 404s the running page's chunks. An app that hits it pre-declares the
  // id in its own `optimizeDeps.include` so discovery happens at startup.
  'react-native-screens',
  'react-native-reanimated',
  'react-native-gesture-handler',
  'react-native-safe-area-context',
  'react-native-mmkv',
  'react-native-keyboard-controller',
  'react-native-edge-to-edge',
  '@react-navigation/native-stack',
  'expo-font',
  'expo-linking',
  'expo-localization',
  'expo-application',
  'expo-splash-screen',
  'expo-system-ui',
  'expo-modules-core',
  'expo',
  'reactotron-react-native-mmkv',
  'reactotron-react-native',
  'reactotron-react-js',
  'reactotron-core-client',
  'react-native-svg',
  '@react-native-async-storage/async-storage',
  '@react-native-community/netinfo',
  'expo-haptics',
  'react-native-device-info',
  'expo-constants',
  '@react-native-clipboard/clipboard',
  'expo-clipboard',
  'react-native-share',
  'expo-image-picker',
  'react-native-image-picker',
  'react-native-permissions',
  'expo-notifications',
  'react-native-vector-icons',
  'expo-image',
  'react-native-fast-image',
  'expo-linear-gradient',
  'react-native-linear-gradient',
  'expo-blur',
  '@react-native-community/blur',
  '@react-native-masked-view/masked-view',
  'react-native-webview',
  'react-native-pager-view',
  'expo-web-browser',
  'expo-sharing',
  'expo-location',
  'expo-device',
  'expo-keep-awake',
  'expo-screen-orientation',
  'expo-updates',
  'expo-file-system',
  'expo-media-library',
  'expo-image-manipulator',
  'expo-video',
  'expo-video-thumbnails',
  'react-native-compressor',
  'react-responsive',
];

const RN_ECOSYSTEM_EXCLUDES = [
  // The engine and its shims themselves. Installed from npm they sit in
  // node_modules like any dep, so Vite would prebundle them — freezing a
  // private copy of the engine AND duplicating its singletons (the module
  // registry, the live-roots set), so a host registering a native module
  // would populate a different registry than the app reads. In a workspace
  // they resolve to source and this is a no-op.
  'native-surface',
  '@native-surface/compat',
  // ...and every id aliased ONTO them, which the two names above do not cover.
  ...COMPAT_ALIASED_PACKAGES,
  '@react-navigation/native',
  '@react-navigation/core',
  '@react-navigation/elements',
  '@react-navigation/stack',
  '@react-navigation/bottom-tabs',
  '@react-navigation/routers',
  'react-native-screens',
  'react-native-safe-area-context',
  'react-native-gesture-handler',
  // Prebundling also bypasses the platform-extension resolver (esbuild does
  // its own resolution), so a library shipping Foo.js/Foo.native.js gets its
  // WEB file frozen into the dep chunk — drawer-layout's web Drawer expects a
  // DOM element and dies with "element.addEventListener is not a function".
  'react-native-drawer-layout',
  // Also raw JSX in .js files: the dep scanner (raw esbuild, runs before the
  // plugin pipeline, so rnLibJsxPlugin can't help it) dies parsing the
  // package unless it's marked external here.
  '@expo/vector-icons',
  // Paper's ESM index imports the aliased 'react-native' like the navigation
  // packages do; prebundled, its frozen engine copy also carries dead
  // import.meta.url wasm paths (the dep chunk is not where the .wasm lives).
  'react-native-paper',
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
/**
 * The ENGINE's own CJS leaves. These are dependencies of native-surface, so
 * they are resolved relative to the ENGINE, never the app or Vite's root:
 * under pnpm's strict layout an installed engine's deps are nested inside
 * .pnpm and invisible to both. Each is pinned by an absolute-path alias so
 * the optimizer and runtime imports agree on one file.
 */
const ENGINE_CJS_LEAVES = [
  'react-reconciler',
  'react-reconciler/constants',
  'scheduler',
  'canvaskit-wasm',
  'canvaskit-wasm/bin/canvaskit.js',
];

const CJS_LEAF_INCLUDES = [
  'react-is',
  'use-latest-callback',
  'escape-string-regexp',
  'fast-deep-equal',
  'query-string',
  // react-native-paper's CJS leaf: served raw next to an excluded paper, its
  // named exports (withTheme, createTheming) have no ESM bindings to import.
  '@callstack/react-theme-provider',
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

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Packages whose `.web.*` files are the implementation that can actually run
 * here, detected from what the app has installed (see the `webVariantPackages`
 * option for the general rule). Each entry is a package whose DEFAULT files
 * construct something a canvas host cannot provide, while its web siblings are
 * plain JS — so leaving the Metro-parity `.native`/`.ios` preference in place
 * picks the file that is guaranteed to fail.
 *
 * Detected rather than hardcoded because the answer is version-dependent:
 * reanimated 3's default path drives views through `setNativeProps`, which
 * this engine implements, and inverting it there would swap a working
 * implementation for a worse one. Reanimated 4 is Fabric-only on native — its
 * default files build a TurboModule that cannot exist — so only from 4 does
 * the web variant become the faithful one. An explicit `webVariantPackages`
 * always adds to (never replaces) this set.
 */
function detectWebVariantPackages(req: NodeJS.Require): string[] {
  const out: string[] = [];
  const major = (id: string): number => {
    try {
      const { version } = req(`${id}/package.json`) as { version?: string };
      return Number.parseInt(version ?? '', 10) || 0;
    } catch {
      return 0;
    }
  };
  if (major('react-native-reanimated') >= 4) out.push('react-native-reanimated', 'react-native-worklets');
  // Its native view is a paste-intercepting UITextView wrapper; the web
  // sibling is a straight passthrough, which is the honest answer here (and
  // unlike the native path, it forwards its ref).
  try {
    req.resolve('expo-paste-input/package.json');
    out.push('expo-paste-input');
  } catch {
    /* not installed */
  }
  return out;
}

/** Reanimated 4 / worklets gate the JS mapper on SHOULD_BE_USE_WEB, which is
 *  `Platform.OS === 'web'` — false here (the engine reports ios). Native init
 *  then calls runOnUISync (web stub throws) and animated styles drive a UI
 *  runtime that does not exist (max call stack on a list of Animated.Views).
 *  Force the web mapper; call leftover sync-UI APIs on the JS thread. */
export function rnWorkletsJsSyncPlugin(): {
  name: string;
  transform(code: string, id: string): { code: string; map: null } | null;
} {
  return {
    name: 'native-surface:worklets-js-sync',
    transform(code, id) {
      const path = (id.split('?')[0] ?? id).replace(/\\/g, '/');
      if (path.includes('/.vite/') || path.includes('/.vite-')) return null;
      if (!path.includes('react-native-worklets') && !path.includes('react-native-reanimated')) return null;
      let out = code;
      out = out.replace(
        /export const SHOULD_BE_USE_WEB(\s*:\s*\w+)?\s*=\s*[^;]+;/,
        'export const SHOULD_BE_USE_WEB$1 = true;'
      );
      out = out.replace(
        /(export\s+)?function shouldBeUseWeb\(\)\s*(?::\s*[^{]+)?\{[^}]*\}/,
        '$1function shouldBeUseWeb() { return true; }'
      );
      if (out.includes('is not supported on web')) {
        out = out.replace(
          /((?:export\s+)?function runOnUISync\([^)]*\)(?::\s*never)?\s*\{\s*)throw new \w+\([^)]*runOnUISync[^)]*\);/,
          '$1return arguments[0](...Array.prototype.slice.call(arguments, 1));'
        );
        out = out.replace(
          /((?:export\s+)?function executeOnUIRuntimeSync\([^)]*\)(?::\s*never)?\s*\{\s*)throw new \w+\([^)]*executeOnUIRuntimeSync[^)]*\);/,
          '$1var f=arguments[0];return arguments.length>1?f(...Array.prototype.slice.call(arguments,1)):function(){return f.apply(void 0,arguments);};'
        );
      }
      return out === code ? null : { code: out, map: null };
    },
  };
}

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
  // Shared with rnPlatformExtensionsPlugin by reference so the config hook —
  // the first place the app root is known — can append what it detects.
  const webVariantPackages = [...(opts.webVariantPackages ?? [])];
  const configPlugin = {
    name: 'native-surface:config',
    config(user: { root?: string; cacheDir?: string } | undefined, env: { mode: string }) {
      // Resolve vite from the app's own root (cwd is wrong for programmatic
      // servers); when unresolvable, restate Vite's defaults ourselves —
      // setting resolve.conditions REPLACES them, so an empty fallback would
      // break every bare-specifier resolve.
      const appRoot = opts.resolveFrom ?? user?.root ?? process.cwd();
      const req = createRequire(`${appRoot}/`);
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
      for (const pkg of detectWebVariantPackages(req)) {
        if (!webVariantPackages.includes(pkg)) webVariantPackages.push(pkg);
      }
      let defaults: string[] = DEFAULT_CLIENT_CONDITIONS;
      try {
        const live = (req('vite') as typeof import('vite')).defaultClientConditions;
        if (live?.length) defaults = live as string[];
      } catch {
        /* fall back to the hardcoded list above */
      }
      // Vite resolves optimizeDeps.include entries from ITS OWN root, which is
      // not always the app root: a tool can serve an app from outside it (the
      // playground does — root is the playground package, the host app's
      // node_modules is a separate tree). A leaf that lives only in the app's
      // tree then fails the optimizer AND, served raw, has no ESM bindings for
      // its named imports. Pin those onto the app-resolved file so the
      // optimizer's include resolver and runtime imports land on one module.
      // An id counts as present if EITHER root can resolve it: the engine's
      // own CJS leaves (react-reconciler, canvaskit) live wherever the engine
      // is installed — the tool's tree, not the served app's — while the
      // navigation leaves live in the app's. Filtering by the app root alone
      // silently dropped the engine's own, and the surface then never mounts.
      const viteRootRequire = createRequire(`${user?.root ?? process.cwd()}/`);
      const resolvableFromViteRoot = (id: string): boolean => {
        try {
          viteRootRequire.resolve(id);
          return true;
        } catch {
          return false;
        }
      };
      const include = CJS_LEAF_INCLUDES.filter((id) => resolvable(id) || resolvableFromViteRoot(id));
      // Engine leaves: resolve from the engine itself and pin to absolute
      // paths, so neither the app's tree nor Vite's root has to see them.
      const engineAliases: NativeSurfaceAlias[] = [];
      for (const id of ENGINE_CJS_LEAVES) {
        try {
          const resolvedPath = selfRequire.resolve(id);
          engineAliases.push({ find: new RegExp(`^${escapeRegExp(id)}$`), replacement: resolvedPath });
          include.push(id);
        } catch {
          // Not installed alongside the engine (à-la-carte consumer): leave
          // resolution to Vite rather than inventing a path.
        }
      }
      const dedupe = ['react', 'react-dom', 'react-native-reanimated', ...RN_ECOSYSTEM_DEDUPE];
      const includeAliases: NativeSurfaceAlias[] = [];
      // resolve.dedupe has the SAME root problem, with a worse failure: Vite
      // re-resolves a deduped bare id from its own root, so a package living
      // only in the app's tree stops resolving AT ALL ("Failed to resolve
      // import" from the app's own sources). Pinning it to the app-resolved
      // file both fixes resolution and achieves what dedupe wanted — every
      // importer lands on one absolute module.
      const dedupeOut = new Set(dedupe);
      // Vite's root defaults to cwd when the user doesn't set one, so keying
      // off `user.root` alone silently skipped every app served from outside
      // its own directory without an explicit root.
      const viteRoot = user?.root ?? process.cwd();
      if (viteRoot !== appRoot) {
        const fromViteRoot = createRequire(`${viteRoot}/`);
        // Pin only what the app has and Vite's root does not: those are the
        // ids Vite would otherwise fail to resolve.
        const pinnable = (id: string): boolean => !resolvableFromViteRoot(id) && resolvable(id);
        void fromViteRoot;
        for (const id of include) {
          if (pinnable(id)) includeAliases.push({ find: new RegExp(`^${escapeRegExp(id)}$`), replacement: req.resolve(id) });
        }
        for (const id of dedupe) {
          if (!pinnable(id)) continue;
          dedupeOut.delete(id);
          includeAliases.push({ find: new RegExp(`^${escapeRegExp(id)}$`), replacement: req.resolve(id) });
        }
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
          dedupe: [...dedupeOut],
          // Exact-match include pins first: they name whole packages, so no RN
          // alias below can shadow them, and none of them can swallow subpaths.
          alias: [
            ...engineAliases,
            ...includeAliases,
            ...nativeSurfaceAliases({
              reanimated,
              screens: opts.screens,
              jsStackAvailable: resolvable('@react-navigation/stack'),
            }),
          ],
        },
        optimizeDeps: {
          // Reanimated needs excluding in BOTH modes, so it lives in the list
          // above rather than being appended conditionally here: 'real' imports
          // the aliased 'react-native', and 'shim' resolves to compat's shim,
          // which must not be frozen into a dep chunk either.
          exclude: [...RN_ECOSYSTEM_EXCLUDES],
          include,
          // Teach the OPTIMIZER the same Metro platform preference the dev
          // resolver applies. Without it every prebundled package gets its
          // web file frozen in, and the only remedy is adding the package to
          // `exclude` — which is not always available (see the plugin's doc)
          // and costs the CJS interop that prebundling provides.
          esbuildOptions: {
            plugins: [rnPlatformExtensionsEsbuildPlugin({ platform: opts.platform ?? 'ios', webVariantPackages })],
          },
        },
      };
    },
  };
  // The plugin helpers type their hooks structurally (no vite value import),
  // so they don't satisfy vite's Plugin interface nominally — but each is a
  // valid plugin object at runtime.
  return [
    rnPlatformExtensionsPlugin({ platform: opts.platform ?? 'ios', webVariantPackages }),
    rnLibJsxPlugin({ resolveFrom: opts.resolveFrom }),
    rnRequirePlugin({
      assetAliases: opts.assetAliases,
      includePackages: opts.requireIncludePackages,
    }),
    rnCjsInteropPlugin(opts.cjsInteropPackages),
    rnWorkletsJsSyncPlugin(),
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
