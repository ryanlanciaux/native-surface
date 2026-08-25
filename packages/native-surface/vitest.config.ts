import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

// Real stack package (resolved through embed-demo, which depends on it) so
// tests can evaluate its pure interpolators against the engine's Animated.
const req = createRequire(fileURLToPath(new URL('../../examples/embed-demo/package.json', import.meta.url)));
const stackRoot = dirname(req.resolve('@react-navigation/stack/package.json'));

export default defineConfig({
  resolve: {
    // Lets tests import real RN-ecosystem modules (e.g. @react-navigation/
    // stack's pure interpolators) against the engine, same as consumers do.
    alias: [
      { find: 'react-native', replacement: fileURLToPath(new URL('./src/index.ts', import.meta.url)) },
      // Compat shims imported by tests (e.g. ../../compat/src/expo) import the
      // engine by its package name, same as installed consumers.
      { find: 'native-surface', replacement: fileURLToPath(new URL('./src/index.ts', import.meta.url)) },
      {
        find: '@rn-stack/CardStyleInterpolators',
        replacement: join(stackRoot, 'lib/module/TransitionConfigs/CardStyleInterpolators.js'),
      },
    ],
  },
  test: {
    server: {
      deps: {
        // vitest externalizes node_modules to native Node imports, which would
        // bypass the alias above and hit real react-native's Flow syntax —
        // inline the stack's modules through the vite pipeline instead.
        inline: [/@react-navigation[\\/+]stack/],
      },
    },
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
