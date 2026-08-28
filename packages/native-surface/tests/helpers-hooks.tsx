/** Minimal hook harness: renders a hook inside the engine's own React tree. */
import * as React from 'react';
import { View } from '../src/index';
import { createTestRoot } from './helpers';

export interface HookHandle<T> {
  /** Latest value the hook returned. */
  current: T;
  /** Renders again into the SAME root — how identity stability is checked. */
  rerender(): Promise<T>;
  unmount(): void;
}

export async function renderHook<T>(hook: () => T): Promise<HookHandle<T>> {
  const root = createTestRoot(390, 844);
  let out!: T;
  function Probe() {
    out = hook();
    return <View style={{ width: 1, height: 1 }} />;
  }
  const draw = async () => {
    root.render(<Probe />);
    await root.flush();
    return out;
  };
  await draw();
  return {
    get current() {
      return out;
    },
    rerender: draw,
    unmount: () => root.unmount(),
  };
}
