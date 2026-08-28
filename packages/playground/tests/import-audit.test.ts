import { describe, expect, it } from 'vitest';
// @ts-expect-error untyped internal module
import { namedImportsFrom } from '../src/server/plugins.mjs';

describe('namedImportsFrom', () => {
  it('collects named imports for the exact specifier only', () => {
    const code = `
      import firebase, { auth, firestore as store } from 'react-native-firebase-fake';
      import { other } from 'some-other-pkg';
      import * as ns from 'react-native-firebase-fake';
    `;
    expect(namedImportsFrom(code, 'react-native-firebase-fake').sort()).toEqual(['auth', 'firestore']);
  });

  it('handles re-exports and type-only names', () => {
    const code = `
      export { widget } from 'missing-pkg';
      import { type Config, useThing } from 'missing-pkg';
    `;
    expect(namedImportsFrom(code, 'missing-pkg').sort()).toEqual(['Config', 'useThing', 'widget']);
  });

  it('returns nothing for default/namespace-only importers', () => {
    expect(namedImportsFrom(`import thing from 'pkg';`, 'pkg')).toEqual([]);
    expect(namedImportsFrom(`const m = await import('pkg');`, 'pkg')).toEqual([]);
  });
});
