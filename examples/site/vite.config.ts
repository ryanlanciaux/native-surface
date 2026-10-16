import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

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
    plugins: [react()],
    build: { rollupOptions: { input } },
    server: { host: true, allowedHosts },
    preview: { host: true, allowedHosts },
  };
});
