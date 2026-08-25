import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// Server modules are plain .mjs (they run on Node without a build step).
// @ts-expect-error untyped internal module
import { createStoryMatcher, findStoryFiles, globToRegExp } from '../src/server/glob.mjs';

describe('globToRegExp', () => {
  const matches = (glob: string, path: string): boolean => globToRegExp(glob).test(path);

  it('handles * within a segment', () => {
    expect(matches('src/*.stories.tsx', 'src/Button.stories.tsx')).toBe(true);
    expect(matches('src/*.stories.tsx', 'src/a/Button.stories.tsx')).toBe(false);
  });

  it('handles ** across zero or more directories', () => {
    expect(matches('src/**/*.stories.tsx', 'src/Button.stories.tsx')).toBe(true);
    expect(matches('src/**/*.stories.tsx', 'src/a/b/Button.stories.tsx')).toBe(true);
    expect(matches('src/**/*.stories.tsx', 'other/Button.stories.tsx')).toBe(false);
  });

  it('handles {a,b} braces', () => {
    expect(matches('src/**/*.stories.{tsx,ts}', 'src/x.stories.ts')).toBe(true);
    expect(matches('src/**/*.stories.{tsx,ts}', 'src/x.stories.js')).toBe(false);
  });

  it("handles Storybook's @(a|b) alternation", () => {
    const glob = 'src/**/*.stories.@(js|jsx|ts|tsx)';
    expect(matches(glob, 'src/deep/x.stories.tsx')).toBe(true);
    expect(matches(glob, 'src/x.stories.mjs')).toBe(false);
  });

  it('escapes regex metacharacters in literals', () => {
    expect(matches('src/a.b/*.play.tsx', 'src/a.b/x.play.tsx')).toBe(true);
    expect(matches('src/a.b/*.play.tsx', 'src/aXb/x.play.tsx')).toBe(false);
  });

  it('handles ? as a single character', () => {
    expect(matches('src/?.tsx', 'src/a.tsx')).toBe(true);
    expect(matches('src/?.tsx', 'src/ab.tsx')).toBe(false);
  });
});

describe('createStoryMatcher + findStoryFiles', () => {
  const root = mkdtempSync(join(tmpdir(), 'ns-glob-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const write = (path: string): void => {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), 'export {}\n');
  };

  write('src/Button.stories.tsx');
  write('src/deep/Card.stories.ts');
  write('src/Card.play.tsx');
  write('src/NotAStory.tsx');
  write('node_modules/pkg/Evil.stories.tsx');

  it('finds matching files, skipping node_modules', () => {
    const matcher = createStoryMatcher(root, ['src/**/*.stories.{tsx,ts}', '**/*.play.{tsx,jsx}']);
    const files = findStoryFiles(matcher).map((f: string) => f.slice(root.length + 1));
    expect(files).toEqual(['src/Button.stories.tsx', 'src/Card.play.tsx', 'src/deep/Card.stories.ts']);
  });

  it('exposes static base dirs for watching', () => {
    const matcher = createStoryMatcher(root, ['src/**/*.stories.tsx', '**/*.play.tsx']);
    expect(matcher.baseDirs).toEqual([join(root, 'src'), root]);
  });

  it('matches absolute patterns with ../ hops (Storybook style)', () => {
    const matcher = createStoryMatcher(root, [join(root, '.storybook', '../src/**/*.stories.@(ts|tsx)')]);
    expect(matcher.match(join(root, 'src/deep/Card.stories.ts'))).toBe(true);
    expect(matcher.match(join(root, 'src/Card.play.tsx'))).toBe(false);
  });

  it('never matches inside node_modules', () => {
    const matcher = createStoryMatcher(root, ['**/*.stories.tsx']);
    expect(matcher.match(join(root, 'node_modules/pkg/Evil.stories.tsx'))).toBe(false);
  });
});
