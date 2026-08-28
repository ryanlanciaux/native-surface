/**
 * react-responsive answered by the SURFACE.
 *
 * The bug this prevents is not a rendering nicety. `react-responsive` reads
 * `window.matchMedia`, which on this host describes the BROWSER WINDOW — so an
 * app rendering a 390pt surface inside a wide window is told it is on a
 * desktop and takes every desktop branch. In Bluesky that made
 * `useHeaderOffset()` return 0, reserving no space for the mobile header, and
 * the compose area rendered completely underneath it. On a real device there
 * is no matchMedia at all, every query answers false, and the phone layout is
 * used — which is the behaviour these tests pin.
 */
import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { Text, View } from '../src/index';
import { createTestRoot, findNode } from './helpers';
import { MediaQuery, useMediaQuery } from '../../compat/src/responsive';

/** Renders a probe inside a surface of the given size and reports the match. */
async function matchIn(
  width: number,
  height: number,
  settings: Record<string, unknown>
): Promise<boolean> {
  const root = createTestRoot(width, height);
  let result: boolean | null = null;
  function Probe() {
    result = useMediaQuery(settings);
    return <View testID="probe" style={{ width: 1, height: 1 }} />;
  }
  root.render(<Probe />);
  await root.flush();
  root.unmount();
  return result!;
}

describe('react-responsive over the canvas surface', () => {
  it('answers from the surface, not the browser window', async () => {
    // The exact query Bluesky's `gtMobile` breakpoint uses. A 390pt surface is
    // a phone no matter how wide the window around it is.
    expect(await matchIn(390, 844, { minWidth: 800 })).toBe(false);
    expect(await matchIn(390, 844, { minWidth: 500 })).toBe(false);
    // ...and a genuinely wide surface still reports wide.
    expect(await matchIn(1280, 800, { minWidth: 800 })).toBe(true);
  });

  it('is not fooled by a wide browser window around a narrow surface', async () => {
    // This is the actual failure: matchMedia would say `true` here.
    const matchMedia = vi.fn(() => ({ matches: true, addListener: () => {}, removeListener: () => {} }));
    vi.stubGlobal('window', { innerWidth: 1400, innerHeight: 900, matchMedia });
    try {
      expect(await matchIn(390, 844, { minWidth: 800 })).toBe(false);
      expect(matchMedia).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('handles min/max pairs, px strings, and ranges', async () => {
    expect(await matchIn(900, 700, { minWidth: 800, maxWidth: 1000 })).toBe(true);
    expect(await matchIn(1100, 700, { minWidth: 800, maxWidth: 1000 })).toBe(false);
    expect(await matchIn(900, 700, { minWidth: '800px' })).toBe(true);
    expect(await matchIn(900, 700, { maxWidth: '50em' })).toBe(false); // 50em = 800px
  });

  it('answers orientation and aspect ratio from the surface box', async () => {
    expect(await matchIn(390, 844, { orientation: 'portrait' })).toBe(true);
    expect(await matchIn(844, 390, { orientation: 'portrait' })).toBe(false);
    expect(await matchIn(844, 390, { orientation: 'landscape' })).toBe(true);
    expect(await matchIn(800, 400, { minAspectRatio: '16/9' })).toBe(true);
    expect(await matchIn(400, 800, { minAspectRatio: '16/9' })).toBe(false);
  });

  it('parses the raw query-string form', async () => {
    expect(await matchIn(900, 700, { query: '(min-width: 800px)' })).toBe(true);
    expect(await matchIn(700, 700, { query: '(min-width: 800px)' })).toBe(false);
    expect(await matchIn(900, 700, { query: '(min-width: 800px) and (max-width: 1000px)' })).toBe(true);
  });

  it('reports NO match for a query it cannot evaluate, and says so once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Reporting `true` here would send an app down a branch nothing asked for.
    expect(await matchIn(900, 700, { query: '(min-width: 800px), print' })).toBe(false);
    expect(await matchIn(900, 700, {})).toBe(false);
    expect(warn.mock.calls.some(([m]) => String(m).includes('react-responsive compat'))).toBe(true);
    warn.mockRestore();
  });

  it('honors an explicit device override, because an app that passes values means them', async () => {
    const root = createTestRoot(390, 844);
    let result: boolean | null = null;
    function Probe() {
      result = useMediaQuery({ minWidth: 800 }, { width: 1200, height: 800 });
      return <View style={{ width: 1, height: 1 }} />;
    }
    root.render(<Probe />);
    await root.flush();
    expect(result).toBe(true);
    root.unmount();
  });

  it('renders the component form only when the query matches', async () => {
    const root = createTestRoot(390, 844);
    root.render(
      <View>
        <MediaQuery minWidth={800}>
          <Text testID="wide">wide</Text>
        </MediaQuery>
        <MediaQuery maxWidth={800}>
          <Text testID="narrow">narrow</Text>
        </MediaQuery>
      </View>
    );
    await root.flush();
    const tree = root.getLayoutTree();
    expect(findNode(tree, (n) => n.testID === 'wide')).toBeNull();
    expect(findNode(tree, (n) => n.testID === 'narrow')).not.toBeNull();
    root.unmount();
  });

  it('supports a function child', async () => {
    const root = createTestRoot(390, 844);
    root.render(
      <View>
        <MediaQuery minWidth={800}>{(m: boolean) => <Text testID={m ? 'yes' : 'no'}>x</Text>}</MediaQuery>
      </View>
    );
    await root.flush();
    expect(findNode(root.getLayoutTree(), (n) => n.testID === 'no')).not.toBeNull();
    root.unmount();
  });
});
