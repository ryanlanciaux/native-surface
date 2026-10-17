import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { nativeSurface } from 'native-surface/vite';
import { igniteDemo } from '../src/vite';

// Dev harness for the generated Ignite app. igniteDemo() goes first (see
// src/vite.ts); the reanimated Babel plugin matches Metro, which runs it over
// app source (Ignite's babel-preset-expo includes it).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, 'VITE_');
  const allowedHosts = (env.VITE_ALLOWED_HOSTS ?? '').split(',').filter(Boolean);
  return {
    root: __dirname,
    plugins: [
      igniteDemo(),
      ...(nativeSurface({ platform: 'ios' }) as import('vite').PluginOption[]),
      react({ babel: { plugins: ['react-native-reanimated/plugin'] } }),
    ],
    server: { host: true, allowedHosts, fs: { allow: ['..', '../../..'] } },
    preview: { host: true, allowedHosts },
    build: { outDir: '../dist-dev', emptyOutDir: true },
  };
});
