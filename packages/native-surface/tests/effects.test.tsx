import { describe, expect, it } from 'vitest';
import * as React from 'react';
import { View } from '../src/components/primitives';
import { LinearGradient } from '../../compat/src/linear-gradient';
import { BlurView } from '../../compat/src/blur';
import MaskedView from '../../compat/src/masked-view';
import { asImpl, createTestRoot } from './helpers';

function onWhite(children: React.ReactNode): React.JSX.Element {
  return <View style={{ flex: 1, backgroundColor: '#ffffff' }}>{children}</View>;
}

const white = (p: { r: number; g: number; b: number }) => p.r > 250 && p.g > 250 && p.b > 250;

describe('linear gradient', () => {
  it('paints a default vertical gradient and respects locations', async () => {
    const root = createTestRoot(100, 100);
    const impl = asImpl(root);
    root.render(onWhite(<LinearGradient colors={['#ff0000', '#0000ff']} style={{ flex: 1 }} />));
    await root.flush();
    const top = impl.readPixel(50, 2);
    const mid = impl.readPixel(50, 50);
    const bottom = impl.readPixel(50, 97);
    expect(top.r).toBeGreaterThan(240);
    expect(top.b).toBeLessThan(30);
    expect(bottom.b).toBeGreaterThan(240);
    expect(bottom.r).toBeLessThan(30);
    // midpoint of an even red→blue ramp mixes both
    expect(mid.r).toBeGreaterThan(80);
    expect(mid.r).toBeLessThan(180);
    expect(mid.b).toBeGreaterThan(80);
    expect(mid.b).toBeLessThan(180);

    // locations compress the ramp: past 0.2 it is fully blue
    root.render(
      onWhite(<LinearGradient colors={['#ff0000', '#0000ff']} locations={[0, 0.2]} style={{ flex: 1 }} />)
    );
    await root.flush();
    const past = impl.readPixel(50, 60);
    expect(past.b).toBeGreaterThan(240);
    expect(past.r).toBeLessThan(20);
    root.unmount();
  });

  it('runs horizontally via start/end and via useAngle', async () => {
    const root = createTestRoot(100, 100);
    const impl = asImpl(root);
    root.render(
      onWhite(
        <LinearGradient
          colors={['#ff0000', '#0000ff']}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={{ flex: 1 }}
        />
      )
    );
    await root.flush();
    expect(impl.readPixel(2, 50).r).toBeGreaterThan(240);
    expect(impl.readPixel(2, 50).b).toBeLessThan(30);
    expect(impl.readPixel(97, 50).b).toBeGreaterThan(240);
    expect(impl.readPixel(97, 50).r).toBeLessThan(30);

    // angle 90 = clockwise from up = left→right; the angle line spans √2 box
    // units, so corners are strong mixes rather than pure endpoints
    root.render(
      onWhite(<LinearGradient colors={['#ff0000', '#0000ff']} useAngle angle={90} style={{ flex: 1 }} />)
    );
    await root.flush();
    const left = impl.readPixel(3, 50);
    const right = impl.readPixel(96, 50);
    expect(left.r).toBeGreaterThan(180);
    expect(left.b).toBeLessThan(100);
    expect(right.b).toBeGreaterThan(180);
    expect(right.r).toBeLessThan(100);
    root.unmount();
  });

  it('respects borderRadius (corner outside the rrect stays unpainted)', async () => {
    const root = createTestRoot(100, 100);
    const impl = asImpl(root);
    root.render(
      onWhite(
        <LinearGradient colors={['#ff0000', '#0000ff']} style={{ flex: 1, borderRadius: 40 }} />
      )
    );
    await root.flush();
    // (3,3) is ~52px from the corner arc center (40,40) — outside radius 40
    expect(white(impl.readPixel(3, 3))).toBe(true);
    // top center is inside and near the red end
    expect(impl.readPixel(50, 3).r).toBeGreaterThan(240);
    root.unmount();
  });

  it('repaints when only the gradient colors change', async () => {
    const root = createTestRoot(100, 100);
    const impl = asImpl(root);
    const app = (colors: string[]) => onWhite(<LinearGradient colors={colors} style={{ flex: 1 }} />);
    root.render(app(['#ff0000', '#ff0000']));
    await root.flush();
    expect(impl.readPixel(50, 50).r).toBeGreaterThan(240);
    root.render(app(['#00ff00', '#00ff00']));
    await root.flush();
    const after = impl.readPixel(50, 50);
    expect(after.g).toBeGreaterThan(240);
    expect(after.r).toBeLessThan(30);
    root.unmount();
  });
});

describe('masked view', () => {
  it('gates content by the mask alpha (opaque half shows, transparent half hides)', async () => {
    const root = createTestRoot(100, 100);
    const impl = asImpl(root);
    root.render(
      onWhite(
        <MaskedView
          style={{ flex: 1 }}
          maskElement={<View style={{ width: 50, height: 100, backgroundColor: '#000000' }} />}
        >
          <View style={{ flex: 1, backgroundColor: '#ff0000' }} />
        </MaskedView>
      )
    );
    await root.flush();
    const shown = impl.readPixel(25, 50);
    expect(shown.r).toBeGreaterThan(240);
    expect(shown.g).toBeLessThan(30);
    // outside the mask the content is fully clipped: the white root shows
    expect(white(impl.readPixel(75, 50))).toBe(true);
    root.unmount();
  });
});

describe('backdrop blur', () => {
  it('blurs the scene behind the node (backdrop saveLayer path)', async () => {
    const scene = (blur: boolean) =>
      onWhite(
        <>
          <View style={{ position: 'absolute', left: 0, top: 0, width: 50, height: 100, backgroundColor: '#ff0000' }} />
          {blur ? (
            <BlurView
              intensity={60}
              tint="default"
              style={{ position: 'absolute', left: 25, top: 25, width: 50, height: 50 }}
            />
          ) : null}
        </>
      );

    const root = createTestRoot(100, 100);
    const impl = asImpl(root);
    root.render(scene(false));
    await root.flush();
    // baseline: just right of the red/white boundary is pure white
    expect(white(impl.readPixel(60, 50))).toBe(true);

    root.render(scene(true));
    await root.flush();
    // under the blur, red bleeds across the boundary — a tint-only fallback
    // (white wash) could never pull green/blue down here
    const bled = impl.readPixel(60, 50);
    expect(bled.g).toBeLessThan(230);
    expect(bled.b).toBeLessThan(230);
    expect(bled.r).toBeGreaterThan(230);
    // outside the blur rect the boundary stays crisp
    expect(white(impl.readPixel(60, 10))).toBe(true);
    root.unmount();
  });

  it('applies the tint overlay (dark tint darkens a white backdrop)', async () => {
    const root = createTestRoot(100, 100);
    const impl = asImpl(root);
    root.render(onWhite(<BlurView intensity={100} tint="dark" style={{ flex: 1 }} />));
    await root.flush();
    // blurred white stays white; black @ 0.45 lands the value mid-gray
    const tinted = impl.readPixel(50, 50);
    expect(tinted.r).toBeLessThan(200);
    expect(tinted.r).toBeGreaterThan(80);
    expect(Math.abs(tinted.r - tinted.b)).toBeLessThan(10);
    root.unmount();
  });

  it('maps community blurType/blurAmount onto the expo channel', async () => {
    const root = createTestRoot(100, 100);
    const impl = asImpl(root);
    root.render(onWhite(<BlurView blurType="dark" blurAmount={100} style={{ flex: 1 }} />));
    await root.flush();
    expect(impl.readPixel(50, 50).r).toBeLessThan(200);
    root.unmount();
  });
});
