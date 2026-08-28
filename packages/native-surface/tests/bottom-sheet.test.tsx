/**
 * Bottom-sheet compat contract, driven through the real engine: layout comes
 * from Yoga, the backdrop press comes from the pointer pipeline, and the
 * animations run on the engine's own ticker.
 *
 * The load-bearing assertion in here is the STATE SEQUENCE. The caller
 * (BottomSheetNativeComponent) mounts on 'opening' and UNMOUNTS the whole
 * subtree the moment it sees 'closed', so a sheet that never emits 'closed'
 * can never be closed and one that emits it early destroys itself
 * mid-animation. `Caller` below reproduces that exactly — subtree shape
 * included, since the content-hugging measurement reads that shape.
 */
import { describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import {
  BottomSheetSnapPoint,
  BottomSheetView,
  createBottomSheetModule,
  registerBottomSheet,
  type BottomSheetState,
  type BottomSheetViewHandle,
  type BottomSheetViewProps,
} from '../../compat/src/bottom-sheet';
import { requireNativeModule, requireNativeViewManager } from '../../compat/src/expo-modules-core';
import { View } from '../src/components/primitives';
import { createTestRoot, findNode, sleep } from './helpers';
import type { LayoutNode, NativeRoot } from '../src/types';

const SURFACE_WIDTH = 400;
const SURFACE_HEIGHT = 800;
/** What the caller computes: screen height minus the top inset. */
const SHEET_BOX_HEIGHT = 700;
const CONTENT_HEIGHT = 120;
/** Longer than the shim's present/dismiss animations. */
const ANIMATION_SLACK_MS = 420;

/**
 * The caller's subtree, byte-for-byte in shape: an absolutely-positioned
 * presentation box, a `flex: 1` wrapper carrying the dialog background, and a
 * wrapper that only takes `flex: 1` when the height is constrained.
 */
function Caller(
  props: BottomSheetViewProps & { contentHeight?: number }
): React.JSX.Element {
  const { children, contentHeight = CONTENT_HEIGHT, maxHeight, fullHeight, ...rest } = props;
  const isHeightConstrained = maxHeight != null || fullHeight === true;
  return (
    <BottomSheetView
      {...rest}
      maxHeight={maxHeight}
      fullHeight={fullHeight}
      style={{ position: 'absolute', height: SHEET_BOX_HEIGHT, width: '100%' }}
    >
      <View style={[{ flex: 1, backgroundColor: '#ffffff' }, maxHeight != null ? { maxHeight } : null]}>
        <View style={isHeightConstrained ? { flex: 1 } : undefined}>
          {children ?? <View testID="content" style={{ height: contentHeight, backgroundColor: '#3366ff' }} />}
        </View>
      </View>
    </BottomSheetView>
  );
}

const createRoot = (): NativeRoot => createTestRoot(SURFACE_WIDTH, SURFACE_HEIGHT);

/** Flushes until the measure → resize → re-measure convergence has settled. */
async function settle(root: NativeRoot): Promise<void> {
  await root.flush();
  await root.flush();
  await root.flush();
}

/** Settles, waits out an in-flight present/dismiss animation, settles again. */
async function settleAnimated(root: NativeRoot): Promise<void> {
  await settle(root);
  await sleep(ANIMATION_SLACK_MS);
  await settle(root);
}

const sheetNode = (root: NativeRoot, testID = 'sheet'): LayoutNode | null =>
  findNode(root.getLayoutTree(), (n) => n.testID === testID);

describe('bottom-sheet compat', () => {
  it('reports opening then open on mount, and closing then closed on dismiss()', async () => {
    const root = createRoot();
    const states: BottomSheetState[] = [];
    const ref = React.createRef<BottomSheetViewHandle>();

    root.render(
      <Caller ref={ref} testID="sheet" onStateChange={(e) => states.push(e.nativeEvent.state)} />
    );
    await settle(root);
    // 'opening' is announced on mount, before the sheet has finished moving.
    expect(states).toEqual(['opening']);

    await settleAnimated(root);
    expect(states).toEqual(['opening', 'open']);

    ref.current!.dismiss();
    // Asserted synchronously, with no flush in between: 'closing' is emitted
    // the instant the dismissal starts, and 'closed' must NOT follow until the
    // animation lands — the caller tears the subtree down on 'closed'.
    expect(states).toEqual(['opening', 'open', 'closing']);

    await settleAnimated(root);
    expect(states).toEqual(['opening', 'open', 'closing', 'closed']);
    root.unmount();
  });

  it('a caller that unmounts on closed really does go away', async () => {
    const root = createRoot();
    // Exactly what BottomSheetNativeComponent does with the event.
    function Host(): React.JSX.Element | null {
      const [open, setOpen] = React.useState(true);
      if (!open) return null;
      return <Caller testID="sheet" onStateChange={(e) => e.nativeEvent.state === 'closed' && setOpen(false)} />;
    }
    const ref = React.createRef<BottomSheetViewHandle>();
    root.render(
      <View style={{ flex: 1 }}>
        <Host />
        <Caller ref={ref} testID="other" />
      </View>
    );
    await settleAnimated(root);
    expect(sheetNode(root)).not.toBeNull();

    await createBottomSheetModule().dismissAll();
    await settleAnimated(root);
    expect(sheetNode(root)).toBeNull();
    // The second sheet closed too, and its caller kept it mounted.
    expect(sheetNode(root, 'other')).not.toBeNull();
    root.unmount();
  });

  it('dismissAll() closes every mounted sheet', async () => {
    const root = createRoot();
    const first: BottomSheetState[] = [];
    const second: BottomSheetState[] = [];
    root.render(
      <View style={{ flex: 1 }}>
        <Caller testID="first" onStateChange={(e) => first.push(e.nativeEvent.state)} />
        <Caller testID="second" onStateChange={(e) => second.push(e.nativeEvent.state)} />
      </View>
    );
    await settleAnimated(root);
    expect(first).toEqual(['opening', 'open']);
    expect(second).toEqual(['opening', 'open']);

    await createBottomSheetModule().dismissAll();
    await settleAnimated(root);
    expect(first).toEqual(['opening', 'open', 'closing', 'closed']);
    expect(second).toEqual(['opening', 'open', 'closing', 'closed']);
    root.unmount();
  });

  it('a backdrop press dismisses', async () => {
    const root = createRoot();
    const states: BottomSheetState[] = [];
    const onAttemptDismiss = vi.fn();
    root.render(
      <Caller testID="sheet" onAttemptDismiss={onAttemptDismiss} onStateChange={(e) => states.push(e.nativeEvent.state)} />
    );
    await settleAnimated(root);

    // Well above the sheet's top edge: the scrim, not the sheet.
    const sheet = sheetNode(root)!;
    expect(sheet.frame.y).toBeGreaterThan(100);
    root.dispatchPointerEvent('down', { x: 200, y: 20 });
    root.dispatchPointerEvent('up', { x: 200, y: 20 });
    await settleAnimated(root);

    // The attempt is reported either way — iOS asks the delegate first.
    expect(onAttemptDismiss).toHaveBeenCalledTimes(1);
    expect(states).toEqual(['opening', 'open', 'closing', 'closed']);
    root.unmount();
  });

  it('preventDismiss reports the attempt and stays open', async () => {
    const root = createRoot();
    const states: BottomSheetState[] = [];
    const onAttemptDismiss = vi.fn();
    root.render(
      <Caller
        testID="sheet"
        preventDismiss
        onAttemptDismiss={onAttemptDismiss}
        onStateChange={(e) => states.push(e.nativeEvent.state)}
      />
    );
    await settleAnimated(root);

    root.dispatchPointerEvent('down', { x: 200, y: 20 });
    root.dispatchPointerEvent('up', { x: 200, y: 20 });
    await settleAnimated(root);

    expect(onAttemptDismiss).toHaveBeenCalledTimes(1);
    expect(states).toEqual(['opening', 'open']);
    expect(sheetNode(root)).not.toBeNull();
    root.unmount();
  });

  it('a downward drag past the threshold dismisses, and disableDrag stops it', async () => {
    const drag = async (root: NativeRoot, top: number): Promise<void> => {
      // Grant costs the slop; PanResponder resets dx/dy at the grant, so the
      // travel that counts starts from the second move.
      root.dispatchPointerEvent('down', { x: 200, y: top + 10 });
      root.dispatchPointerEvent('move', { x: 200, y: top + 50 });
      root.dispatchPointerEvent('move', { x: 200, y: top + 250 });
      root.dispatchPointerEvent('up', { x: 200, y: top + 250 });
      await settleAnimated(root);
    };

    const dragged = createRoot();
    const states: BottomSheetState[] = [];
    dragged.render(<Caller testID="sheet" onStateChange={(e) => states.push(e.nativeEvent.state)} />);
    await settleAnimated(dragged);
    await drag(dragged, sheetNode(dragged)!.frame.y);
    expect(states).toEqual(['opening', 'open', 'closing', 'closed']);
    dragged.unmount();

    const locked = createRoot();
    const lockedStates: BottomSheetState[] = [];
    locked.render(
      <Caller testID="sheet" disableDrag onStateChange={(e) => lockedStates.push(e.nativeEvent.state)} />
    );
    await settleAnimated(locked);
    await drag(locked, sheetNode(locked)!.frame.y);
    expect(lockedStates).toEqual(['opening', 'open']);
    locked.unmount();
  });

  it('hugs its content, and fullHeight takes the whole box', async () => {
    const hugging = createRoot();
    hugging.render(<Caller testID="sheet" contentHeight={CONTENT_HEIGHT} />);
    await settleAnimated(hugging);
    const hugged = sheetNode(hugging)!;
    expect(hugged.frame.height).toBe(CONTENT_HEIGHT);
    expect(hugged.frame.height).toBeLessThan(SHEET_BOX_HEIGHT);
    // Bottom-anchored: the sheet sits ON the surface bottom, not at the top of
    // the caller's absolutely-positioned presentation box.
    expect(hugged.frame.y + hugged.frame.height).toBe(SURFACE_HEIGHT);
    hugging.unmount();

    const taller = createRoot();
    taller.render(<Caller testID="sheet" contentHeight={CONTENT_HEIGHT * 2} />);
    await settleAnimated(taller);
    expect(sheetNode(taller)!.frame.height).toBe(CONTENT_HEIGHT * 2);
    taller.unmount();

    const full = createRoot();
    full.render(<Caller testID="sheet" fullHeight />);
    await settleAnimated(full);
    expect(sheetNode(full)!.frame.height).toBe(SHEET_BOX_HEIGHT);
    full.unmount();
  });

  it('clamps the measured height into minHeight/maxHeight', async () => {
    const floored = createRoot();
    floored.render(<Caller testID="sheet" contentHeight={40} minHeight={200} />);
    await settleAnimated(floored);
    expect(sheetNode(floored)!.frame.height).toBe(200);
    floored.unmount();

    // maxHeight makes the caller's content stretch (isHeightConstrained), so
    // the sheet takes exactly the cap — the same result as on the device.
    const capped = createRoot();
    capped.render(<Caller testID="sheet" contentHeight={CONTENT_HEIGHT} maxHeight={300} />);
    await settleAnimated(capped);
    expect(sheetNode(capped)!.frame.height).toBe(300);
    capped.unmount();
  });

  it('expands to the full detent on an upward drag, unless expansion is prevented', async () => {
    const dragUp = async (root: NativeRoot): Promise<void> => {
      const top = sheetNode(root)!.frame.y;
      root.dispatchPointerEvent('down', { x: 200, y: top + 20 });
      root.dispatchPointerEvent('move', { x: 200, y: top - 20 });
      root.dispatchPointerEvent('move', { x: 200, y: top - 100 });
      root.dispatchPointerEvent('up', { x: 200, y: top - 100 });
      await settleAnimated(root);
    };

    const expandable = createRoot();
    const snaps: number[] = [];
    expandable.render(<Caller testID="sheet" onSnapPointChange={(e) => snaps.push(e.nativeEvent.snapPoint)} />);
    await settleAnimated(expandable);
    expect(sheetNode(expandable)!.frame.height).toBe(CONTENT_HEIGHT);

    await dragUp(expandable);
    expect(sheetNode(expandable)!.frame.height).toBe(SHEET_BOX_HEIGHT);
    expect(snaps).toEqual([BottomSheetSnapPoint.Partial, BottomSheetSnapPoint.Full]);
    expandable.unmount();

    const pinned = createRoot();
    const pinnedSnaps: number[] = [];
    pinned.render(
      <Caller testID="sheet" preventExpansion onSnapPointChange={(e) => pinnedSnaps.push(e.nativeEvent.snapPoint)} />
    );
    await settleAnimated(pinned);
    await dragUp(pinned);
    expect(sheetNode(pinned)!.frame.height).toBe(CONTENT_HEIGHT);
    expect(pinnedSnaps).toEqual([BottomSheetSnapPoint.Partial]);
    pinned.unmount();
  });

  it('measures the content box, not something nested inside it', async () => {
    // Regression: a rule that compares each node against its PARENT walks past
    // the content box once the sheet has been resized to match it, and reports
    // the height of whatever sits inside — collapsing the sheet a step at a
    // time on every subsequent layout.
    const root = createRoot();
    root.render(
      <Caller testID="sheet">
        <View style={{ height: CONTENT_HEIGHT, paddingTop: 20 }}>
          <View testID="inner" style={{ height: 30 }} />
        </View>
      </Caller>
    );
    await settleAnimated(root);
    expect(sheetNode(root)!.frame.height).toBe(CONTENT_HEIGHT);

    // Force several more layout passes; the measurement has to be a fixed point.
    await settleAnimated(root);
    await settleAnimated(root);
    expect(sheetNode(root)!.frame.height).toBe(CONTENT_HEIGHT);
    root.unmount();
  });

  it('renders its children inside the sheet', async () => {
    const root = createRoot();
    root.render(
      <Caller testID="sheet">
        <View testID="content" style={{ height: CONTENT_HEIGHT }} />
      </Caller>
    );
    await settleAnimated(root);

    const sheet = sheetNode(root)!;
    const content = findNode(sheet, (n) => n.testID === 'content');
    expect(content).not.toBeNull();
    expect(content!.frame.height).toBe(CONTENT_HEIGHT);
    expect(content!.frame.width).toBe(SURFACE_WIDTH);
    root.unmount();
  });

  it('announces the detent it presents at', async () => {
    const partial = createRoot();
    const partialSnaps: number[] = [];
    partial.render(<Caller testID="sheet" onSnapPointChange={(e) => partialSnaps.push(e.nativeEvent.snapPoint)} />);
    await settleAnimated(partial);
    expect(partialSnaps).toEqual([BottomSheetSnapPoint.Partial]);
    partial.unmount();

    const full = createRoot();
    const fullSnaps: number[] = [];
    full.render(<Caller testID="sheet" fullHeight onSnapPointChange={(e) => fullSnaps.push(e.nativeEvent.snapPoint)} />);
    await settleAnimated(full);
    expect(fullSnaps).toEqual([BottomSheetSnapPoint.Full]);

    const ref = React.createRef<BottomSheetViewHandle>();
    full.render(
      <Caller
        ref={ref}
        testID="sheet"
        fullHeight
        onSnapPointChange={(e) => fullSnaps.push(e.nativeEvent.snapPoint)}
      />
    );
    await settle(full);
    ref.current!.dismiss();
    await settleAnimated(full);
    expect(fullSnaps).toEqual([BottomSheetSnapPoint.Full, BottomSheetSnapPoint.Hidden]);
    full.unmount();
  });

  it('registerBottomSheet wires both halves under one name', async () => {
    const module = registerBottomSheet('TestSheet');
    expect(requireNativeViewManager('TestSheet')).toBe(BottomSheetView);
    expect(requireNativeModule('TestSheet')).toBe(module);
    expect(typeof module.dismissAll).toBe('function');
    await expect(module.dismissAll()).resolves.toBeUndefined();
  });
});
