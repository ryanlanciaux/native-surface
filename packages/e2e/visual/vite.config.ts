import { fileURLToPath } from 'node:url';
import { defineConfig, type PluginOption } from 'vite';
import { nativeSurface } from '../../native-surface/src/vite';

// Serves the visual-regression host. e2e.config.ts starts and stops it.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: nativeSurface() as PluginOption[],
  appType: 'spa',
  clearScreen: false,
  server: {
    host: '127.0.0.1',
    port: 5292,
    strictPort: true,
    hmr: false,
    fs: { allow: [fileURLToPath(new URL('../../..', import.meta.url))] },
  },
});
