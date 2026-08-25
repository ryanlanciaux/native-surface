import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { nativeSurface } from 'native-surface/vite';

// Which reanimated the preset serves. Scope Vite's cache to the mode: the dep
// optimizer's cache can survive config-change restarts, and a stale cache from
// the other mode silently serves the wrong reanimated (root cause of the
// "sheet snaps instead of animating" regression).
const REANIMATED_MODE = 'real' as const;

export default defineConfig(({ mode }) => {
  // Extra dev hostnames (e.g. a LAN/VPN machine name) stay out of the repo:
  // set VITE_ALLOWED_HOSTS as a comma-separated list in an untracked
  // `.env.local` next to this config.
  const env = loadEnv(mode, __dirname, 'VITE_');
  const allowedHosts = (env.VITE_ALLOWED_HOSTS ?? '').split(',').filter(Boolean);

  return {
    cacheDir: `node_modules/.vite-rn-${REANIMATED_MODE}`,
    plugins: [
      // The whole native-surface toolchain: platform-extension resolution,
      // reanimated JSX loading, require/asset transform, node_modules
      // workletizer, and the react-native alias + RN-globals config layer.
      ...(nativeSurface({
        platform: 'ios',
        reanimated: REANIMATED_MODE,
      }) as import('vite').PluginOption[]),
      // The reanimated Babel plugin is part of reanimated's standard toolchain
      // (Metro applies it everywhere): app source written without explicit
      // useAnimatedStyle deps arrays requires it, on web included.
      react({ babel: { plugins: ['react-native-reanimated/plugin'] } }),
    ],
    optimizeDeps: {
      // These ship ESM and import the aliased 'react-native' — prebundling
      // would freeze a private copy of the engine inside the dep chunk (stale
      // code + duplicated singletons). CJS deps must still be prebundled.
      // (The preset already excludes react-native-reanimated.)
      exclude: [
        '@gorhom/bottom-sheet',
        '@gorhom/portal',
        '@react-navigation/native',
        '@react-navigation/core',
        '@react-navigation/elements',
        '@react-navigation/stack',
        '@react-navigation/bottom-tabs',
        '@react-navigation/routers',
      ],
      include: [
        'invariant',
        '@gorhom/bottom-sheet > invariant',
        // With resolve.dedupe forcing root instances, the CJS leaves of the
        // excluded (ESM) navigation packages resolve from the root tree; plain
        // top-level includes cover them there.
        'react-is',
        'use-latest-callback',
        'escape-string-regexp',
        'fast-deep-equal',
        'query-string',
        'nanoid/non-secure',
        'use-sync-external-store/shim',
        'use-sync-external-store/with-selector',
        'color',
        // pnpm: nested-include chains must start at a DIRECT dependency of
        // this app, one '>' hop per package boundary. These cover the CJS deps
        // of the excluded @react-navigation packages.
        '@react-navigation/native > @react-navigation/core > use-latest-callback',
        '@react-navigation/native > @react-navigation/core > react-is',
        '@react-navigation/native > @react-navigation/core > escape-string-regexp',
        '@react-navigation/native > @react-navigation/core > fast-deep-equal',
        '@react-navigation/native > @react-navigation/core > query-string',
        '@react-navigation/native > @react-navigation/core > nanoid/non-secure',
        '@react-navigation/native > @react-navigation/core > use-sync-external-store/shim',
        '@react-navigation/native > @react-navigation/core > use-sync-external-store/with-selector',
        '@react-navigation/native > use-latest-callback',
        '@react-navigation/native > escape-string-regexp',
        '@react-navigation/native > fast-deep-equal',
        '@react-navigation/stack > color',
        '@react-navigation/bottom-tabs > color',
        '@react-navigation/stack > @react-navigation/elements > color',
        '@react-navigation/bottom-tabs > @react-navigation/elements > color',
      ],
    },
    resolve: {
      // Force single instances of the navigation stack (a second
      // un-prebundled @react-navigation copy = raw-CJS imports).
      // react/react-dom/reanimated dedupe comes from the preset.
      dedupe: [
        '@react-navigation/native',
        '@react-navigation/core',
        '@react-navigation/elements',
        '@react-navigation/stack',
        '@react-navigation/bottom-tabs',
        '@react-navigation/routers',
        'use-latest-callback',
      ],
    },
    server: { host: true, allowedHosts },
    preview: { host: true, allowedHosts },
  };
});
