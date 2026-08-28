import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error untyped internal module
import { parseJsonc, pathsToAliases, tsconfigAliases } from '../src/server/tsconfig-paths.mjs';

interface Alias {
  find: RegExp;
  replacement: string;
}

describe('parseJsonc', () => {
  it('strips comments and trailing commas', () => {
    const text = `{
      // line comment
      "a": 1, /* block
      comment */
      "b": "keep // this and /* this */",
      "c": [1, 2,],
    }`;
    expect(parseJsonc(text)).toEqual({ a: 1, b: 'keep // this and /* this */', c: [1, 2] });
  });
});

describe('pathsToAliases', () => {
  it('maps a non-wildcard key to an exact-match regex alias', () => {
    const { aliases } = pathsToAliases({ '@app': ['./src/app/index.ts'] }, '/host');
    const alias = aliases[0] as Alias;
    expect(alias.find.test('@app')).toBe(true);
    expect(alias.find.test('@app/deep')).toBe(false);
    expect(alias.replacement).toBe('/host/src/app/index.ts');
  });

  it('maps a single-wildcard key with a $1 replacement', () => {
    const { aliases } = pathsToAliases({ '@/*': ['./src/*'] }, '/host');
    const alias = aliases[0] as Alias;
    const match = '@/components/Button'.match(alias.find);
    expect(match?.[1]).toBe('components/Button');
    expect(alias.replacement).toBe('/host/src/$1');
    expect(alias.find.test('unprefixed/components')).toBe(false);
  });

  it('uses the first of multiple targets, with a warning', () => {
    const { aliases, warnings } = pathsToAliases({ '@/*': ['./src/*', './fallback/*'] }, '/host');
    expect((aliases[0] as Alias).replacement).toBe('/host/src/$1');
    expect(warnings).toHaveLength(1);
  });

  it('skips multi-wildcard keys with a warning', () => {
    const { aliases, warnings } = pathsToAliases({ '@/*/x/*': ['./src/*/x/*'] }, '/host');
    expect(aliases).toHaveLength(0);
    expect(warnings).toHaveLength(1);
  });
});

describe('tsconfigAliases', () => {
  const root = mkdtempSync(join(tmpdir(), 'ns-tsconfig-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('returns empty for a missing tsconfig', () => {
    const { aliases, warnings } = tsconfigAliases(join(root, 'nope'));
    expect(aliases).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('reads paths with baseUrl and JSONC syntax', () => {
    const host = join(root, 'app');
    mkdirSync(host, { recursive: true });
    writeFileSync(
      join(host, 'tsconfig.json'),
      `{
        "compilerOptions": {
          // paths resolve against baseUrl
          "baseUrl": "./src",
          "paths": { "@ui/*": ["components/*"], },
        }
      }`
    );
    const { aliases } = tsconfigAliases(host);
    const alias = aliases[0] as Alias;
    expect('@ui/Button'.match(alias.find)?.[1]).toBe('Button');
    expect(alias.replacement).toBe(join(host, 'src', 'components', '$1'));
  });

  it('follows one relative extends hop; child options win', () => {
    const host = join(root, 'extended');
    mkdirSync(host, { recursive: true });
    writeFileSync(
      join(host, 'tsconfig.base.json'),
      JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@base/*': ['./base/*'] } } })
    );
    writeFileSync(
      join(host, 'tsconfig.json'),
      JSON.stringify({ extends: './tsconfig.base.json', compilerOptions: { paths: { '@app/*': ['./app/*'] } } })
    );
    const { aliases } = tsconfigAliases(host);
    expect(aliases).toHaveLength(1);
    expect('@app/x'.match((aliases[0] as Alias).find)?.[1]).toBe('x');
  });

  it('inherits parent paths when the child defines none', () => {
    const host = join(root, 'inherits');
    mkdirSync(host, { recursive: true });
    writeFileSync(
      join(host, 'tsconfig.base.json'),
      JSON.stringify({ compilerOptions: { paths: { '@base/*': ['./base/*'] } } })
    );
    writeFileSync(join(host, 'tsconfig.json'), JSON.stringify({ extends: './tsconfig.base.json' }));
    const { aliases } = tsconfigAliases(host);
    expect(aliases).toHaveLength(1);
    expect((aliases[0] as Alias).replacement).toBe(join(host, 'base', '$1'));
  });
});
