import { createRequire } from 'node:module';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

const compat = process.env.SURFACE_E2E_COMPAT;
const runner = compat ? createRequire(join(compat, 'package.json')) : undefined;

export default defineConfig({
  resolve: { alias: runner ? [
    { find: /^e2e$/, replacement: runner.resolve('e2e') },
    { find: /^e2e\/engine$/, replacement: runner.resolve('e2e/engine') },
  ] : [] },
  test: { include: ['tests/**/*.test.ts'], testTimeout: 30000, hookTimeout: 60000, fileParallelism: false },
});
