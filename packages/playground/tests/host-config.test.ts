import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
// Server modules are plain .mjs (they run on Node without a build step).
// @ts-expect-error untyped internal module
import { loadHostConfig } from '../src/server/host-config.mjs';

const roots: string[] = [];

// Under node_modules so vitest externalizes the config import (a real host
// root is outside the test runner's transform root too).
const tmpBase = fileURLToPath(new URL('../node_modules/', import.meta.url));

function hostWith(config: string): string {
  const root = mkdtempSync(join(tmpBase, '.ns-host-config-'));
  roots.push(root);
  mkdirSync(join(root, '.native-surface'));
  writeFileSync(join(root, '.native-surface', 'playground.config.mjs'), config);
  return root;
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe('loadHostConfig optimizeDeps', () => {
  it('adopts include/exclude string arrays', async () => {
    const root = hostWith(
      `export default { optimizeDeps: { exclude: ['react-native-paper'], include: ['@callstack/react-theme-provider'] } };`
    );
    const { config, warnings } = await loadHostConfig(root);
    expect(warnings).toEqual([]);
    expect(config.optimizeDeps).toEqual({
      exclude: ['react-native-paper'],
      include: ['@callstack/react-theme-provider'],
    });
  });

  it('accepts a single side and drops the missing one', async () => {
    const root = hostWith(`export default { optimizeDeps: { exclude: ['some-ui-kit'] } };`);
    const { config } = await loadHostConfig(root);
    expect(config.optimizeDeps).toEqual({ exclude: ['some-ui-kit'] });
  });

  it('warns and ignores malformed shapes', async () => {
    const root = hostWith(`export default { optimizeDeps: { exclude: 'react-native-paper' } };`);
    const { config, warnings } = await loadHostConfig(root);
    expect(config.optimizeDeps).toBeUndefined();
    expect(warnings.some((w: string) => w.includes('optimizeDeps'))).toBe(true);
  });
});
