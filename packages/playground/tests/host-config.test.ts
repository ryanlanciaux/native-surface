import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
// Server modules are plain .mjs (they run on Node without a build step).
// @ts-expect-error untyped internal module
import { loadHostConfig } from '../src/server/host-config.mjs';
// @ts-expect-error untyped internal module
import { hostStoriesPlugin, playgroundConfigPlugin } from '../src/server/plugins.mjs';

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

describe('loadHostConfig storyPadding', () => {
  it('adopts a non-negative number', async () => {
    const root = hostWith(`export default { storyPadding: 24 };`);
    const { config, warnings } = await loadHostConfig(root);
    expect(warnings).toEqual([]);
    expect(config.storyPadding).toBe(24);
  });

  it('decorators none implies storyPadding 0', async () => {
    const root = hostWith(`export default { decorators: 'none' };`);
    const { config } = await loadHostConfig(root);
    expect(config.storyPadding).toBe(0);
  });

  it('explicit storyPadding wins over decorators none', async () => {
    const root = hostWith(`export default { decorators: 'none', storyPadding: 8 };`);
    const { config } = await loadHostConfig(root);
    expect(config.storyPadding).toBe(8);
  });
});

describe('loadHostConfig setup', () => {
  it('adopts a non-empty path string', async () => {
    const root = hostWith(`export default { setup: '.native-surface/boot.ts' };`);
    const { config, warnings } = await loadHostConfig(root);
    expect(warnings).toEqual([]);
    expect(config.setup).toBe('.native-surface/boot.ts');
  });

  it('warns and ignores a non-string', async () => {
    const root = hostWith(`export default { setup: 1 };`);
    const { config, warnings } = await loadHostConfig(root);
    expect(config.setup).toBeUndefined();
    expect(warnings.some((w: string) => w.includes('setup'))).toBe(true);
  });
});

describe('loadHostConfig fonts', () => {
  it('adopts family/src with optional weight and style', async () => {
    const root = hostWith(
      `export default { fonts: [{ family: 'Inter', src: './Inter.ttf', weight: 700, style: 'italic' }, { family: 'Inter', src: 'https://example.test/Inter.otf' }] };`
    );
    const { config, warnings } = await loadHostConfig(root);
    expect(warnings).toEqual([]);
    expect(config.fonts).toEqual([
      { family: 'Inter', src: './Inter.ttf', weight: 700, style: 'italic' },
      { family: 'Inter', src: 'https://example.test/Inter.otf' },
    ]);
  });

  it('warns and ignores malformed entries', async () => {
    const root = hostWith(`export default { fonts: [{ family: 'Inter' }] };`);
    const { config, warnings } = await loadHostConfig(root);
    expect(config.fonts).toBeUndefined();
    expect(warnings.some((w: string) => w.includes('fonts'))).toBe(true);
  });
});

describe('virtual modules run setup first', () => {
  it('playground-config imports setup then initEngine fonts', () => {
    const plugin = playgroundConfigPlugin({
      setup: '/host/boot.ts',
      fonts: [{ family: 'Inter', url: '/@fs/host/Inter.ttf', weight: 400 }],
    });
    const code = plugin.load(plugin.resolveId('virtual:playground-config'));
    expect(code.startsWith('import "/@fs/host/boot.ts"')).toBe(true);
    expect(code).toContain('initEngine');
    expect(code.indexOf('import "/@fs/host/boot.ts"')).toBeLessThan(code.indexOf('initEngine'));
  });

  it('host-stories imports playground-config and chains lazy story loads through setup', () => {
    const root = mkdtempSync(join(tmpdir(), 'ns-host-stories-'));
    roots.push(root);
    writeFileSync(join(root, 'Foo.stories.tsx'), 'export default {};');
    const plugin = hostStoriesPlugin({ hostRoot: root, globs: ['*.stories.tsx'], setup: '/host/boot.ts' });
    const code = plugin.load('\0virtual:host-stories');
    expect(code.startsWith("import 'virtual:playground-config'")).toBe(true);
    expect(code).toContain('import("/@fs/host/boot.ts").then(() => import(');
  });
});
