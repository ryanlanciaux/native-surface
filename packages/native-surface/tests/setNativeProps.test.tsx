import { describe, expect, it } from 'vitest';
import React from 'react';
import { View } from '../src/index';
import type { CNode } from '../src/engine/node';
import { createTestRoot, findNode } from './helpers';

describe('setNativeProps (reanimated web seam)', () => {
  it('applies style patches directly and persists them across React commits', async () => {
    const root = createTestRoot(200, 200);
    let ref: CNode | null = null;
    const ui = (bg: string) => (
      <View
        ref={(n) => {
          ref = n as CNode | null;
        }}
        testID="target"
        style={{ width: 40, height: 40, backgroundColor: bg }}
      />
    );
    root.render(ui('#ff0000'));
    await root.flush();
    expect(ref).not.toBeNull();

    // Direct patch: layout-affecting style + a non-style prop
    ref!.setNativeProps({ style: { width: 120, transform: [{ translateY: 30 }] }, testID: 'patched' });
    await root.flush();
    let node = findNode(root.getLayoutTree(), (n) => n.frame.width === 120);
    expect(node).not.toBeNull();
    expect(ref!.props.testID).toBe('patched');
    expect(ref!.paint.transform?.length).toBeGreaterThan(0);

    // React re-render with different props: overrides persist on top
    root.render(ui('#00ff00'));
    await root.flush();
    node = findNode(root.getLayoutTree(), (n) => n.frame.width === 120);
    expect(node).not.toBeNull();
    expect(ref!.flatStyle.backgroundColor).toBe('#00ff00'); // non-overridden key follows React

    root.unmount();
  });
});
