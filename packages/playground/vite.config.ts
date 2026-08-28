import { defineConfig, loadEnv } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { reactNativeAlias } from 'native-surface/vite';

// Standalone dev serves the in-repo demo stories: the registry's
// 'virtual:host-stories' import resolves to an empty stub (hostMode=false),
// and the local import.meta.glob fallback kicks in. The CLI server
// (src/server/plugins.mjs) replaces this with real host-story discovery.
function hostStoriesStub(): Plugin {
  const RESOLVED = '\0virtual:host-stories';
  return {
    name: 'playground:host-stories-stub',
    resolveId(id) {
      return id === 'virtual:host-stories' ? RESOLVED : null;
    },
    load(id) {
      return id === RESOLVED ? 'export const hostMode = false;\nexport const modules = {};\n' : null;
    },
  };
}

export default defineConfig(({ mode }) => {
  // Extra dev hostnames stay out of the repo: set VITE_ALLOWED_HOSTS
  // (comma-separated) in an untracked `.env.local` next to this config.
  const env = loadEnv(mode, __dirname, 'VITE_');
  const allowedHosts = (env.VITE_ALLOWED_HOSTS ?? '').split(',').filter(Boolean);

  return {
    plugins: [react(), hostStoriesStub()],
    resolve: {
      // Story components are real React Native source: `import { View } from 'react-native'`
      // resolves to the canvas renderer instead of the native/RNW implementations.
      alias: [reactNativeAlias()],
    },
    build: {
      target: 'es2022',
    },
    server: { host: true, allowedHosts },
    preview: { host: true, allowedHosts },
  };
});
