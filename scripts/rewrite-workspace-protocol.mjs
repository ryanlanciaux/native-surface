#!/usr/bin/env node
// Replace workspace: protocol in package.json so npm pack/publish never
// ships "workspace:*". pnpm publish already does this; npm pack does not.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const dir = process.cwd();
const file = join(dir, 'package.json');
const bak = join(dir, 'package.json.prepack-bak');
const restore = process.argv.includes('--restore');

if (restore) {
  if (existsSync(bak)) renameSync(bak, file);
  process.exit(0);
}

const orig = readFileSync(file, 'utf8');
const pkg = JSON.parse(orig);
const req = createRequire(join(dir, 'package.json'));
let changed = false;

function rewrite(spec, name) {
  if (typeof spec !== 'string' || !spec.startsWith('workspace:')) return spec;
  let version;
  try {
    version = req(`${name}/package.json`).version;
  } catch {
    throw new Error(`rewrite-workspace-protocol: cannot resolve ${name} from ${dir}`);
  }
  const rest = spec.slice('workspace:'.length);
  changed = true;
  if (rest === '*' || rest === '') return version;
  if (rest === '^' || rest === '~') return `${rest}${version}`;
  return rest;
}

for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies', 'devDependencies']) {
  const deps = pkg[field];
  if (!deps) continue;
  for (const [name, spec] of Object.entries(deps)) deps[name] = rewrite(spec, name);
}

if (!changed) process.exit(0);
writeFileSync(bak, orig);
writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
