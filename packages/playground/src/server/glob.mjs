// Story-file glob matching with zero dependencies: enough of the glob
// language for story discovery — `**`, `*`, `?`, `{a,b}` braces, and
// Storybook's `@(a|b)` alternation. Nested groups are NOT supported; a
// pattern needing them should be split into several --stories flags.
import { readdirSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

const SKIP_DIRS = new Set(['node_modules', '.git']);

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Compiles one /-separated glob into a RegExp over full posix paths. */
export function globToRegExp(glob) {
  let out = '';
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          // `**/` spans zero or more whole directories.
          out += '(?:[^/]+/)*';
          i += 3;
        } else {
          out += '.*';
          i += 2;
        }
      } else {
        out += '[^/]*';
        i += 1;
      }
    } else if (c === '?') {
      out += '[^/]';
      i += 1;
    } else if (c === '@' && glob[i + 1] === '(') {
      const end = glob.indexOf(')', i);
      if (end === -1) {
        out += escapeRegExp(c);
        i += 1;
        continue;
      }
      out += `(?:${glob.slice(i + 2, end).split('|').map(escapeRegExp).join('|')})`;
      i = end + 1;
    } else if (c === '{') {
      const end = glob.indexOf('}', i);
      if (end === -1) {
        out += escapeRegExp(c);
        i += 1;
        continue;
      }
      out += `(?:${glob.slice(i + 1, end).split(',').map(escapeRegExp).join('|')})`;
      i = end + 1;
    } else {
      out += escapeRegExp(c);
      i += 1;
    }
  }
  return new RegExp(`^${out}$`);
}

function toPosix(path) {
  return path.replace(/\\/g, '/');
}

/** The pattern prefix before the first wildcard — the directory a recursive
 *  walk (and the file watcher) must start from. */
function staticBase(absPattern) {
  const segments = absPattern.split('/');
  const base = [];
  for (const segment of segments) {
    if (/[*?@{[]/.test(segment)) break;
    base.push(segment);
  }
  return base.join('/') || '/';
}

/**
 * Compiles patterns (relative to rootDir, or absolute — e.g. pre-resolved
 * Storybook globs) into a matcher over absolute paths.
 */
export function createStoryMatcher(rootDir, patterns) {
  const rootPosix = toPosix(resolve(rootDir));
  const compiled = patterns.map((pattern) => {
    const posixPattern = toPosix(pattern);
    // path.resolve would eat wildcard segments next to '..'; plain prefixing
    // plus a textual '..' collapse keeps wildcards intact.
    const absPattern = isAbsolute(posixPattern) ? posixPattern : `${rootPosix}/${posixPattern}`;
    const collapsed = collapseDots(absPattern);
    return { regex: globToRegExp(collapsed), baseDir: staticBase(collapsed) };
  });
  return {
    baseDirs: [...new Set(compiled.map((c) => c.baseDir))],
    match(file) {
      const posix = toPosix(file);
      if (posix.includes('/node_modules/')) return false;
      return compiled.some((c) => c.regex.test(posix));
    },
  };
}

/** Textual `a/b/../c` → `a/c`; never touches wildcard segments themselves. */
function collapseDots(path) {
  const out = [];
  for (const segment of path.split('/')) {
    if (segment === '.' || segment === '') {
      if (out.length === 0 && segment === '') out.push(segment); // keep leading /
      continue;
    }
    if (segment === '..' && out.length > 1 && out[out.length - 1] !== '..') out.pop();
    else out.push(segment);
  }
  return out.join('/') || '/';
}

/** Walks each matcher base dir (skipping node_modules/.git/dot-dirs) and
 *  returns the sorted absolute paths of matching files. */
export function findStoryFiles(matcher) {
  const results = new Set();
  const walk = (dir, depth) => {
    if (depth > 32) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
        walk(path, depth + 1);
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        if (matcher.match(path)) results.add(path);
      }
    }
  };
  for (const base of matcher.baseDirs) walk(base.replace(/\/$/, ''), 0);
  return [...results].sort();
}
