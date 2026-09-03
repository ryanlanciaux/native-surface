import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { designPlane } from '../src/plugin.mjs';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function host(): string {
  const root = mkdtempSync(join(tmpdir(), 'design-plane-'));
  roots.push(root);
  mkdirSync(join(root, '.native-surface'));
  return root;
}

describe('virtual:design-plane', () => {
  it('lazy-imports host plane/wrapper instead of static re-export', () => {
    const root = host();
    writeFileSync(join(root, '.native-surface/plane.tsx'), 'export const routes = [];\n');
    writeFileSync(join(root, '.native-surface/wrapper.tsx'), 'export function Wrapper(p) { return p.children; }\n');
    const plugin = designPlane({ hostRoot: root });
    const id = plugin.resolveId('virtual:design-plane');
    const code = plugin.load.call({ addWatchFile() {} }, id);
    expect(code).toContain('import(');
    expect(code).toContain('loadPlane');
    expect(code).toContain('loadWrapper');
    expect(code).not.toMatch(/export \{ routes \}/);
    expect(code).not.toMatch(/export \{ Wrapper \}/);
  });
});
