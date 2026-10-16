import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { nativeSurface } from 'native-surface/vite';

// Dev harness for the Ignite demo: renders the app in the design's phone frame
// and every catalog component standalone. Same preset pattern as embed-demo.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, 'VITE_');
  const allowedHosts = (env.VITE_ALLOWED_HOSTS ?? '').split(',').filter(Boolean);
  return {
    root: __dirname,
    plugins: [...(nativeSurface({ platform: 'ios' }) as import('vite').PluginOption[]), react()],
    server: { host: true, allowedHosts, fs: { allow: ['..', '../../..'] } },
    preview: { host: true, allowedHosts },
    build: { outDir: '../dist-dev', emptyOutDir: true },
  };
});
