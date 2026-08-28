// @vitest-environment jsdom
/**
 * AppState contract. The module binds its DOM listeners on the first
 * subscriber and releases them with the last, so each case loads a FRESH
 * module instance — that is also what lets the no-document (SSR / Node) path
 * be asserted from inside a jsdom run.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppStateStatus } from '../src/api/AppState';

type AppStateModule = typeof import('../src/api/AppState');

async function loadAppState(): Promise<AppStateModule> {
  vi.resetModules();
  return import('../src/api/AppState');
}

/** jsdom's visibilityState is a prototype getter; shadow it, then fire the
 *  event the browser would fire. */
function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

afterEach(() => {
  vi.unstubAllGlobals(); // restores the real document before the shadow is removed
  delete (document as unknown as { visibilityState?: unknown }).visibilityState;
});

describe('AppState', () => {
  it('starts active and reports the page visibility live', async () => {
    const { AppState } = await loadAppState();
    expect(AppState.isAvailable).toBe(true);
    expect(AppState.currentState).toBe('active');

    setVisibility('hidden');
    expect(AppState.currentState).toBe('background');
    setVisibility('visible');
    expect(AppState.currentState).toBe('active');
  });

  it('notifies change listeners when the page is hidden and shown again', async () => {
    const { AppState } = await loadAppState();
    const seen: AppStateStatus[] = [];
    AppState.addEventListener('change', (state) => seen.push(state));

    setVisibility('hidden');
    setVisibility('visible');
    expect(seen).toEqual(['background', 'active']);

    // A visibilitychange that doesn't change the status is not an event.
    setVisibility('visible');
    expect(seen).toEqual(['background', 'active']);
  });

  it('remove() unsubscribes, and removeEventListener does too', async () => {
    const { AppState } = await loadAppState();
    const seen: AppStateStatus[] = [];
    const subscription = AppState.addEventListener('change', (state) => seen.push(state));
    setVisibility('hidden');
    expect(seen).toEqual(['background']);

    subscription.remove();
    setVisibility('visible');
    setVisibility('hidden');
    expect(seen).toEqual(['background']); // removed means removed

    const legacy = (state: AppStateStatus): number => seen.push(state);
    AppState.addEventListener('change', legacy);
    AppState.removeEventListener('change', legacy);
    setVisibility('visible');
    expect(seen).toEqual(['background']);
  });

  it('window focus and blur drive the focus/blur events', async () => {
    const { AppState } = await loadAppState();
    const order: string[] = [];
    const focus = AppState.addEventListener('focus', () => order.push('focus'));
    AppState.addEventListener('blur', () => order.push('blur'));

    window.dispatchEvent(new Event('blur'));
    window.dispatchEvent(new Event('focus'));
    expect(order).toEqual(['blur', 'focus']);

    focus.remove();
    window.dispatchEvent(new Event('focus'));
    expect(order).toEqual(['blur', 'focus']);
  });

  it('accepts memoryWarning listeners that never fire (no platform signal)', async () => {
    const { AppState } = await loadAppState();
    const warned = vi.fn();
    AppState.addEventListener('memoryWarning', warned);
    setVisibility('hidden');
    window.dispatchEvent(new Event('blur'));
    expect(warned).not.toHaveBeenCalled();
  });

  it('reports active and stays inert with no document or window (SSR, node)', async () => {
    vi.stubGlobal('document', undefined);
    vi.stubGlobal('window', undefined);
    const { AppState } = await loadAppState();

    expect(AppState.currentState).toBe('active');
    const seen: AppStateStatus[] = [];
    // Subscribing at import time is exactly what Sentry does: it must not throw.
    const subscription = AppState.addEventListener('change', (state) => seen.push(state));
    expect(seen).toEqual([]);
    subscription.remove(); // no throw is the assertion
  });
});
