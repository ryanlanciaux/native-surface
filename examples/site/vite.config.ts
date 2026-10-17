import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { nativeSurface } from 'native-surface/vite';
import { igniteDemo } from 'ignite-demo/vite';
import { checkEmdash, formatHits } from '../../scripts/site/check-emdash.mjs';

// Copy rule: no em dash (U+2014) in user-visible strings. Fails `vite build`
// (and so the Pages workflow) on hits; see scripts/site/README.md.
function emdashCheck(): Plugin {
  return {
    name: 'site:check-emdash',
    apply: 'build',
    buildStart() {
      const hits = checkEmdash();
      if (hits.length) {
        this.error(
          `${hits.length} em dash(es) in user-visible text. Rewrite with a comma, period or colon:\n${formatHits(hits)}`,
        );
      }
    },
  };
}

// Each page is an HTML entry next to this config (the landing page only).
const PAGES = ['index'];

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
      emdashCheck(),
      // The CLI-generated Ignite app's Vite adapter (its @/ and @assets/ aliases,
      // offline RSS fixture, bundled remote images). Must precede nativeSurface().
      igniteDemo(),
      // The native-surface toolchain (same preset as examples/embed-demo):
      // platform-extension resolution, reanimated, the react-native /
      // react-native-svg aliases used by the live ignite-demo surfaces, and the
      // standard optimizeDeps boundary.
      ...(nativeSurface({
        platform: 'ios',
        reanimated: 'real',
      }) as import('vite').PluginOption[]),
      react({ babel: { plugins: ['react-native-reanimated/plugin'] } }),
    ],
    optimizeDeps: {
      include: [
        'invariant',
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
