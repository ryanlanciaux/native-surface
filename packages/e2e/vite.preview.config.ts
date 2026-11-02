import { fileURLToPath } from 'node:url';
import { defineConfig, type PluginOption } from 'vite';
import { nativeSurface } from '../native-surface/src/vite';

export default defineConfig({
  root: fileURLToPath(new URL('./tests/fixture', import.meta.url)),
  plugins: nativeSurface() as PluginOption[],
  server: {
    host: '127.0.0.1',
    port: 5175,
    strictPort: true,
    fs: { allow: [fileURLToPath(new URL('../..', import.meta.url))] },
  },
});
