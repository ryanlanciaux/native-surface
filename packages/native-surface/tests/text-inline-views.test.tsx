/**
 * An element child of `<Text>` — RN's inline view.
 *
 * This is not a nicety. Yoga forbids children on a node with a measure
 * function, and a text node HAS one, so handing Yoga such a child does not
 * throw a JS error: it reaches Emscripten's `abort()`. That surfaces as
 * `RuntimeError: Aborted()`, no error boundary can catch it, and the WASM heap
 * is dead afterwards — the whole surface stops, with nothing in the console
 * pointing at the component responsible.
 *
 * The real app that found it renders a verification badge inside a display
 * name (`<Text>{name}<View><Badge/></View></Text>`), which killed every screen
 * showing a profile. So the inline child is measured on its own and given a
 * PLACEHOLDER in the paragraph, which is both how the text engine is meant to
 * be used and how RN models an inline attachment.
 */
import { describe, expect, it } from 'vitest';
import { Pressable, Text, View } from '../src/index';
import { createTestRoot, findNode } from './helpers';

const SURFACE = 400;

describe('inline views inside <Text>', () => {
  it('renders a View inside a Text without aborting the engine', async () => {
    const root = createTestRoot(SURFACE, 200);
    root.render(
      <Text testID="line" style={{ fontSize: 16 }}>
        Ryan
        <View testID="badge" style={{ width: 20, height: 20 }} />
      </Text>
    );
    await root.flush();
    const tree = root.getLayoutTree();
    const badge = findNode(tree, (n) => n.testID === 'badge');
    expect(badge).not.toBeNull();
    expect(badge!.frame.width).toBe(20);
    expect(badge!.frame.height).toBe(20);
    root.unmount();
  });

  it('places the badge AFTER the text it follows, on the same line', async () => {
    const root = createTestRoot(SURFACE, 200);
    root.render(
      <Text testID="line" style={{ fontSize: 16 }}>
        Ryan
        <View testID="badge" style={{ width: 20, height: 20 }} />
      </Text>
    );
    await root.flush();
    const tree = root.getLayoutTree();
    const line = findNode(tree, (n) => n.testID === 'line')!;
    const badge = findNode(tree, (n) => n.testID === 'badge')!;
    // Inline, so it starts past the glyphs rather than at the origin...
    expect(badge.frame.x).toBeGreaterThan(0);
    // ...and sits within the line box, not below it.
    expect(badge.frame.y).toBeGreaterThanOrEqual(0);
    expect(badge.frame.y + badge.frame.height).toBeLessThanOrEqual(line.frame.height + 0.5);
    root.unmount();
  });

  it('counts the placeholder in the text’s own measurement', async () => {
    // The line has to be wide enough for the glyphs AND the badge; a
    // placeholder the paragraph ignored would leave the Text too narrow.
    const withBadge = createTestRoot(SURFACE, 200);
    withBadge.render(
      <View style={{ alignItems: 'flex-start' }}>
        <Text testID="line" style={{ fontSize: 16 }}>
          Ryan
          <View style={{ width: 40, height: 20 }} />
        </Text>
      </View>
    );
    await withBadge.flush();
    const wide = findNode(withBadge.getLayoutTree(), (n) => n.testID === 'line')!.frame.width;
    withBadge.unmount();

    const plain = createTestRoot(SURFACE, 200);
    plain.render(
      <View style={{ alignItems: 'flex-start' }}>
        <Text testID="line" style={{ fontSize: 16 }}>
          Ryan
        </Text>
      </View>
    );
    await plain.flush();
    const narrow = findNode(plain.getLayoutTree(), (n) => n.testID === 'line')!.frame.width;
    plain.unmount();

    expect(wide - narrow).toBeCloseTo(40, 0);
  });

  it('lets a press reach an inline view', async () => {
    // The badge in the app that found this is interactive, and a text node
    // used to swallow everything under it.
    const root = createTestRoot(SURFACE, 200);
    let pressed = false;
    root.render(
      <Text style={{ fontSize: 16 }}>
        Ryan
        <Pressable testID="badge" onPress={() => { pressed = true; }} style={{ width: 30, height: 30 }} />
      </Text>
    );
    await root.flush();
    const b = findNode(root.getLayoutTree(), (n) => n.testID === 'badge')!.frame;
    const x = b.x + b.width / 2;
    const y = b.y + b.height / 2;
    root.dispatchPointerEvent('down', { x, y });
    root.dispatchPointerEvent('up', { x, y });
    await root.flush();
    expect(pressed).toBe(true);
    root.unmount();
  });

  it('handles an inline view inside a NESTED Text', async () => {
    const root = createTestRoot(SURFACE, 200);
    root.render(
      <Text style={{ fontSize: 16 }}>
        Ryan{' '}
        <Text style={{ fontWeight: 'bold' }}>
          Lanciaux
          <View testID="badge" style={{ width: 16, height: 16 }} />
        </Text>
      </Text>
    );
    await root.flush();
    const badge = findNode(root.getLayoutTree(), (n) => n.testID === 'badge');
    expect(badge).not.toBeNull();
    expect(badge!.frame.x).toBeGreaterThan(0);
    root.unmount();
  });

  it('keeps several inline views in paragraph order', async () => {
    const root = createTestRoot(SURFACE, 200);
    root.render(
      <Text style={{ fontSize: 16 }}>
        A<View testID="one" style={{ width: 12, height: 12 }} />
        BB<View testID="two" style={{ width: 12, height: 12 }} />
      </Text>
    );
    await root.flush();
    const tree = root.getLayoutTree();
    const one = findNode(tree, (n) => n.testID === 'one')!;
    const two = findNode(tree, (n) => n.testID === 'two')!;
    expect(two.frame.x).toBeGreaterThan(one.frame.x);
    root.unmount();
  });

  it('survives the child being added and removed again', async () => {
    // removeChild must not ask Yoga to detach a child it never adopted.
    const root = createTestRoot(SURFACE, 200);
    const Line = ({ show }: { show: boolean }) => (
      <Text testID="line" style={{ fontSize: 16 }}>
        Ryan
        {show ? <View testID="badge" style={{ width: 20, height: 20 }} /> : null}
      </Text>
    );
    root.render(<Line show />);
    await root.flush();
    expect(findNode(root.getLayoutTree(), (n) => n.testID === 'badge')).not.toBeNull();
    root.render(<Line show={false} />);
    await root.flush();
    expect(findNode(root.getLayoutTree(), (n) => n.testID === 'badge')).toBeNull();
    root.render(<Line show />);
    await root.flush();
    expect(findNode(root.getLayoutTree(), (n) => n.testID === 'badge')).not.toBeNull();
    root.unmount();
  });

  it('does not stack truncated-away badges on the first line', async () => {
    // Past numberOfLines a placeholder has no rect. Leaving those at the
    // origin would paint every clipped badge over the visible text.
    const root = createTestRoot(120, 200);
    root.render(
      <Text testID="line" numberOfLines={1} style={{ fontSize: 16 }}>
        Ryan Lanciaux writes a great deal of text here indeed
        <View testID="badge" style={{ width: 20, height: 20 }} />
      </Text>
    );
    await root.flush();
    const badge = findNode(root.getLayoutTree(), (n) => n.testID === 'badge')!;
    expect(badge.frame.x).toBeLessThan(0);
    root.unmount();
  });
});
