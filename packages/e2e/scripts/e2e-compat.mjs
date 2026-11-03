import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MIN_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const pkg = fileURLToPath(new URL('../', import.meta.url));
const versions = process.argv.slice(2);
if (versions.length === 0) {
  console.error('usage: node scripts/e2e-compat.mjs <e2e version>...');
  process.exit(2);
}
const published = JSON.parse(execFileSync('npm', ['view', 'e2e', 'time', '--json'], { encoding: 'utf8' }));
for (const version of versions) {
  const at = Date.parse(published[version] ?? '');
  if (Number.isNaN(at)) throw new Error(`e2e@${version} is not published`);
  if (Date.now() - at < MIN_AGE_MS) {
    throw new Error(`e2e@${version} was published ${published[version]}, less than 7 days ago; wait until ${new Date(at + MIN_AGE_MS).toISOString()}`);
  }
}

const run = (command, args, cwd, env = {}) =>
  execFileSync(command, args, { cwd, stdio: 'inherit', env: { ...process.env, E2E_TELEMETRY_DISABLED: '1', ...env } });

let failed = false;
for (const version of versions) {
  const consumer = mkdtempSync(join(tmpdir(), `surface-e2e-compat-${version}-`));
  try {
    run('pnpm', ['pack', '--pack-destination', consumer], pkg);
    const tarball = readdirSync(consumer).find(name => name.endsWith('.tgz'));
    writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'surface-e2e-compat', private: true, type: 'module' }));
    writeFileSync(join(consumer, '.npmrc'), 'minimum-release-age=10080\n');
    run('pnpm', ['add', '--ignore-workspace', `e2e@${version}`, `./${tarball}`], consumer);
    const installed = JSON.parse(readFileSync(join(consumer, 'node_modules/e2e/package.json'), 'utf8')).version;
    if (installed !== version) throw new Error(`installed e2e@${installed}, expected ${version}`);

    cpSync(join(pkg, 'tests/video'), join(consumer, 'video'), { recursive: true, filter: source => basename(source) !== '.e2e' });
    writeFileSync(join(consumer, 'video/engine.ts'), "export { surface } from '@native-surface/e2e';\n");
    cpSync(join(pkg, 'visual/tests'), join(consumer, 'visual/tests'), { recursive: true });
    cpSync(join(pkg, 'visual/e2e.config.ts'), join(consumer, 'visual/e2e.config.ts'));
    writeFileSync(join(consumer, 'visual/engine.ts'), [
      "export { nativeSurface } from '@native-surface/e2e';",
      `export { host } from ${JSON.stringify(join(pkg, 'tests/video/host.ts'))};`,
      `export const packageRoot = new URL(${JSON.stringify(pathToFileURL(pkg).href)});`,
      '',
    ].join('\n'));

    console.log(`\ne2e@${installed}: vitest suite`);
    run('pnpm', ['exec', 'vitest', 'run'], pkg, { SURFACE_E2E_COMPAT: consumer });
    console.log(`\ne2e@${installed}: visual suite`);
    run(process.execPath, [join(consumer, 'node_modules/e2e/dist/cli/bin.js'), 'run', '--config', join(consumer, 'visual/e2e.config.ts')], join(consumer, 'visual'));
    console.log(`\ne2e@${installed}: passed`);
  } catch (error) {
    failed = true;
    console.error(`\ne2e@${version}: failed: ${error instanceof Error ? error.message.split('\n')[0] : error}`);
  } finally {
    rmSync(consumer, { recursive: true, force: true });
  }
}
process.exit(failed ? 1 : 0);
