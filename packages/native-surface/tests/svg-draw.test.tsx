import { describe, expect, it } from 'vitest';
import * as React from 'react';
// @ts-expect-error jsdom ships no type declarations; runtime-only import that supplies DOMParser
import { JSDOM } from 'jsdom';
import { View } from '../src/components/primitives';
import Svg, {
  Circle,
  ClipPath,
  Defs,
  G,
  LinearGradient,
  Path,
  Rect,
  Stop,
  SvgXml,
  __compile,
  __compileXml,
} from '../../compat/src/svg';
import { asImpl, createTestRoot } from './helpers';

function onWhite(children: React.ReactNode): React.JSX.Element {
  return <View style={{ flex: 1, backgroundColor: '#ffffff' }}>{children}</View>;
}

const white = (p: { r: number; g: number; b: number }) => p.r > 250 && p.g > 250 && p.b > 250;

describe('svg draw ops', () => {
  it('paints a filled Rect and leaves the outside untouched', async () => {
    const root = createTestRoot(100, 100);
    const impl = asImpl(root);
    root.render(
      onWhite(
        <Svg width={100} height={100}>
          <Rect x={20} y={20} width={60} height={60} fill="#ff0000" />
        </Svg>
      )
    );
    await root.flush();
    const center = impl.readPixel(50, 50);
    expect(center.r).toBeGreaterThan(200);
    expect(center.g).toBeLessThan(50);
    expect(white(impl.readPixel(10, 10))).toBe(true);
    root.unmount();
  });

  it('fills a Path triangle; evenodd leaves the donut hole open', async () => {
    const root = createTestRoot(100, 100);
    const impl = asImpl(root);
    root.render(
      onWhite(
        <Svg width={100} height={100}>
          <Path d="M50 10 L90 90 L10 90 Z" fill="#0000ff" />
        </Svg>
      )
    );
    await root.flush();
    expect(impl.readPixel(50, 70).b).toBeGreaterThan(200);
    expect(white(impl.readPixel(10, 20))).toBe(true);

    // both subpaths wind the same way: nonzero fills the middle, evenodd doesn't
    const donut = 'M10 10 H90 V90 H10 Z M35 35 H65 V65 H35 Z';
    root.render(
      onWhite(
        <Svg width={100} height={100}>
          <Path d={donut} fill="#0000ff" fillRule="evenodd" />
        </Svg>
      )
    );
    await root.flush();
    expect(white(impl.readPixel(50, 50))).toBe(true);
    expect(impl.readPixel(20, 50).b).toBeGreaterThan(200);

    root.render(
      onWhite(
        <Svg width={100} height={100}>
          <Path d={donut} fill="#0000ff" />
        </Svg>
      )
    );
    await root.flush();
    expect(impl.readPixel(50, 50).b).toBeGreaterThan(200);
    root.unmount();
  });

  it('strokes a Circle without filling it', async () => {
    const root = createTestRoot(100, 100);
    const impl = asImpl(root);
    root.render(
      onWhite(
        <Svg width={100} height={100}>
          <Circle cx={50} cy={50} r={30} fill="none" stroke="#ff0000" strokeWidth={6} />
        </Svg>
      )
    );
    await root.flush();
    expect(white(impl.readPixel(50, 50))).toBe(true);
    const rim = impl.readPixel(50, 20); // on the stroke centerline
    expect(rim.r).toBeGreaterThan(200);
    expect(rim.g).toBeLessThan(50);
    root.unmount();
  });

  it('resolves fill="url(#…)" to a linear gradient', async () => {
    const root = createTestRoot(100, 100);
    const impl = asImpl(root);
    root.render(
      onWhite(
        <Svg width={100} height={100}>
          <Defs>
            <LinearGradient id="g1" x1="0%" y1="0%" x2="100%" y2="0%">
              <Stop offset={0} stopColor="#ff0000" />
              <Stop offset={1} stopColor="#0000ff" />
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width={100} height={100} fill="url(#g1)" />
        </Svg>
      )
    );
    await root.flush();
    const left = impl.readPixel(2, 50);
    const right = impl.readPixel(97, 50);
    expect(left.r).toBeGreaterThan(200);
    expect(left.b).toBeLessThan(80);
    expect(right.b).toBeGreaterThan(200);
    expect(right.r).toBeLessThan(80);
    root.unmount();
  });

  it('moves content with G transform="translate(…)"', async () => {
    const root = createTestRoot(100, 100);
    const impl = asImpl(root);
    root.render(
      onWhite(
        <Svg width={100} height={100}>
          <G transform="translate(30 0)">
            <Rect x={10} y={10} width={20} height={20} fill="#ff0000" />
          </G>
        </Svg>
      )
    );
    await root.flush();
    expect(impl.readPixel(50, 20).r).toBeGreaterThan(200); // translated position
    expect(white(impl.readPixel(15, 20))).toBe(true); // untranslated position
    root.unmount();
  });

  it('clips with clipPath="url(#…)"', async () => {
    const root = createTestRoot(100, 100);
    const impl = asImpl(root);
    root.render(
      onWhite(
        <Svg width={100} height={100}>
          <Defs>
            <ClipPath id="c1">
              <Rect x={0} y={0} width={50} height={100} />
            </ClipPath>
          </Defs>
          <Rect x={0} y={0} width={100} height={100} fill="#ff0000" clipPath="url(#c1)" />
        </Svg>
      )
    );
    await root.flush();
    expect(impl.readPixel(25, 50).r).toBeGreaterThan(200);
    expect(white(impl.readPixel(75, 50))).toBe(true);
    root.unmount();
  });

  it('scales viewBox units to the frame', async () => {
    const root = createTestRoot(100, 100);
    const impl = asImpl(root);
    root.render(
      onWhite(
        <Svg width={100} height={100} viewBox="0 0 10 10">
          <Rect x={4} y={4} width={2} height={2} fill="#ff0000" />
        </Svg>
      )
    );
    await root.flush();
    // 2×2 rect at (4,4) in a 10-unit viewBox → 20×20 px centered at (50,50)
    expect(impl.readPixel(50, 50).r).toBeGreaterThan(200);
    expect(white(impl.readPixel(30, 50))).toBe(true);
    expect(white(impl.readPixel(50, 30))).toBe(true);
    root.unmount();
  });

  it('repaints when only the compiled ops change', async () => {
    const root = createTestRoot(100, 100);
    const impl = asImpl(root);
    const app = (color: string) =>
      onWhite(
        <Svg width={100} height={100}>
          <Rect x={0} y={0} width={100} height={100} fill={color} />
        </Svg>
      );
    root.render(app('#ff0000'));
    await root.flush();
    expect(impl.readPixel(50, 50).r).toBeGreaterThan(200);
    root.render(app('#0000ff'));
    await root.flush();
    const after = impl.readPixel(50, 50);
    expect(after.b).toBeGreaterThan(200);
    expect(after.r).toBeLessThan(50);
    root.unmount();
  });

  it('resolves G inheritance into final leaf ops at compile time', () => {
    const ops = __compile(
      <G fill="#ff0000" strokeWidth={2}>
        <Rect x={0} y={0} width={10} height={10} />
        <Circle cx={5} cy={5} r={4} fill="#0000ff" />
      </G>
    );
    expect(ops).toEqual([
      { op: 'rect', x: 0, y: 0, width: 10, height: 10, fill: '#ff0000', strokeWidth: 2 },
      { op: 'circle', cx: 5, cy: 5, r: 4, fill: '#0000ff', strokeWidth: 2 },
    ]);
  });
});

