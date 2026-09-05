/**
 * Regression tests for the review fix pass (an independent adversarial review +
 * embed-demo/playground ENGINE-ISSUES). Each test names the finding it pins.
 */
import * as React from 'react';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { Image, Pressable, ScrollView, Text, View } from '../src/components/primitives';
import { StyleSheet } from '../src/api/StyleSheet';
import { parseColor } from '../src/engine/colors';
import { getEngine, initEngine } from '../src/engine/init';
import { asImpl, createTestRoot, findNode, sleep } from './helpers';

describe('fixes: StyleSheet.hairlineWidth', () => {
  // Declared first in this file: the first root created here is the primary.
  it('is 1/dpr of the primary root and follows primary promotion', async () => {
    const a = createTestRoot(60, 40, { dpr: 4 });
    a.render(<View style={{ flex: 1 }} />);
    await a.flush();
    expect(StyleSheet.hairlineWidth).toBe(0.25);

    const b = createTestRoot(60, 40, { dpr: 1 });
    b.render(<View style={{ flex: 1 }} />);
    await b.flush();
    expect(StyleSheet.hairlineWidth).toBe(0.25); // primary unchanged while A lives

    a.unmount();
    expect(StyleSheet.hairlineWidth).toBe(1); // B promoted
    b.unmount();
  });
});

describe('fixes: pointer pipeline', () => {
  it('pointercancel cancels without synthesizing onPress', async () => {
    const onPress = vi.fn();
    const onPressOut = vi.fn();
    const root = createTestRoot(100, 100);
    root.render(
      <Pressable onPress={onPress} onPressOut={onPressOut} style={{ width: 80, height: 80 }} />
    );
    await root.flush();
    root.dispatchPointerEvent('down', { x: 40, y: 40 });
    root.dispatchPointerEvent('cancel', { x: 40, y: 40 });
    root.dispatchPointerEvent('up', { x: 40, y: 40 });
    expect(onPress).not.toHaveBeenCalled();
    expect(onPressOut).toHaveBeenCalledTimes(1);
    root.unmount();
  });

  it('moving over a higher-zIndex sibling does not cancel the press', async () => {
    const onPress = vi.fn();
    const root = createTestRoot(200, 100);
    root.render(
      <View style={{ flexDirection: 'row' }}>
        <Pressable onPress={onPress} style={{ width: 120, height: 80 }} testID="target" />
        <View
          style={{ position: 'absolute', left: 60, top: 0, width: 60, height: 80, zIndex: 10 }}
        />
      </View>
    );
    await root.flush();
    root.dispatchPointerEvent('down', { x: 30, y: 40 }); // uncovered part of the pressable
    root.dispatchPointerEvent('move', { x: 90, y: 40 }); // covered by the z-10 sibling, still inside pressable
    root.dispatchPointerEvent('up', { x: 90, y: 40 });
    expect(onPress).toHaveBeenCalledTimes(1);
    root.unmount();
  });

  it('press bubbles to a non-clipping parent from a child outside its bounds', async () => {
    const onPress = vi.fn();
    const root = createTestRoot(200, 200);
    root.render(
      <View style={{ paddingTop: 100 }}>
        <Pressable onPress={onPress} style={{ width: 100, height: 40 }}>
          <View style={{ position: 'absolute', top: -60, left: 0, width: 100, height: 40 }} />
        </Pressable>
      </View>
    );
    await root.flush();
    // The child sits above the pressable's own rect; tapping it must still press.
    root.dispatchPointerEvent('down', { x: 50, y: 60 });
    root.dispatchPointerEvent('up', { x: 50, y: 60 });
    expect(onPress).toHaveBeenCalledTimes(1);
    root.unmount();
  });

  it('a disabled Pressable overlay blocks the one underneath; a wrapping Pressable still receives', async () => {
    const under = vi.fn();
    const outer = vi.fn();
    const root = createTestRoot(120, 120);
    root.render(
      <Pressable onPress={outer} style={{ width: 120, height: 120 }}>
        <Pressable onPress={under} style={{ width: 100, height: 100 }} />
        <Pressable
          disabled
          onPress={() => {}}
          style={{ position: 'absolute', top: 0, left: 0, width: 100, height: 100 }}
        />
      </Pressable>
    );
    await root.flush();
    root.dispatchPointerEvent('down', { x: 50, y: 50 });
    root.dispatchPointerEvent('up', { x: 50, y: 50 });
    // Topmost chain is the disabled overlay: the sibling underneath cannot fire;
    // the enabled ancestor takes the press (RN responder bubbling).
    expect(under).not.toHaveBeenCalled();
    expect(outer).toHaveBeenCalledTimes(1);
    root.unmount();
  });

  it('onScroll fires only when the offset actually changes (review nit)', async () => {
    const onScroll = vi.fn();
    const root = createTestRoot(100, 100);
    root.render(
      <ScrollView onScroll={onScroll} style={{ width: 100, height: 100 }}>
        <View style={{ width: 100, height: 300 }} />
      </ScrollView>
    );
    await root.flush();
    root.dispatchPointerEvent('wheel', { x: 50, y: 50, deltaY: -50 }); // already at top: clamped, no change
    expect(onScroll).not.toHaveBeenCalled();
    root.dispatchPointerEvent('wheel', { x: 50, y: 50, deltaY: 50 });
    expect(onScroll).toHaveBeenCalledTimes(1);
    root.unmount();
  });
});

