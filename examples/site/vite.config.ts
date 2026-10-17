import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { nativeSurface } from 'native-surface/vite';
import { igniteDemo } from 'ignite-demo/vite';

// Multi-page site. Each page is an HTML entry next to this config; pages
// owned by other lanes (e.g. surfaces.html) join the build once they exist.
const PAGES = ['index', 'surfaces'];

export default defineConfig(({ mode }) => {
  // Extra dev hostnames stay out of the repo: VITE_ALLOWED_HOSTS in an
  // untracked `.env.local`, comma separated.
  const env = loadEnv(mode, __dirname, 'VITE_');
  const allowedHosts = (env.VITE_ALLOWED_HOSTS ?? '').split(',').filter(Boolean);
  const input = Object.fromEntries(
    PAGES.map((name) => [name, resolve(__dirname, `${name}.html`)] as const).filter(([, file]) =>
      existsSync(file),
    ),
  );

  return {
    plugins: [
      // The CLI-generated Ignite app's Vite adapter (its @/ and @assets/ aliases,
      // offline RSS fixture, bundled remote images). Must precede nativeSurface().
      igniteDemo(),
      // The native-surface toolchain (same preset as examples/embed-demo):
      // platform-extension resolution, reanimated, the react-native /
      // react-native-svg aliases used by the live ignite-demo surfaces and the
      // surfaces page, and the standard optimizeDeps boundary.
      ...(nativeSurface({
        platform: 'ios',
        reanimated: 'real',
      }) as import('vite').PluginOption[]),
      react({ babel: { plugins: ['react-native-reanimated/plugin'] } }),
    ],
    optimizeDeps: {
      // bottom-sheet ships ESM and imports the aliased
      // 'react-native' — prebundling would freeze a private engine copy.
      exclude: ['@gorhom/bottom-sheet', '@gorhom/portal'],
      include: [
        'invariant',
        '@gorhom/bottom-sheet > invariant',
        // pnpm: nested-include chains must start at a DIRECT dependency.
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
    build: { rollupOptions: { input } },
    server: { host: true, allowedHosts },
    preview: { host: true, allowedHosts },
  };
});
