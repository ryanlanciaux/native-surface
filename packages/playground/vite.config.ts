import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { reactNativeAlias } from 'native-surface/vite';

export default defineConfig(({ mode }) => {
  // Extra dev hostnames stay out of the repo: set VITE_ALLOWED_HOSTS
  // (comma-separated) in an untracked `.env.local` next to this config.
  const env = loadEnv(mode, __dirname, 'VITE_');
  const allowedHosts = (env.VITE_ALLOWED_HOSTS ?? '').split(',').filter(Boolean);

  return {
    plugins: [react()],
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
