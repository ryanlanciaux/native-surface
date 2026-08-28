import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { nativeSurface } from 'native-surface/vite';

export default defineConfig(({ mode }) => {
  // Extra dev hostnames (e.g. a LAN/VPN machine name) stay out of the repo:
  // set VITE_ALLOWED_HOSTS as a comma-separated list in an untracked
  // `.env.local` next to this config.
  const env = loadEnv(mode, __dirname, 'VITE_');
  const allowedHosts = (env.VITE_ALLOWED_HOSTS ?? '').split(',').filter(Boolean);

  return {
    plugins: [
      // The whole native-surface toolchain: platform-extension resolution,
      // reanimated JSX loading, require/asset transform, node_modules
      // workletizer, and the react-native alias + RN-globals config layer.
      // The preset also owns the standard boundary's Vite plumbing — the
      // mode-scoped optimizer cacheDir, the @react-navigation/screens/
      // safe-area/gesture-handler optimizeDeps excludes + dedupe, and the
      // bare CJS-leaf includes (react-reconciler, canvaskit, react-is, …).
      // Only this app's own concerns remain below.
      ...(nativeSurface({
        platform: 'ios',
        reanimated: 'real',
      }) as import('vite').PluginOption[]),
      // The reanimated Babel plugin is part of reanimated's standard toolchain
      // (Metro applies it everywhere): app source written without explicit
      // useAnimatedStyle deps arrays requires it, on web included.
      react({ babel: { plugins: ['react-native-reanimated/plugin'] } }),
    ],
    optimizeDeps: {
      // App-specific: bottom-sheet ships ESM and imports the aliased
      // 'react-native' — prebundling would freeze a private copy of the
      // engine inside the dep chunk (stale code + duplicated singletons).
      exclude: ['@gorhom/bottom-sheet', '@gorhom/portal'],
      include: [
        'invariant',
        '@gorhom/bottom-sheet > invariant',
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
    server: { host: true, allowedHosts },
    preview: { host: true, allowedHosts },
  };
});