describe('fixes: hidden instances', () => {
  it('a hidden node neither paints nor hits', async () => {
    const onPress = vi.fn();
    const root = createTestRoot(60, 60);
    root.render(
      <Pressable onPress={onPress} style={{ width: 60, height: 60, backgroundColor: '#ff0000' }} />
    );
    await root.flush();
    expect(asImpl(root).readPixel(30, 30).r).toBeGreaterThan(200);

    const node = asImpl(root).rootNode.children[0]!;
    node.hidden = true; // what hideInstance sets (Suspense/Activity hide)
    node.markDirty();
    await root.flush();
    expect(asImpl(root).readPixel(30, 30).a).toBe(0);
    root.dispatchPointerEvent('down', { x: 30, y: 30 });
    root.dispatchPointerEvent('up', { x: 30, y: 30 });
    expect(onPress).not.toHaveBeenCalled();
    root.unmount();
  });
});

describe('fixes: images', () => {
  async function makeDataUri(w: number, h: number): Promise<string> {
    const src = createTestRoot(w, h);
    src.render(<View style={{ width: w, height: h, backgroundColor: '#3366ff' }} />);
    await src.flush();
    const png = asImpl(src).encodePNG();
    src.unmount();
    return `data:image/png;base64,${Buffer.from(png).toString('base64')}`;
  }

  it('an Image with no style sizes to the decoded bitmap (intrinsic measure)', async () => {
    const uri = await makeDataUri(24, 16);
    const root = createTestRoot(200, 200);
    root.render(
      <View style={{ alignItems: 'flex-start' }}>
        <Image source={{ uri }} />
      </View>
    );
    await root.flush();
    await sleep(20); // decode settles
    await root.flush();
    const img = findNode(root.getLayoutTree(), (n) => n.type === 'Image');
    expect(img?.frame.width).toBe(24);
    expect(img?.frame.height).toBe(16);
    root.unmount();
  });

  it('a cache-hit Image still fires onLoad', async () => {
    const uri = await makeDataUri(8, 8);
    const first = createTestRoot(50, 50);
    const firstLoad = vi.fn();
    first.render(<Image source={{ uri }} onLoad={firstLoad} style={{ width: 8, height: 8 }} />);
    await first.flush();
    await sleep(20);
    expect(firstLoad).toHaveBeenCalledTimes(1);

    const second = createTestRoot(50, 50);
    const secondLoad = vi.fn();
    second.render(<Image source={{ uri }} onLoad={secondLoad} style={{ width: 8, height: 8 }} />);
    await second.flush();
    await sleep(20);
    expect(secondLoad).toHaveBeenCalledTimes(1); // was: never, on cache hits
    first.unmount();
    second.unmount();
  });
});

describe('fixes: text measurement', () => {
  it('empty Text gets one line box, not zero height', async () => {
    const root = createTestRoot(200, 100);
    root.render(
      <View style={{ alignItems: 'flex-start' }}>
        <Text testID="empty">{''}</Text>
      </View>
    );
    await root.flush();
    const t = findNode(root.getLayoutTree(), (n) => n.type === 'Text');
    expect(t?.frame.height).toBeGreaterThan(10); // ~one 14px Inter line
    root.unmount();
  });

  it('a zero-width constraint is honored, not treated as unconstrained', async () => {
    const root = createTestRoot(200, 400);
    root.render(
      <View style={{ width: 0, alignItems: 'flex-start' }}>
        <Text>Hello</Text>
      </View>
    );
    await root.flush();
    const t = findNode(root.getLayoutTree(), (n) => n.type === 'Text');
    expect(t?.frame.width).toBe(0);
    // wrapping at 0 stacks per glyph: taller than one line proves the
    // constraint reached the paragraph instead of the 100k px fallback
    expect(t?.frame.height).toBeGreaterThan(30);
    root.unmount();
  });
});

