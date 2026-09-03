#!/usr/bin/env node
// Replace workspace: protocol in package.json so npm pack/publish never
// ships "workspace:*". pnpm publish already does this; npm pack does not.
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
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
let changed = false;

function versionOf(name) {
  let d = dir;
  for (let i = 0; i < 6; i++) {
    const p = join(d, 'node_modules', name, 'package.json');
    if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8')).version;
    const parent = join(d, '..');
    if (parent === d) break;
    d = parent;
  }
  const siblings = join(dir, '..');
  if (existsSync(siblings)) {
    for (const ent of readdirSync(siblings, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      const p = join(siblings, ent.name, 'package.json');
      if (!existsSync(p)) continue;
      const other = JSON.parse(readFileSync(p, 'utf8'));
      if (other.name === name) return other.version;
    }
  }
  throw new Error(`rewrite-workspace-protocol: cannot resolve ${name} from ${dir}`);
}

function rewrite(spec, name) {
  if (typeof spec !== 'string' || !spec.startsWith('workspace:')) return spec;
  const version = versionOf(name);
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
