import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { Text, View } from '../src/components/primitives';
import { initEngine } from '../src/engine/init';
import { loadAsync, isLoaded } from '../../compat/src/expo';
import SubpathIcon, { createIconSet } from '../../compat/src/vector-icons';
import { asImpl, createTestRoot, findNode, sleep } from './helpers';
import type { NativeRoot } from '../src/types';

/**
 * Seam test for @expo/vector-icons: its Icon components call expo-font's
 * loadAsync AFTER the engine is already running, then render a <Text> whose
 * fontFamily is the icon family and whose content is a PUA glyph. This pins
 * that seam: post-init registration through the compat expo shim must make a
 * brand-new family paint with the registered typeface.
 */

function fontBytes(file: string): ArrayBuffer {
  const buf = fs.readFileSync(fileURLToPath(new URL(`../assets/fonts/${file}`, import.meta.url)));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

/** Count pixels inside the first Text node's frame that differ from white. */
async function paintedPixelsInTextFrame(root: NativeRoot): Promise<number> {
  await root.flush();
  const impl = asImpl(root);
  const node = findNode(root.getLayoutTree(), (n) => n.type === 'Text')!;
  expect(node).toBeTruthy();
  let painted = 0;
  for (let y = Math.ceil(node.frame.y); y < node.frame.y + node.frame.height; y += 1) {
    for (let x = Math.ceil(node.frame.x); x < node.frame.x + node.frame.width; x += 1) {
      const px = impl.readPixel(x, y);
      if (px.r < 250 || px.g < 250 || px.b < 250) painted++;
    }
  }
  return painted;
}

function renderText(family: string, content: string): NativeRoot {
  const root = createTestRoot(300, 100);
  root.render(
    <View style={{ flex: 1, backgroundColor: '#ffffff', alignItems: 'flex-start' }}>
      <Text style={{ fontFamily: family, fontSize: 40, color: '#000000' }}>{content}</Text>
    </View>
  );
  return root;
}

describe('vector-icons font seam (post-init registration via compat expo shim)', () => {
  it('a family registered after init paints with the registered typeface, not the fallback', async () => {
    // Engine up first, THEN register — the @expo/vector-icons ordering.
    await initEngine();
    // Inter-Bold bytes under a fresh name: heavier coverage than the Inter
    // Regular fallback proves the registered typeface was actually selected.
    await loadAsync({ 'FakeIcons-Seam': fontBytes('Inter-Bold.otf') });
    expect(isLoaded('FakeIcons-Seam')).toBe(true);

    const bold = renderText('FakeIcons-Seam', 'AAAA');
    const paintedBold = await paintedPixelsInTextFrame(bold);
    expect(paintedBold).toBeGreaterThan(50); // glyphs painted at all

    const fallback = renderText('Family-Never-Registered', 'AAAA');
    const paintedFallback = await paintedPixelsInTextFrame(fallback);
    // Missing family: the paragraph's family stack is [family, 'Inter'], so
    // unknown families fall back to Inter Regular — text still paints.
    expect(paintedFallback).toBeGreaterThan(50);
    // Bold coverage strictly exceeds the regular fallback's: the new family
    // resolved to the registered bytes, not the fallback.
    expect(paintedBold).toBeGreaterThan(paintedFallback * 1.1);

    bold.unmount();
    fallback.unmount();
  });

  it('loadAsync(family, url-less source) is a no-op, not a crash', async () => {
    await loadAsync({ Broken: {} as never });
    expect(isLoaded('Broken')).toBe(false);
  });

  it('documents fallback for icon-style PUA glyphs under a missing family', async () => {
    // An icon component whose font never loaded renders a PUA codepoint with
    // an unregistered family. Inter (the fallback) has no glyph there; the
    // paragraph paints Inter's .notdef (tofu) instead of icon artwork — the
    // frame still has nonzero size, so layout survives even when the font is
    // missing. This is the documented degraded mode, not a blank collapse.
    const root = renderText('Family-Never-Registered', String.fromCodePoint(0xe88a));
    const painted = await paintedPixelsInTextFrame(root);
    const node = findNode(root.getLayoutTree(), (n) => n.type === 'Text')!;
    expect(node.frame.width).toBeGreaterThan(0);
    expect(node.frame.height).toBeGreaterThan(10);
    expect(painted).toBeGreaterThan(50); // tofu is visible, not invisible
    root.unmount();
  });
});

describe('react-native-vector-icons compat contract', () => {
  it('createIconSet registers the fontFile through the expo seam and paints the glyph', async () => {
    // Glyph map points at 'A' so the Inter bytes used as the "icon font" have
    // real artwork for it; the icon-set family is fresh to this test.
    const Icon = createIconSet({ home: 0x41 }, 'CompatIconSet-Test', fontBytes('Inter-Bold.otf'));
    const root = createTestRoot(300, 100);
    root.render(
      <View style={{ flex: 1, backgroundColor: '#ffffff', alignItems: 'flex-start' }}>
        <Icon name="home" size={40} color="#000000" />
      </View>
    );
    // Icons render empty Text until the family registers, then swap in.
    let node = null;
    for (let i = 0; i < 40 && !node?.text; i++) {
      await sleep(25);
      await root.flush();
      node = findNode(root.getLayoutTree(), (n) => n.type === 'Text');
    }
    expect(node?.text).toBe('A');
    expect(isLoaded('CompatIconSet-Test')).toBe(true);
    expect(await paintedPixelsInTextFrame(root)).toBeGreaterThan(50);
    root.unmount();

    expect(Icon.hasIcon('home')).toBe(true);
    expect(Icon.hasIcon('nope')).toBe(false);
    expect(Icon.getFontFamily()).toBe('CompatIconSet-Test');
    await expect(Icon.getImageSource('home')).resolves.toBeNull(); // warn-once stub
  });

  it('the default export (subpath imports) warns once and paints a placeholder instead of throwing', async () => {
    // Reached by libraries PROBING for an icon package (paper's icon loader
    // require()s this one), so it must degrade, not crash the tree.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const root = createTestRoot(300, 100);
    root.render(
      <View style={{ flex: 1, backgroundColor: '#ffffff', alignItems: 'flex-start' }}>
        <SubpathIcon name="home" size={40} color="#000000" />
      </View>
    );
    await root.flush();
    const node = findNode(root.getLayoutTree(), (n) => n.type === 'Text');
    expect(node?.text).toBe('□');
    expect(await paintedPixelsInTextFrame(root)).toBeGreaterThan(20);
    expect(warn.mock.calls.flat().join(' ')).toMatch(/@expo\/vector-icons/);
    await expect(SubpathIcon.getImageSource('home')).resolves.toBeNull();
    root.unmount();
    warn.mockRestore();
  });
});
