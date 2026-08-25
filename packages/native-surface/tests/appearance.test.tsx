/**
 * Appearance contract. The module caches its matchMedia probe (a host either
 * has one for its whole life or never), so each case loads a FRESH module
 * instance against a fake MediaQueryList — that is also what lets the
 * no-matchMedia (SSR / node) path be asserted at all.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { Text, View } from '../src/components/primitives';
import { Appearance, type ColorSchemeName } from '../src/api/Appearance';
import { useColorScheme } from '../src/api/extras';
import { createTestRoot, findNode } from './helpers';

interface FakeMedia {
  setMatches(dark: boolean): void;
  /** How many change listeners the module currently holds on the query. */
  bound(): number;
}

async function loadAppearance(
  initialDark: boolean | null
): Promise<{ appearance: typeof Appearance; media: FakeMedia }> {
  vi.resetModules();
  const listeners = new Set<(e: unknown) => void>();
  let matches = initialDark === true;
  const query = {
    get matches() {
      return matches;
    },
    media: '(prefers-color-scheme: dark)',
    addEventListener: (type: string, cb: (e: unknown) => void) => {
      if (type === 'change') listeners.add(cb);
    },
    removeEventListener: (_type: string, cb: (e: unknown) => void) => listeners.delete(cb),
  };
  const host = globalThis as { matchMedia?: unknown };
  if (initialDark === null) delete host.matchMedia;
  else host.matchMedia = () => query;
  const mod = (await import('../src/api/Appearance')) as { Appearance: typeof Appearance };
  return {
    appearance: mod.Appearance,
    media: {
      setMatches(dark: boolean) {
        matches = dark;
        for (const cb of [...listeners]) cb({ matches: dark });
      },
      bound: () => listeners.size,
    },
  };
}

afterEach(() => {
  delete (globalThis as { matchMedia?: unknown }).matchMedia;
});

describe('Appearance', () => {
  it('reports the embedding page preference', async () => {
    expect((await loadAppearance(true)).appearance.getColorScheme()).toBe('dark');
    expect((await loadAppearance(false)).appearance.getColorScheme()).toBe('light');
  });

  it('reports light and stays inert where there is no matchMedia (SSR, node)', async () => {
    const { appearance } = await loadAppearance(null);
    expect(appearance.getColorScheme()).toBe('light');
    const seen: ColorSchemeName[] = [];
    const sub = appearance.addChangeListener((p) => seen.push(p.colorScheme));
    expect(seen).toEqual([]);
    sub.remove(); // no throw is the assertion
  });

  it('notifies listeners on a media change and unbinds the query with the last one', async () => {
    const { appearance, media } = await loadAppearance(false);
    const seen: ColorSchemeName[] = [];
    const sub = appearance.addChangeListener((p) => seen.push(p.colorScheme));
    expect(media.bound()).toBe(1);

    media.setMatches(true);
    media.setMatches(false);
    expect(seen).toEqual(['dark', 'light']);

    sub.remove();
    expect(media.bound()).toBe(0);
    media.setMatches(true);
    expect(seen).toEqual(['dark', 'light']); // removed means removed
  });

  it('setColorScheme overrides the query, notifies once, and null restores it', async () => {
    const { appearance, media } = await loadAppearance(false);
    const seen: ColorSchemeName[] = [];
    appearance.addChangeListener((p) => seen.push(p.colorScheme));

    appearance.setColorScheme('dark');
    expect(appearance.getColorScheme()).toBe('dark');
    expect(seen).toEqual(['dark']);
    appearance.setColorScheme('dark');
    expect(seen).toEqual(['dark']); // no-op set, no event

    // The override outranks the page while it stands...
    media.setMatches(true);
    expect(appearance.getColorScheme()).toBe('dark');
    media.setMatches(false);
    expect(appearance.getColorScheme()).toBe('dark');
    expect(seen).toEqual(['dark']); // and silences the query's events

    appearance.setColorScheme(null);
    expect(appearance.getColorScheme()).toBe('light');
    expect(seen).toEqual(['dark', 'light']);
  });
});

describe('useColorScheme', () => {
  it('renders the Appearance scheme and re-renders when it changes', async () => {
    const root = createTestRoot(200, 80);
    function Probe(): React.JSX.Element {
      return <Text>{useColorScheme() ?? 'null'}</Text>;
    }
    root.render(
      <View style={{ flex: 1, backgroundColor: '#ffffff' }}>
        <Probe />
      </View>
    );
    await root.flush();
    const read = (): string | undefined => findNode(root.getLayoutTree(), (n) => n.type === 'Text')?.text;
    expect(read()).toBe('light');

    Appearance.setColorScheme('dark');
    await root.flush();
    expect(read()).toBe('dark');

    Appearance.setColorScheme(null);
    await root.flush();
    root.unmount();
  });
});
