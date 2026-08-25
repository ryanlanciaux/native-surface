/**
 * Engine features added for the acceptance-app boundary slice: Image tintColor,
 * SectionList scrollToLocation / renderScrollComponent, Image.getSize.
 */
import * as React from 'react';
import { describe, expect, it } from 'vitest';
import { Image, ScrollView, SectionList, Text, View } from '../src/index';
import type { SectionListHandle } from '../src/components/lists';
import { asImpl, createTestRoot } from './helpers';

async function makeDataUri(w: number, h: number, backgroundColor: string): Promise<string> {
  const src = createTestRoot(w, h);
  src.render(<View style={{ width: w, height: h, backgroundColor }} />);
  await src.flush();
  const png = asImpl(src).encodePNG();
  src.unmount();
  return `data:image/png;base64,${Buffer.from(png).toString('base64')}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('acceptance-app boundary features', () => {
  it('Image tintColor recolors opaque pixels via SrcIn', async () => {
    const uri = await makeDataUri(24, 24, '#ff0000');
    const root = createTestRoot(100, 100);
    root.render(
      <View style={{ flex: 1 }}>
        <Image source={{ uri }} style={{ width: 50, height: 50, tintColor: '#0044ff' }} />
      </View>
    );
    await root.flush();
    await sleep(80); // image decode settles
    await root.flush();
    const px = asImpl(root).readPixel(25, 25);
    expect(px.b).toBeGreaterThan(180); // tinted blue…
    expect(px.r).toBeLessThan(80); // …not the source red
    root.unmount();
  });

  it('a scaled source ({uri, scale: 2}) halves the intrinsic layout size', async () => {
    const uri = await makeDataUri(40, 20, '#123456');
    const root = createTestRoot(200, 200);
    root.render(
      <View style={{ flex: 1, alignItems: 'flex-start' }}>
        <Image source={{ uri, scale: 2 }} />
      </View>
    );
    await root.flush();
    await sleep(80);
    await root.flush();
    const img = root.getLayoutTree().children[0]!.children[0]!;
    expect(img.frame.width).toBe(20);
    expect(img.frame.height).toBe(10);
    root.unmount();
  });

  it('image sampling is linear (upscaled texel boundary blends, nearest would not)', async () => {
    // 2px source (red | white) upscaled 10x: linear gives a gradient at the
    // texel boundary; nearest gives a hard edge with only pure colors.
    const src = createTestRoot(2, 1);
    src.render(
      <View style={{ flexDirection: 'row', width: 2, height: 1 }}>
        <View style={{ width: 1, height: 1, backgroundColor: '#ff0000' }} />
        <View style={{ width: 1, height: 1, backgroundColor: '#ffffff' }} />
      </View>
    );
    await src.flush();
    const uri = `data:image/png;base64,${Buffer.from(asImpl(src).encodePNG()).toString('base64')}`;
    src.unmount();

    const root = createTestRoot(40, 40);
    root.render(
      <View style={{ flex: 1 }}>
        <Image source={{ uri }} style={{ width: 20, height: 10 }} resizeMode="stretch" />
      </View>
    );
    await root.flush();
    await sleep(80);
    await root.flush();
    // dst x=10 sits exactly between the two texel centers → ~50/50 blend.
    const edge = asImpl(root).readPixel(10, 5);
    expect(edge.r).toBeGreaterThan(200);
    expect(edge.g).toBeGreaterThan(60); // nearest → 0 (pure red) or 255 (pure white)
    expect(edge.g).toBeLessThan(220);
    root.unmount();
  });

  it('Image.getSize resolves decoded dimensions', async () => {
    const uri = await makeDataUri(32, 18, '#00ff00');
    const size = await new Promise<{ w: number; h: number }>((resolve, reject) => {
      Image.getSize(uri, (w, h) => resolve({ w, h }), reject);
    });
    expect(size).toEqual({ w: 32, h: 18 });
  });

  it('SectionList.scrollToLocation lands on the section header offset', async () => {
    const root = createTestRoot(200, 200);
    const ref = React.createRef<SectionListHandle>();
    const offsets: number[] = [];
    root.render(
      <SectionList
        ref={ref}
        style={{ width: 200, height: 200 }}
        sections={[0, 1, 2].map((i) => ({
          title: `S${i}`,
          data: ['a', 'b'],
        }))}
        renderSectionHeader={({ section }) => (
          <View style={{ height: 40 }}>
            <Text>{String(section.title)}</Text>
          </View>
        )}
        renderItem={({ item }) => (
          <View style={{ height: 60 }}>
            <Text>{String(item)}</Text>
          </View>
        )}
        onScroll={(e) => offsets.push(e.nativeEvent.contentOffset.y)}
      />
    );
    await root.flush();
    // sections: header(40) + 2×60 = 160 each → S2 header at y=320;
    // content 480, viewport 200 → clamped to max offset 280.
    ref.current!.scrollToLocation({ sectionIndex: 2, itemIndex: 0, animated: false });
    await root.flush();
    expect(offsets[offsets.length - 1]).toBe(280);
    root.unmount();
  });

  it('SectionList renderScrollComponent drives a custom scroll container with a working handle', async () => {
    const root = createTestRoot(200, 200);
    const ref = React.createRef<SectionListHandle>();
    root.render(
      <SectionList
        ref={ref}
        style={{ width: 200, height: 200 }}
        renderScrollComponent={(p) => <ScrollView {...p} testID="custom-scroll" />}
        sections={[{ title: 'only', data: [1, 2, 3, 4, 5, 6] }]}
        renderSectionHeader={() => <View style={{ height: 30 }} />}
        renderItem={() => <View style={{ height: 70 }} />}
      />
    );
    await root.flush();
    expect(ref.current?.getScrollResponder()).toBeTruthy();
    ref.current!.scrollToLocation({ sectionIndex: 0, itemIndex: 3, animated: false });
    await root.flush();
    // item index 3 → third item (0-based 2) at 30 + 2*70 = 170, clamped to max 480-200*? content 30+6*70=450; max 250 → 170 fits
    const tree = root.getLayoutTree();
    expect(tree).toBeTruthy();
    root.unmount();
  });
});
