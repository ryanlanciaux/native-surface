/**
 * Modal contract: the modal is PAINTED BY THE ENGINE, so "is it above the
 * app" is asserted with pixel probes rather than by inspecting a DOM overlay.
 * Colors are chosen so backdrop-white, app-red and content-green can never be
 * confused for one another.
 */
import { describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { Pressable, Text, View } from '../src/components/primitives';
import { Modal } from '../src/components/Modal';
import { asImpl, createTestRoot, findNode } from './helpers';
import type { NativeRoot } from '../src/types';

const APP_RED = '#ff0000';
const CONTENT_GREEN = '#00ff00';

type Pixel = { r: number; g: number; b: number };
const isRed = (p: Pixel): boolean => p.r > 200 && p.g < 60 && p.b < 60;
const isGreen = (p: Pixel): boolean => p.g > 200 && p.r < 60 && p.b < 60;
const isWhite = (p: Pixel): boolean => p.r > 240 && p.g > 240 && p.b > 240;

const center = (root: NativeRoot): Pixel => asImpl(root).readPixel(50, 50);

describe('Modal', () => {
  it('renders nothing at all while hidden', async () => {
    const root = createTestRoot(100, 100);
    root.render(
      <View style={{ flex: 1, backgroundColor: APP_RED }}>
        <Modal visible={false} testID="modal">
          <Text>secret</Text>
        </Modal>
      </View>
    );
    await root.flush();
    expect(findNode(root.getLayoutTree(), (n) => n.testID === 'modal')).toBeNull();
    expect(findNode(root.getLayoutTree(), (n) => n.text === 'secret')).toBeNull();
    expect(isRed(center(root))).toBe(true);
    root.unmount();
  });

  it('fills the surface with an opaque backdrop and renders its children', async () => {
    const root = createTestRoot(100, 100);
    root.render(
      <View style={{ flex: 1, backgroundColor: APP_RED }}>
        <Modal visible testID="modal">
          <Text>hello</Text>
        </Modal>
      </View>
    );
    await root.flush();

    const modal = findNode(root.getLayoutTree(), (n) => n.testID === 'modal');
    expect(modal?.frame).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    expect(findNode(root.getLayoutTree(), (n) => n.text === 'hello')).not.toBeNull();
    // The app behind is fully covered: no scheme override, so the system
    // background is the light one.
    expect(isWhite(center(root))).toBe(true);
    root.unmount();
  });

  it('paints above a later sibling, not just above earlier ones', async () => {
    const root = createTestRoot(100, 100);
    root.render(
      <View style={{ flex: 1, backgroundColor: APP_RED }}>
        <Modal visible testID="modal">
          <View style={{ flex: 1, backgroundColor: CONTENT_GREEN }} />
        </Modal>
        {/* Declared AFTER the modal, so tree order alone would paint it on top. */}
        <View style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: '#0000ff' }} />
      </View>
    );
    await root.flush();
    expect(isGreen(center(root))).toBe(true);
    root.unmount();
  });

  it('transparent skips the backdrop and still shows its children', async () => {
    const root = createTestRoot(100, 100);
    root.render(
      <View style={{ flex: 1, backgroundColor: APP_RED }}>
        <Modal visible transparent testID="modal">
          <View style={{ width: 40, height: 40, backgroundColor: CONTENT_GREEN }} />
        </Modal>
      </View>
    );
    await root.flush();
    const impl = asImpl(root);
    expect(isGreen(impl.readPixel(20, 20))).toBe(true); // the modal's own content
    expect(isRed(impl.readPixel(80, 80))).toBe(true); // the app shows through
    root.unmount();
  });

  it('swallows presses aimed at the content behind it', async () => {
    const root = createTestRoot(100, 100);
    const behind = vi.fn();
    root.render(
      <View style={{ flex: 1, backgroundColor: APP_RED }}>
        <Pressable style={{ flex: 1 }} onPress={behind} />
        <Modal visible transparent testID="modal" />
      </View>
    );
    await root.flush();
    root.dispatchPointerEvent('down', { x: 50, y: 50 });
    root.dispatchPointerEvent('up', { x: 50, y: 50 });
    expect(behind).not.toHaveBeenCalled();
    root.unmount();
  });

  it('reports onShow when presented and onDismiss when it goes away', async () => {
    const root = createTestRoot(100, 100);
    const onShow = vi.fn();
    const onDismiss = vi.fn();
    const tree = (visible: boolean): React.ReactElement => (
      <View style={{ flex: 1, backgroundColor: APP_RED }}>
        <Modal visible={visible} testID="modal" onShow={onShow} onDismiss={onDismiss}>
          <Text>hello</Text>
        </Modal>
      </View>
    );

    // Mounted hidden: no dismissal is reported for a modal never presented.
    root.render(tree(false));
    await root.flush();
    expect(onShow).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();

    root.render(tree(true));
    await root.flush();
    expect(onShow).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();

    root.render(tree(false));
    await root.flush();
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(findNode(root.getLayoutTree(), (n) => n.testID === 'modal')).toBeNull();
    expect(isRed(center(root))).toBe(true);
    root.unmount();
  });
});
