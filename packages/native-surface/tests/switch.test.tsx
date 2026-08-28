/**
 * Switch contract: a controlled RN Switch painted by the engine. The thumb's
 * position is a paint-time transform (Yoga frames don't move), so "did it
 * toggle" is asserted with a PIXEL probe on either side of the track, with
 * unmistakable track colors so thumb-white and track are never confusable.
 */
import { describe, expect, it } from 'vitest';
import * as React from 'react';
import { View } from '../src/components/primitives';
import { Switch } from '../src/components/Switch';
import { asImpl, createTestRoot, findNode, sleep } from './helpers';
import type { NativeRoot } from '../src/types';

const PAD = 20; // switch origin inside the root
const CENTER_Y = PAD + 15; // track is 31 tall
const LEFT_PROBE = PAD + 8; // thumb when off, bare track when on
const RIGHT_PROBE = PAD + 45; // bare track when off, thumb when on
const TRACK_OFF = '#ff0000';
const TRACK_ON = '#0000ff';

const isWhite = (p: { r: number; g: number; b: number }): boolean => p.r > 200 && p.g > 200 && p.b > 200;
const isRed = (p: { r: number; g: number; b: number }): boolean => p.r > 180 && p.g < 100 && p.b < 100;
const isBlue = (p: { r: number; g: number; b: number }): boolean => p.b > 180 && p.r < 100 && p.g < 100;

/** Longer than the 180ms toggle, then repaint. */
async function settle(root: NativeRoot): Promise<void> {
  await sleep(300);
  await root.flush();
}

function probe(root: NativeRoot): { left: { r: number; g: number; b: number }; right: { r: number; g: number; b: number } } {
  const impl = asImpl(root);
  return { left: impl.readPixel(LEFT_PROBE, CENTER_Y), right: impl.readPixel(RIGHT_PROBE, CENTER_Y) };
}

function Harness(props: { seen: boolean[]; disabled?: boolean; frozen?: boolean }): React.JSX.Element {
  const [on, setOn] = React.useState(false);
  return (
    <View style={{ flex: 1, backgroundColor: '#ffffff', padding: PAD, alignItems: 'flex-start' }}>
      <Switch
        testID="sw"
        value={on}
        disabled={props.disabled}
        trackColor={{ false: TRACK_OFF, true: TRACK_ON }}
        thumbColor="#ffffff"
        onValueChange={(v) => {
          props.seen.push(v);
          if (!props.frozen) setOn(v);
        }}
      />
    </View>
  );
}

async function tap(root: NativeRoot): Promise<void> {
  root.dispatchPointerEvent('down', { x: PAD + 25, y: CENTER_Y });
  root.dispatchPointerEvent('up', { x: PAD + 25, y: CENTER_Y });
  await settle(root);
}

describe('Switch', () => {
  it('lays out at the iOS track size and is addressable by testID', async () => {
    const seen: boolean[] = [];
    const root = createTestRoot(200, 100);
    root.render(<Harness seen={seen} />);
    await root.flush();
    const node = findNode(root.getLayoutTree(), (n) => n.testID === 'sw');
    expect(node?.frame.width).toBe(51);
    expect(node?.frame.height).toBe(31);
    root.unmount();
  });

  it('paints the thumb left-of-track when off and right-of-track after a tap toggles it', async () => {
    const seen: boolean[] = [];
    const root = createTestRoot(200, 100);
    root.render(<Harness seen={seen} />);
    await settle(root);

    const off = probe(root);
    expect(isWhite(off.left)).toBe(true); // thumb parked left
    expect(isRed(off.right)).toBe(true); // trackColor.false

    await tap(root);
    expect(seen).toEqual([true]);
    const on = probe(root);
    expect(isBlue(on.left)).toBe(true); // trackColor.true, thumb gone
    expect(isWhite(on.right)).toBe(true); // thumb slid right

    // ...and back, so the animation isn't one-way.
    await tap(root);
    expect(seen).toEqual([true, false]);
    const back = probe(root);
    expect(isWhite(back.left)).toBe(true);
    expect(isRed(back.right)).toBe(true);
    root.unmount();
  });

  it('is controlled: an owner that ignores onValueChange gets a switch that does not move', async () => {
    const seen: boolean[] = [];
    const root = createTestRoot(200, 100);
    root.render(<Harness seen={seen} frozen />);
    await settle(root);
    await tap(root);
    expect(seen).toEqual([true]); // asked...
    const still = probe(root);
    expect(isWhite(still.left)).toBe(true); // ...but never told, so unmoved
    expect(isRed(still.right)).toBe(true);
    root.unmount();
  });

  it('disabled: no toggle and the whole control dims', async () => {
    const seen: boolean[] = [];
    const root = createTestRoot(200, 100);
    root.render(<Harness seen={seen} disabled />);
    await settle(root);
    const dimmed = probe(root);
    expect(seen).toEqual([]);
    // opacity 0.5 over white: pure red would be (255,0,0); dimmed is not.
    expect(isRed(dimmed.right)).toBe(false);
    expect(dimmed.right.g).toBeGreaterThan(80);

    await tap(root);
    expect(seen).toEqual([]);
    root.unmount();
  });
});
