/**
 * Safe-area insets, declared by the EMBEDDER.
 *
 * A canvas in a page has no OS chrome, so zero is the right default and stays
 * the default. But a surface is very often standing in for a device viewport,
 * and a mobile app lays itself out around these numbers. The case that forced
 * this: apps size a presented sheet `screenHeight - insets.top`, so with a
 * zero top inset a "full height" sheet covers the surface completely and
 * leaves no backdrop to dismiss it by.
 *
 * There was no way to supply them. `react-native-safe-area-context`'s
 * `initialWindowMetrics` is `null` here — honestly so, since at module-eval
 * time no surface exists — and essentially every app writes
 * `<SafeAreaProvider initialMetrics={initialWindowMetrics}>`, so the compat
 * shim's `simulatedDeviceMetrics()` escape hatch could never be reached.
 */
import { describe, expect, it } from 'vitest';
import * as React from 'react';
import { Text, View, useSurfaceInsets } from '../src/index';
import { SafeAreaProvider, initialWindowMetrics, useSafeAreaInsets } from '../../compat/src/safe-area';
import { createTestRoot, findNode } from './helpers';

function Probe({ hook }: { hook: () => { top: number; bottom: number; left: number; right: number } }) {
  const i = hook();
  return <Text testID="probe">{`${i.top}/${i.right}/${i.bottom}/${i.left}`}</Text>;
}
const read = (root: ReturnType<typeof createTestRoot>) =>
  findNode(root.getLayoutTree(), (n) => n.testID === 'probe')!.text;

describe('surface safe-area insets', () => {
  it('defaults to zero — a canvas has no OS chrome', async () => {
    const root = createTestRoot(390, 844);
    root.render(<Probe hook={useSurfaceInsets} />);
    await root.flush();
    expect(read(root)).toBe('0/0/0/0');
    root.unmount();
  });

  it('reports what the embedder declared, filling the rest from zero', async () => {
    const root = createTestRoot(390, 844, { safeAreaInsets: { top: 47, bottom: 34 } });
    root.render(<Probe hook={useSurfaceInsets} />);
    await root.flush();
    expect(read(root)).toBe('47/0/34/0');
    root.unmount();
  });

  it('reaches an app through SafeAreaProvider — the path every app actually uses', async () => {
    // Verbatim what the app writes, and `initialWindowMetrics` is null here.
    expect(initialWindowMetrics).toBeNull();
    const root = createTestRoot(390, 844, { safeAreaInsets: { top: 47, bottom: 34 } });
    root.render(
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <Probe hook={useSafeAreaInsets} />
      </SafeAreaProvider>
    );
    await root.flush();
    expect(read(root)).toBe('47/0/34/0');
    root.unmount();
  });

  it('lets explicit initialMetrics win — an app passing values means them', async () => {
    const root = createTestRoot(390, 844, { safeAreaInsets: { top: 47, bottom: 34 } });
    root.render(
      <SafeAreaProvider initialMetrics={{ insets: { top: 5, right: 0, bottom: 6, left: 0 }, frame: { x: 0, y: 0, width: 390, height: 844 } }}>
        <Probe hook={useSafeAreaInsets} />
      </SafeAreaProvider>
    );
    await root.flush();
    expect(read(root)).toBe('5/0/6/0');
    root.unmount();
  });

  it('updates live when the embedder changes them', async () => {
    const root = createTestRoot(390, 844, { safeAreaInsets: { top: 47 } });
    root.render(<Probe hook={useSurfaceInsets} />);
    await root.flush();
    expect(read(root)).toBe('47/0/0/0');
    root.setSafeAreaInsets({ top: 59, bottom: 34 });
    await root.flush();
    expect(read(root)).toBe('59/0/34/0');
    root.unmount();
  });

  it('gives a padded layout the space it asked for', async () => {
    // The consequence that matters: a header inset by the top inset actually
    // sits below the status bar instead of flush against the bezel.
    const root = createTestRoot(390, 844, { safeAreaInsets: { top: 47 } });
    function Header() {
      const insets = useSafeAreaInsets();
      return (
        <View style={{ paddingTop: insets.top }}>
          <View testID="bar" style={{ height: 44 }} />
        </View>
      );
    }
    root.render(
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <Header />
      </SafeAreaProvider>
    );
    await root.flush();
    expect(findNode(root.getLayoutTree(), (n) => n.testID === 'bar')!.frame.y).toBe(47);
    root.unmount();
  });
});
