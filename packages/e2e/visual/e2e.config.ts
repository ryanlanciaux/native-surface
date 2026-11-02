import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { E2EConfig } from 'e2e';
import { nativeSurface } from '../src/index';

const executablePath = process.env.SURFACE_E2E_CHROMIUM ?? (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);

export default {
  targets: [{
    name: 'surface',
    engine: nativeSurface({
      surfaceId: 'app',
      viewport: { width: 430, height: 900 },
      launch: { executablePath, args: ['--force-device-scale-factor=1', '--font-render-hinting=none', '--disable-lcd-text'] },
    }),
    app: {
      url: 'http://127.0.0.1:5292',
      command: {
        executable: process.execPath,
        args: [fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url)),
          '--config', fileURLToPath(new URL('./vite.config.ts', import.meta.url))],
        startupTimeout: 120000,
      },
    },
  }],
  tests: 'tests/*.e2e.ts',
  workers: 1,
  // A pixel observation of a large tree takes ~1-2 s in headless Chromium, and
  // toHaveScreenshot needs two identical captures in a row.
  assertionTimeout: 20000,
  retries: 0,
  cache: 'off',
} satisfies E2EConfig;
