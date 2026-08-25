import { describe, expect, test } from 'vitest';
import * as React from 'react';
import { Image, Pressable, ScrollView, Text, View } from '../src/components/primitives';
import { asImpl, createTestRoot, writeSnapshot } from './helpers';

describe('paint', () => {
  test('card fixture: nested views, borderRadius, shadow, border', async () => {
    const root = createTestRoot(360, 240);
    root.render(
      <View style={{ flex: 1, backgroundColor: '#f2f2f7', padding: 24, justifyContent: 'center' }}>
        <View
          style={{
            backgroundColor: '#ffffff',
            borderRadius: 16,
            borderWidth: 1,
            borderColor: '#d1d1d6',
            padding: 16,
            shadowColor: '#000000',
            shadowOpacity: 0.15,
            shadowRadius: 12,
            shadowOffset: { width: 0, height: 4 },
            gap: 8,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#007aff' }} />
            <View style={{ gap: 3 }}>
              <Text style={{ fontSize: 16, fontWeight: '600' }}>Card title</Text>
              <Text style={{ fontSize: 13, color: '#8e8e93' }}>Subtitle text</Text>
            </View>
          </View>
          <Text style={{ fontSize: 14, color: '#3a3a3c' }}>
            Body copy rendered by Skia paragraphs with the real Yoga layout around it.
          </Text>
        </View>
      </View>
    );
    const png = await writeSnapshot(root, 'card');
    expect(png.length).toBeGreaterThan(2000);

    const impl = asImpl(root);
    // page background
    expect(impl.readPixel(5, 5)).toMatchObject({ r: 242, g: 242, b: 247 });
    // avatar circle center is the iOS blue — locate it from the layout tree
    const { findNode } = await import('./helpers');
    const avatarNode = findNode(root.getLayoutTree(), (n) => n.frame.width === 40 && n.frame.height === 40)!;
    const avatar = impl.readPixel(avatarNode.frame.x + 20, avatarNode.frame.y + 20);
    expect(avatar.b).toBeGreaterThan(200);
    expect(avatar.r).toBeLessThan(80);
    root.unmount();
  });

  test('text fixture: weights, sizes, ellipsis, spans, align', async () => {
    const root = createTestRoot(360, 300);
    root.render(
      <View style={{ flex: 1, backgroundColor: '#ffffff', padding: 16, gap: 8 }}>
        <Text style={{ fontSize: 24, fontWeight: '700' }}>Bold headline</Text>
        <Text style={{ fontSize: 16, fontWeight: '500', color: '#5856d6' }}>Medium purple</Text>
        <Text style={{ fontSize: 14 }}>
          Inline <Text style={{ fontWeight: '700' }}>bold span</Text> and{' '}
          <Text style={{ color: '#ff3b30', textDecorationLine: 'underline' }}>red underline</Text> inside.
        </Text>
        <Text numberOfLines={1} style={{ fontSize: 14, color: '#3a3a3c' }}>
          This very long line should be truncated with an ellipsis rather than wrapping to the next line.
        </Text>
        <Text style={{ fontSize: 14, textAlign: 'center', backgroundColor: '#f2f2f7' }}>centered</Text>
        <Text style={{ fontSize: 14, textAlign: 'right', backgroundColor: '#f2f2f7' }}>right</Text>
      </View>
    );
    const png = await writeSnapshot(root, 'text');
    expect(png.length).toBeGreaterThan(4000);
    root.unmount();
  });

  test('flex gallery fixture: row wrap, gaps, aspectRatio', async () => {
    const root = createTestRoot(360, 300);
    const colors = ['#ff9500', '#34c759', '#007aff', '#af52de', '#ff2d55', '#5ac8fa'];
    root.render(
      <View style={{ flex: 1, backgroundColor: '#1c1c1e', padding: 12 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          {colors.map((c) => (
            <View key={c} style={{ width: 104, aspectRatio: 1, backgroundColor: c, borderRadius: 12 }} />
          ))}
        </View>
      </View>
    );
    const png = await writeSnapshot(root, 'flex-gallery');
    expect(png.length).toBeGreaterThan(2000);
    const impl = asImpl(root);
    expect(impl.readPixel(12 + 52, 12 + 52).r).toBeGreaterThan(200); // orange tile
    expect(impl.readPixel(12 + 104 + 12 + 52, 12 + 52).g).toBeGreaterThan(150); // green tile
    root.unmount();
  });

  test('pressed-state fixture: function style renders pressed', async () => {
    const root = createTestRoot(200, 120);
    root.render(
      <View style={{ flex: 1, backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center' }}>
        <Pressable
          style={({ pressed }) => ({
            width: 140,
            height: 44,
            borderRadius: 10,
            backgroundColor: pressed ? '#004999' : '#007aff',
            alignItems: 'center',
            justifyContent: 'center',
          })}
        >
          {({ pressed }) => <Text style={{ color: '#ffffff', fontWeight: '600' }}>{pressed ? 'Pressed' : 'Press me'}</Text>}
        </Pressable>
      </View>
    );
    await root.flush();
    const impl = asImpl(root);
    // sample inside the button but left of the label glyphs
    const idle = impl.readPixel(45, 60);
    expect(idle.b).toBeGreaterThan(200);
    expect(idle.r).toBeLessThan(80);

    root.dispatchPointerEvent('down', { x: 100, y: 60 });
    const png = await writeSnapshot(root, 'pressed-state');
    expect(png.length).toBeGreaterThan(1000);
    const pressedPx = impl.readPixel(45, 60);
    expect(pressedPx.b).toBeLessThan(180); // darker pressed blue
    root.dispatchPointerEvent('up', { x: 100, y: 60 });
    root.unmount();
  });

  test('opacity, transform and overflow hidden compose', async () => {
    const root = createTestRoot(200, 200);
    root.render(
      <View style={{ flex: 1, backgroundColor: '#ffffff' }}>
        <View
          style={{
            width: 100,
            height: 100,
            margin: 50,
            backgroundColor: '#ff0000',
            opacity: 0.5,
            transform: [{ rotate: '45deg' }],
          }}
        />
      </View>
    );
    await root.flush();
    const impl = asImpl(root);
    const center = impl.readPixel(100, 100);
    // 50% red over white = pinkish
    expect(center.r).toBeGreaterThan(240);
    expect(center.g).toBeGreaterThan(100);
    expect(center.g).toBeLessThan(160);
    // corner of the original unrotated rect (55,55) should now be white (rotated away)
    const corner = impl.readPixel(52, 52);
    expect(corner.g).toBeGreaterThan(240);
    await writeSnapshot(root, 'transform-opacity');
    root.unmount();
  });

  test('scrollview paints clipped, offset content', async () => {
    const root = createTestRoot(200, 200);
    root.render(
      <ScrollView style={{ width: 200, height: 200, backgroundColor: '#ffffff' }}>
        <View style={{ width: 200, height: 150, backgroundColor: '#ff3b30' }} />
        <View style={{ width: 200, height: 150, backgroundColor: '#34c759' }} />
        <View style={{ width: 200, height: 150, backgroundColor: '#007aff' }} />
      </ScrollView>
    );
    await root.flush();
    const impl = asImpl(root);
    expect(impl.readPixel(100, 50).r).toBeGreaterThan(200); // red at top
    root.dispatchPointerEvent('wheel', { x: 100, y: 100, deltaY: 200 });
    await root.flush();
    // content y=250 at viewport y=50 → green band
    const px = impl.readPixel(100, 50);
    expect(px.g).toBeGreaterThan(150);
    expect(px.r).toBeLessThan(120);
    await writeSnapshot(root, 'scrollview');
    root.unmount();
  });

  test('image renders from a data uri', async () => {
    // build a genuine solid-red PNG with the renderer itself
    const fixtureRoot = createTestRoot(8, 8);
    fixtureRoot.render(<View style={{ flex: 1, backgroundColor: '#ff0000' }} />);
    const { snapshotPNG } = await import('../src/engine/renderer');
    const redBytes = await snapshotPNG(fixtureRoot);
    fixtureRoot.unmount();
    const redPng = `data:image/png;base64,${Buffer.from(redBytes).toString('base64')}`;
    const root = createTestRoot(120, 120);
    root.render(
      <View style={{ flex: 1, backgroundColor: '#ffffff', padding: 10 }}>
        <Image source={{ uri: redPng }} style={{ width: 100, height: 100, borderRadius: 8 }} />
      </View>
    );
    await root.flush();
    await root.flush(); // second flush after async decode settles
    const impl = asImpl(root);
    const px = impl.readPixel(60, 60);
    expect(px.r).toBeGreaterThan(200);
    expect(px.g).toBeLessThan(100);
    await writeSnapshot(root, 'image');
    root.unmount();
  });
});
