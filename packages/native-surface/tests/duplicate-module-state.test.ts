/**
 * The engine survives being loaded TWICE.
 *
 * This is not hypothetical. A bundler inlines a module into every prebundled
 * dependency that imports it, so "module scope" is not one scope. In the app
 * that found this, `react-native` is aliased to the engine and prebundled — it
 * has to be, because prebundled CJS packages require deep
 * `react-native/Libraries/*` ids at runtime — while the compat shims import
 * the engine as source. Two copies, two `DimensionsContext` objects.
 *
 * The renderer then provides the surface's size on one copy's context, an app
 * component reads the other copy's context, gets null, falls through to
 * `Dimensions.get('window')` whose `primary` is null in that copy too, and
 * lands on `window.innerWidth`/`innerHeight`. The app is told it is the size
 * of the BROWSER WINDOW instead of its surface — which is how a bottom sheet
 * sized `screenHeight - insets.top` came out 953pt tall on an 844pt surface
 * and hung its header 109pt above the top of the screen.
 *
 * `vi.resetModules()` + a re-import is a faithful stand-in for that second
 * copy: the module body runs again, exactly as it does inside a dep bundle.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('engine state shared across duplicate module copies', () => {
  beforeEach(() => {
    delete (globalThis as unknown as Record<string, unknown>).__nativeSurfaceDimensions;
    delete (globalThis as unknown as Record<string, unknown>).__nativeSurfaceHairline;
    vi.resetModules();
  });

  it('hands both copies the SAME context objects', async () => {
    const first = await import('../src/api/Dimensions');
    vi.resetModules();
    const second = await import('../src/api/Dimensions');

    // Distinct module records...
    expect(second).not.toBe(first);
    // ...and yet one context, or a Provider in one is invisible to the other.
    expect(second.DimensionsContext).toBe(first.DimensionsContext);
    expect(second.SurfaceInsetsContext).toBe(first.SurfaceInsetsContext);
  });

  it('lets one copy read the dimensions the other copy set', async () => {
    const first = await import('../src/api/Dimensions');
    vi.resetModules();
    const second = await import('../src/api/Dimensions');

    first.setPrimaryDimensions({ width: 390, height: 844, scale: 2, fontScale: 1 }, true);
    // Without shared state this answers window.innerWidth/innerHeight — or
    // 0x0 under Node — and the app lays out for the wrong box entirely.
    expect(second.Dimensions.get('window')).toEqual({ width: 390, height: 844, scale: 2, fontScale: 1 });
  });

  it('carries the actively-rendering root across copies', async () => {
    const first = await import('../src/api/Dimensions');
    vi.resetModules();
    const second = await import('../src/api/Dimensions');

    first.setPrimaryDimensions({ width: 390, height: 844, scale: 1, fontScale: 1 }, true);
    const prev = first.pushActiveRenderDimensions({ width: 1024, height: 768, scale: 1, fontScale: 1 });
    try {
      // A library reading Dimensions at mount time must get the surface it is
      // being rendered into, not the first surface on the page.
      expect(second.Dimensions.get('window').width).toBe(1024);
    } finally {
      first.popActiveRenderDimensions(prev);
    }
    expect(second.Dimensions.get('window').width).toBe(390);
  });

  it('shares the hairline width, so borders are not drawn at two widths', async () => {
    const first = await import('../src/api/StyleSheet');
    vi.resetModules();
    const second = await import('../src/api/StyleSheet');

    first.setHairlineWidth(1 / 3);
    expect(second.StyleSheet.hairlineWidth).toBeCloseTo(1 / 3, 6);
    // Restore, so ordering between test files cannot leak a width.
    first.setHairlineWidth(0.5);
  });

  it('delivers a change event to a listener registered through the other copy', async () => {
    const first = await import('../src/api/Dimensions');
    vi.resetModules();
    const second = await import('../src/api/Dimensions');

    const seen: number[] = [];
    const sub = second.Dimensions.addEventListener('change', ({ window }) => seen.push(window.width));
    first.setPrimaryDimensions({ width: 500, height: 800, scale: 1, fontScale: 1 }, true);
    sub.remove();
    first.setPrimaryDimensions({ width: 600, height: 800, scale: 1, fontScale: 1 }, true);
    expect(seen).toEqual([500]);
  });
});