describe('SvgXml', () => {
  const installDomParser = () => {
    const dom = new JSDOM('');
    globalThis.DOMParser = dom.window.DOMParser;
    return () => {
      delete (globalThis as { DOMParser?: unknown }).DOMParser;
    };
  };

  it('compiles xml through the same op pipeline', () => {
    const restore = installDomParser();
    try {
      const compiled = __compileXml(
        '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">' +
          '<circle cx="5" cy="5" r="4" fill="red" stroke-width="2"/></svg>'
      );
      expect(compiled).not.toBeNull();
      expect(compiled!.props.width).toBe('10');
      expect(compiled!.ops).toEqual([{ op: 'circle', cx: 5, cy: 5, r: 4, fill: 'red', strokeWidth: 2 }]);
    } finally {
      restore();
    }
  });

  it('renders parsed xml onto the canvas', async () => {
    const restore = installDomParser();
    try {
      const root = createTestRoot(100, 100);
      const impl = asImpl(root);
      root.render(
        onWhite(
          <SvgXml
            width={100}
            height={100}
            xml='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect x="2" y="2" width="6" height="6" fill="#ff0000"/></svg>'
          />
        )
      );
      await root.flush();
      expect(impl.readPixel(50, 50).r).toBeGreaterThan(200);
      expect(white(impl.readPixel(10, 10))).toBe(true);
      root.unmount();
    } finally {
      restore();
    }
  });
});
