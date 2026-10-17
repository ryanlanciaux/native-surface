// Em-dash check for user-visible text (Ryan's copy rule: no U+2014 anywhere a
// visitor can read it). Parses TS/TSX/JS with the TypeScript compiler API and
// flags U+2014 in string literals, template literals and JSX text. Comments
// are not part of the AST walk, so they may keep em dashes. HTML pages are
// scanned raw, minus <!-- comments -->.
//
//   node scripts/site/check-emdash.mjs            # exit 1 on hits
//   node scripts/site/check-emdash.mjs --all      # ignore the allowlist
//
// The Vite plugin in examples/site/vite.config.ts imports `checkEmdash()` and
// fails the build on hits. Paths in scripts/site/emdash-allowlist.json are
// skipped (files owned by other lanes, pending their copy pass).

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '../..');
const EM = '—';

// Scanned roots (repo-relative). Directories are walked for .ts/.tsx/.js/.jsx/.mjs.
const TREES = [
  'examples/site/src',
  'examples/ignite-app/app',
  'examples/ignite-app/src',
  'packages/playground/src',
];
const HTML_DIRS = ['examples/site'];
const CODE_EXT = /\.(?:[cm]?[jt]sx?)$/;
const SKIP_DIR = new Set(['node_modules', 'dist', '.vite']);

// typescript is a devDependency of the site package; resolve it from there so
// the script works from any cwd.
const require = createRequire(join(ROOT, 'examples/site/package.json'));
const ts = require('typescript');

function walk(dir, out) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (CODE_EXT.test(name) && !name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

function lineCol(text, index) {
  const before = text.slice(0, index);
  const line = before.split('\n').length;
  return { line, col: index - before.lastIndexOf('\n') };
}

function scanCode(file) {
  const text = readFileSync(file, 'utf8');
  if (!text.includes(EM)) return [];
  const kind = file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const hits = [];
  const K = ts.SyntaxKind;
  const visit = (node) => {
    switch (node.kind) {
      case K.StringLiteral:
      case K.NoSubstitutionTemplateLiteral:
      case K.TemplateHead:
      case K.TemplateMiddle:
      case K.TemplateTail:
      case K.JsxText: {
        const at = node.getText(sf).indexOf(EM);
        if (at >= 0) {
          const { line, col } = lineCol(text, node.getStart(sf) + at);
          hits.push({ file, line, col, snippet: text.split('\n')[line - 1].trim().slice(0, 100) });
        }
        break;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

function scanHtml(file) {
  const text = readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, (c) =>
    c.replace(/[^\n]/g, ' '),
  );
  const hits = [];
  let i = text.indexOf(EM);
  while (i >= 0) {
    const { line, col } = lineCol(text, i);
    const lineText = text.split('\n')[line - 1].trim();
    hits.push({ file, line, col, snippet: lineText.slice(0, 100) });
    i = text.indexOf(EM, i + 1);
  }
  return hits;
}

export function loadAllowlist() {
  const p = join(HERE, 'emdash-allowlist.json');
  if (!existsSync(p)) return [];
  const list = JSON.parse(readFileSync(p, 'utf8'));
  return Array.isArray(list) ? list : (list.paths ?? []);
}

/** Returns hits (repo-relative `file`). Allowlisted paths (file or dir prefix) are skipped. */
export function checkEmdash({ allowlist = loadAllowlist() } = {}) {
  const allowed = (rel) =>
    allowlist.some((a) => rel === a || rel.startsWith(a.endsWith('/') ? a : a + '/'));
  const files = [];
  for (const t of TREES) walk(join(ROOT, t), files);
  const html = HTML_DIRS.flatMap((d) =>
    readdirSync(join(ROOT, d))
      .filter((n) => n.endsWith('.html'))
      .map((n) => join(ROOT, d, n)),
  );
  const hits = [];
  for (const f of files) {
    const rel = relative(ROOT, f).split(sep).join('/');
    if (!allowed(rel)) hits.push(...scanCode(f).map((h) => ({ ...h, file: rel })));
  }
  for (const f of html) {
    const rel = relative(ROOT, f).split(sep).join('/');
    if (!allowed(rel)) hits.push(...scanHtml(f).map((h) => ({ ...h, file: rel })));
  }
  return hits;
}

export function formatHits(hits) {
  return hits.map((h) => `  ${h.file}:${h.line}:${h.col}  ${h.snippet}`).join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const hits = checkEmdash(process.argv.includes('--all') ? { allowlist: [] } : {});
  if (hits.length) {
    console.error(`check-emdash: ${hits.length} em dash(es) (U+2014) in user-visible text:\n${formatHits(hits)}`);
    console.error('Rewrite with a comma, period or colon (not an en dash or hyphen).');
    process.exit(1);
  }
  console.log('check-emdash: OK');
}