describe('fixes: scroll indicator + theme', () => {
  it('showsVerticalScrollIndicator={false} paints no bar', async () => {
    const root = createTestRoot(100, 100);
    root.render(
      <ScrollView
        showsVerticalScrollIndicator={false}
        style={{ width: 100, height: 100, backgroundColor: '#ffffff' }}
      >
        <View style={{ width: 100, height: 300 }} />
      </ScrollView>
    );
    await root.flush();
    root.dispatchPointerEvent('wheel', { x: 50, y: 50, deltaY: 60 });
    await root.flush();
    const px = asImpl(root).readPixel(96.5, 30); // indicator strip
    expect(px.r).toBeGreaterThan(240); // still the white background
    root.unmount();
  });

  it('elevation shadows paint only under the android theme, and setTheme is live', async () => {
    const root = createTestRoot(120, 120, { theme: 'ios' });
    root.render(
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: 60, height: 60, backgroundColor: '#ffffff', elevation: 8 }} />
      </View>
    );
    await root.flush();
    const below = () => asImpl(root).readPixel(60, 95); // just below the box, where the blur lands
    expect(below().a).toBe(0); // iOS RN ignores elevation

    root.setTheme('android');
    await root.flush();
    expect(below().a).toBeGreaterThan(0);
    root.unmount();
  });
});

describe('fixes: root lifecycle', () => {
  it('render() after unmount throws instead of rebuilding fibers', async () => {
    const root = createTestRoot(50, 50);
    root.render(<View style={{ flex: 1 }} />);
    await root.flush();
    root.unmount();
    expect(() => root.render(<View />)).toThrow(/unmounted root/);
  });

  it('unmount runs useEffect cleanups in the canvas tree', async () => {
    const cleanup = vi.fn();
    function Probe(): React.JSX.Element {
      React.useEffect(() => cleanup, []);
      return <View style={{ flex: 1 }} />;
    }
    const root = createTestRoot(50, 50);
    root.render(<Probe />);
    await root.flush();
    expect(cleanup).not.toHaveBeenCalled();
    root.unmount();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});

describe('fixes: color parsing', () => {
  it('parses modern space/percentage syntaxes', () => {
    expect(parseColor('hsl(120 50% 50%)')).toEqual(parseColor('hsl(120, 50%, 50%)'));
    expect(parseColor('hsl(120 50% 50% / 50%)')?.a).toBeCloseTo(0.5);
    expect(parseColor('rgb(100%, 0%, 50%)')).toEqual({ r: 255, g: 0, b: 128, a: 1 });
    expect(parseColor('rgb(255 0 128 / 0.5)')).toEqual({ r: 255, g: 0, b: 128, a: 0.5 });
  });

  it('parseColor(plum) is a real colour, not transparent', () => {
    const c = parseColor('plum');
    expect(c).not.toBeNull();
    expect(c!.a).toBe(1);
    expect(c).toEqual({ r: 0xdd, g: 0xa0, b: 0xdd, a: 1 });
  });
});

describe('fixes: position fixed', () => {
  it('pins left/bottom to the surface, not in-flow relative', async () => {
    const root = createTestRoot(200, 200);
    root.render(
      <View style={{ marginTop: 80, marginLeft: 80, width: 40, height: 40 }}>
        <View
          testID="fab"
          style={{ position: 'fixed', left: 10, bottom: 10, width: 20, height: 20, backgroundColor: '#ff0000' }}
        />
      </View>
    );
    await root.flush();
    const fab = findNode(root.getLayoutTree(), (n) => n.testID === 'fab');
    expect(fab?.frame).toMatchObject({ x: 10, y: 170, width: 20, height: 20 });
    expect(asImpl(root).readPixel(15, 175).r).toBeGreaterThan(200);
    root.unmount();
  });
});

describe('fixes: colour-emoji fallback', () => {
  it('initEngine({fonts}) adds the family to the paragraph fallback list', async () => {
    const root = createTestRoot(20, 20);
    root.render(<View />);
    await root.flush();
    const buf = fs.readFileSync(fileURLToPath(new URL('../assets/fonts/Inter-Regular.otf', import.meta.url)));
    await initEngine({
      fonts: [
        {
          family: 'Noto Color Emoji',
          data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        },
      ],
    });
    expect(getEngine().families.has('Noto Color Emoji')).toBe(true);
    root.unmount();
  });
});

describe('fixes: horizontal ScrollView', () => {
  it('places flex+width children along the main axis', async () => {
    const root = createTestRoot(400, 120);
    root.render(
      <ScrollView horizontal style={{ width: 400, height: 100 }}>
        {[0, 1, 2].map((i) => (
          <View key={i} testID={`card${i}`} style={{ flex: 1, width: 165, height: 80 }} />
        ))}
      </ScrollView>
    );
    await root.flush();
    const xs = [0, 1, 2].map((i) => findNode(root.getLayoutTree(), (n) => n.testID === `card${i}`)?.frame.x);
    expect(xs[0]).not.toBe(xs[1]);
    expect(xs[1]).not.toBe(xs[2]);
    expect(xs[0]!).toBeLessThan(xs[1]!);
    expect(xs[1]!).toBeLessThan(xs[2]!);
    root.unmount();
  });
});
