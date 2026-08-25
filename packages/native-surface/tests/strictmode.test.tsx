// @vitest-environment jsdom
/**
 * Regression: under React.StrictMode's dev-only mount/unmount/remount cycle,
 * onReady must fire exactly once (it used to never fire — readyFiredRef
 * survived the remount, so the second root never scheduled a flush, and the
 * first root's flush was discarded by the rootRef guard).
 *
 * The engine is mocked: the bug lives entirely in <NativeSurface>'s lifecycle
 * logic, and a real CanvasKit surface cannot be created on a jsdom canvas.
 * Mock flushes resolve only when a test says so, which lets each test pin the
 * resolution order of the dead root vs. the live one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NativeSurface } from '../src/api/NativeSurface';
import type { NativeRoot } from '../src/types';

interface FakeRoot extends NativeRoot {
  resolveFlush(): void;
}

const state = vi.hoisted(() => ({ created: [] as Array<{ resolveFlush(): void }> }));

vi.mock('../src/engine/renderer', () => {
  const makeFakeRoot = () => {
    let resolve!: () => void;
    const flushed = new Promise<void>((r) => {
      resolve = r;
    });
    return {
      render: () => {},
      unmount: () => {},
      resize: () => {},
      getLayoutTree: () => {
        throw new Error('not implemented');
      },
      flush: () => flushed,
      whenReady: () => flushed,
      canvas: null,
      dispatchPointerEvent: () => {},
      setTheme: () => {},
      setOnAction: () => {},
      resolveFlush: resolve,
    };
  };
  return {
    createNativeRoot: () => {
      const root = makeFakeRoot();
      state.created.push(root);
      return root;
    },
  };
});

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

describe('NativeSurface onReady under StrictMode', () => {
  let container: HTMLDivElement;
  let domRoot: Root | null = null;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    state.created.length = 0;
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(async () => {
    await act(async () => domRoot?.unmount());
    domRoot = null;
    container.remove();
  });

  async function mountStrict(onReady: () => void): Promise<[FakeRoot, FakeRoot]> {
    domRoot = createRoot(container);
    await act(async () => {
      domRoot!.render(
        <StrictMode>
          <NativeSurface width={100} height={100} onReady={onReady}>
            {createElement('rn-view')}
          </NativeSurface>
        </StrictMode>
      );
    });
    // StrictMode remounted the surface: root A is dead, root B is live.
    expect(state.created).toHaveLength(2);
    return state.created as [FakeRoot, FakeRoot];
  }

  it('fires exactly once when the dead root flushes first', async () => {
    const onReady = vi.fn();
    const [deadRoot, liveRoot] = await mountStrict(onReady);

    await act(async () => deadRoot.resolveFlush());
    expect(onReady).not.toHaveBeenCalled();

    await act(async () => liveRoot.resolveFlush());
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it('fires exactly once when the live root flushes first', async () => {
    const onReady = vi.fn();
    const [deadRoot, liveRoot] = await mountStrict(onReady);

    await act(async () => liveRoot.resolveFlush());
    expect(onReady).toHaveBeenCalledTimes(1);

    // The dead root's late resolution must not fire a second time.
    await act(async () => deadRoot.resolveFlush());
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it('fires exactly once without StrictMode', async () => {
    const onReady = vi.fn();
    domRoot = createRoot(container);
    await act(async () => {
      domRoot!.render(
        <NativeSurface width={100} height={100} onReady={onReady}>
          {createElement('rn-view')}
        </NativeSurface>
      );
    });
    expect(state.created).toHaveLength(1);

    await act(async () => (state.created[0] as FakeRoot).resolveFlush());
    expect(onReady).toHaveBeenCalledTimes(1);
  });
});
