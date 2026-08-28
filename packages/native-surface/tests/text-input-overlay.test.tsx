// @vitest-environment jsdom
/**
 * The focused-TextInput DOM overlay (engine/textInputOverlay) — the third
 * consumer of engine/canvasGeometry, and until now the only one with no DOM
 * coverage at all: tests/textinput.test.tsx runs under Node, where the overlay
 * factory returns null before it computes anything.
 *
 * The canvas here is both offset on the page and CSS-stretched 2x, because
 * that is the configuration where the geometry rule actually matters. The
 * overlay has to scale its *type* by the same factors as its box — a 2x box
 * with 1x text would not sit on top of the Skia text it replaces.
 */
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/env/index', async () => (await import('./nodeEnvMock')).nodeEnvMock());

import { TextInput, View } from '../src/index';
import type { TextInputRef } from '../src/components/TextInputImpl';
import type { NativeRoot } from '../src/types';
import { asImpl, createTestRoot } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** A canvas offset on the page and stretched 2x over its logical surface. */
function withStretchedHost(root: NativeRoot, cssWidth: number, cssHeight: number): void {
  const canvas = document.createElement('canvas');
  canvas.getBoundingClientRect = () =>
    ({
      x: 17,
      y: 9,
      left: 17,
      top: 9,
      right: 17 + cssWidth * 2,
      bottom: 9 + cssHeight * 2,
      width: cssWidth * 2,
      height: cssHeight * 2,
      toJSON: () => ({}),
    }) as DOMRect;
  (asImpl(root) as any).getInputHost = () => ({ canvas, cssWidth, cssHeight });
}

let root: NativeRoot | null = null;

afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = '';
});

describe('focused TextInput overlay', () => {
  it('places the input over the node and scales its type by the same factors', async () => {
    root = createTestRoot(300, 200);
    withStretchedHost(root, 300, 200);
    const handle = React.createRef<TextInputRef>();

    root.render(
      <View style={{ padding: 20 }}>
        <TextInput
          ref={handle}
          value="hi"
          style={{ width: 100, height: 40, padding: 8, fontSize: 12, letterSpacing: 2 }}
        />
      </View>
    );
    await root.flush();

    handle.current!.focus();
    const el = document.querySelector('input')!;
    expect(el).toBeTruthy();
    expect(el.style.position).toBe('fixed');

    // Box: canvas origin + node frame * stretch.
    expect(el.style.left).toBe('57px'); // 17 + 20 * 2
    expect(el.style.top).toBe('49px'); // 9 + 20 * 2
    expect(el.style.width).toBe('200px'); // 100 * 2
    expect(el.style.height).toBe('80px'); // 40 * 2

    // Type and padding come off the SAME scale factors, not a second pass.
    expect(el.style.paddingLeft).toBe('16px'); // padding 8 * 2
    expect(el.style.paddingRight).toBe('16px');
    expect(el.style.fontSize).toBe('24px'); // fontSize 12 * 2
    expect(el.style.letterSpacing).toBe('4px'); // letterSpacing 2 * 2
    // Single-line text is centred by line-height over the padded box.
    expect(el.style.lineHeight).toBe('48px'); // 80 - (8 + 8) * 2
    expect(el.style.paddingTop).toBe('0px');
    expect(el.style.paddingBottom).toBe('0px');

    expect(el.value).toBe('hi');
  });

  it('tracks re-layout through the flush, and removes the element on blur', async () => {
    root = createTestRoot(300, 200);
    withStretchedHost(root, 300, 200);
    const handle = React.createRef<TextInputRef>();
    const app = (padding: number) => (
      <View style={{ padding }}>
        <TextInput ref={handle} value="x" style={{ width: 100, height: 40 }} />
      </View>
    );

    root.render(app(20));
    await root.flush();
    handle.current!.focus();
    const el = document.querySelector('input')!;
    expect(el.style.left).toBe('57px');

    // syncFocusedOverlay runs after every flush and repositions the live element.
    root.render(app(50));
    await root.flush();
    expect(document.querySelector('input')).toBe(el);
    expect(el.style.left).toBe('117px'); // 17 + 50 * 2
    expect(el.style.top).toBe('109px'); // 9 + 50 * 2

    handle.current!.blur();
    expect(document.querySelector('input')).toBeNull();
  });

  it('is inert when the canvas has no on-screen box', async () => {
    root = createTestRoot(300, 200);
    const canvas = document.createElement('canvas');
    // Not laid out yet (display:none, or before first paint).
    canvas.getBoundingClientRect = () =>
      ({ x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect;
    (asImpl(root) as any).getInputHost = () => ({ canvas, cssWidth: 300, cssHeight: 200 });

    const handle = React.createRef<TextInputRef>();
    root.render(<TextInput ref={handle} value="x" style={{ width: 100, height: 40 }} />);
    await root.flush();

    // The element is still created (focus state is real); it simply holds the
    // placement it had rather than collapsing onto 0,0.
    expect(() => handle.current!.focus()).not.toThrow();
    const el = document.querySelector('input')!;
    expect(el.style.left).toBe('');
  });
});
