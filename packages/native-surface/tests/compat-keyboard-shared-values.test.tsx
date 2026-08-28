/**
 * The keyboard shim's values must be shaped like reanimated SharedValues.
 *
 * There is no OS keyboard on a canvas host, so these never move — but the
 * SHAPE is not optional. They used to be `{ value: 0 }`, which reanimated 3
 * code reading `.value` was happy with; reanimated 4 renamed the accessors and
 * every real caller now writes `height.get()`. Bluesky's
 * `Dialog.FlatListFooter`, its `KeyboardStickyView` and its message composer
 * all do, so a bare `{value}` threw `height.get is not a function` the moment
 * any dialog with a footer rendered. A crash, not a missing feature — the
 * "missing MEMBER fails late" shape again.
 */
import { describe, expect, it } from 'vitest';
import { renderHook } from './helpers-hooks';
import {
  useKeyboardAnimation,
  useKeyboardContext,
  useReanimatedKeyboardAnimation,
} from '../../compat/src/keyboard-controller';

const SHARED_VALUE_API = ['get', 'set', 'addListener', 'removeListener', 'modify'] as const;

const assertSharedValue = (v: unknown) => {
  for (const member of SHARED_VALUE_API) {
    expect(typeof (v as Record<string, unknown>)[member]).toBe('function');
  }
  expect((v as { value: number }).value).toBe(0);
  expect((v as { get(): number }).get()).toBe(0);
};

describe('keyboard-controller shared values', () => {
  it('useReanimatedKeyboardAnimation returns real shared values', async () => {
    const hook = await renderHook(() => useReanimatedKeyboardAnimation());
    assertSharedValue(hook.current.height);
    assertSharedValue(hook.current.progress);
    hook.unmount();
  });

  it('useKeyboardAnimation does too', async () => {
    const hook = await renderHook(() => useKeyboardAnimation());
    assertSharedValue(hook.current.height);
    assertSharedValue(hook.current.progress);
    hook.unmount();
  });

  it('useKeyboardContext exposes them on both channels', async () => {
    const hook = await renderHook(() => useKeyboardContext());
    assertSharedValue(hook.current.reanimated.height);
    assertSharedValue(hook.current.reanimated.progress);
    assertSharedValue(hook.current.animated.height);
    assertSharedValue(hook.current.animated.progress);
    hook.unmount();
  });

  it('reads back what a caller writes, through either accessor', async () => {
    const hook = await renderHook(() => useReanimatedKeyboardAnimation());
    const { height } = hook.current;
    height.set(120);
    expect(height.get()).toBe(120);
    expect(height.value).toBe(120);
    // The updater form, as reanimated documents it.
    height.set((current) => current + 5);
    expect(height.get()).toBe(125);
    height.modify((current) => current * 2);
    expect(height.get()).toBe(250);
    hook.unmount();
  });

  it('notifies listeners on write, and stops after removal', async () => {
    const hook = await renderHook(() => useReanimatedKeyboardAnimation());
    const { progress } = hook.current;
    const seen: number[] = [];
    progress.addListener(1, (v) => seen.push(v));
    progress.set(1);
    progress.removeListener(1);
    progress.set(0);
    expect(seen).toEqual([1]);
    hook.unmount();
  });

  it('is stable across re-renders, so an animated style is not rebuilt', async () => {
    const hook = await renderHook(() => useReanimatedKeyboardAnimation());
    const before = hook.current.height;
    await hook.rerender();
    expect(hook.current.height).toBe(before);
    hook.unmount();
  });
});
