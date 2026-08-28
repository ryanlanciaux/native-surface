import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    // Same convention as packages/native-surface/vitest.config.ts: RN imports
    // land on the engine, so tests can exercise story modules that import
    // react-native without a browser.
    alias: [
      {
        find: 'react-native',
        replacement: fileURLToPath(new URL('../native-surface/src/index.ts', import.meta.url)),
      },
    ],
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx,mjs}'],
    testTimeout: 30000,
  },
});
