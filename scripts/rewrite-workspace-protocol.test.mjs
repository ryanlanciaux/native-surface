import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const script = join(dirname(fileURLToPath(import.meta.url)), 'rewrite-workspace-protocol.mjs');
const root = mkdtempSync(join(tmpdir(), 'ws-rewrite-'));
try {
  mkdirSync(join(root, 'node_modules', 'dep-a'), { recursive: true });
  writeFileSync(join(root, 'node_modules', 'dep-a', 'package.json'), JSON.stringify({ name: 'dep-a', version: '1.2.3' }));
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'app', dependencies: { 'dep-a': 'workspace:*' }, peerDependencies: { 'dep-a': 'workspace:^' } }, null, 2)
  );
  execFileSync(process.execPath, [script], { cwd: root });
  const packed = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.equal(packed.dependencies['dep-a'], '1.2.3');
  assert.equal(packed.peerDependencies['dep-a'], '^1.2.3');
  execFileSync(process.execPath, [script, '--restore'], { cwd: root });
  const restored = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.equal(restored.dependencies['dep-a'], 'workspace:*');
} finally {
  rmSync(root, { recursive: true, force: true });
}
