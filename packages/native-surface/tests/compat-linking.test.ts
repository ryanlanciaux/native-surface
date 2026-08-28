/**
 * `clearInitialURL()` must not rewrite the host page's address bar.
 *
 * It used to do `history.replaceState(history.state, '', location.pathname)`,
 * on the reasoning that on the web the address bar IS the launch URL. On a
 * canvas host that reasoning fails: the app is a COMPONENT inside somebody
 * else's page, and the URL belongs to the host document. Wiping it destroyed
 * state the app never owned — any `?flag=` an embedder or a debugging harness
 * had put there — silently, seconds into boot, with no navigation to show for
 * it. The harness's own `?mock=1` was the first casualty.
 *
 * It was reached on EVERY boot, not just on a real deep link: `getInitialURL()`
 * answers with the current address, which is always truthy, so an app guarding
 * `if (url) handle(url).finally(clearInitialURL)` clears unconditionally.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const HREF = 'http://host.test/app?mock=1&debug=layout#thread';

async function freshLinking() {
  delete (globalThis as unknown as Record<string, unknown>).__nativeSurfaceLinking;
  vi.resetModules();
  return import('../../compat/src/expo');
}

describe('expo-linking compat: the launch URL', () => {
  const replaceState = vi.fn();
  beforeEach(() => {
    vi.stubGlobal('location', { href: HREF, pathname: '/app', origin: 'http://host.test' });
    vi.stubGlobal('history', { state: null, replaceState });
    vi.stubGlobal('window', { location: { href: HREF, origin: 'http://host.test' } });
    replaceState.mockClear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('reports the address as the launch URL until it is consumed', async () => {
    const linking = await freshLinking();
    expect(linking.getLinkingURL()).toBe(HREF);
    await expect(linking.getInitialURL()).resolves.toBe(HREF);
  });

  it('leaves the address bar completely alone when cleared', async () => {
    const linking = await freshLinking();
    await linking.clearInitialURL();
    // The one assertion this file exists for.
    expect(replaceState).not.toHaveBeenCalled();
  });

  it('answers null after clearing, so a remount does not re-handle the link', async () => {
    // The native contract the callers are written against: expo-linking caches
    // the launch URL and replays it, and clearing drops that cache.
    const linking = await freshLinking();
    await linking.clearInitialURL();
    expect(linking.getLinkingURL()).toBeNull();
    await expect(linking.getInitialURL()).resolves.toBeNull();
  });

  it('shares "consumed" across duplicate copies of the module', async () => {
    // Same reason as api/Dimensions.ts: the bundler inlines this module into
    // every prebundled dependency, so clearing through one copy has to be
    // visible to the copy the app later reads through.
    const first = await freshLinking();
    vi.resetModules();
    const second = await import('../../compat/src/expo');
    await first.clearInitialURL();
    expect(second.getLinkingURL()).toBeNull();
  });
});
