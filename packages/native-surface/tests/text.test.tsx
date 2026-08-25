import { describe, expect, test } from 'vitest';
import * as React from 'react';
import { Text, View } from '../src/components/primitives';
import { createTestRoot, findNode } from './helpers';

describe('text', () => {
  test('text measures its content: width grows with content', async () => {
    const root = createTestRoot(400, 200);
    root.render(
      <View style={{ flex: 1, alignItems: 'flex-start' }}>
        <Text testID="short">Hi</Text>
        <Text testID="long">Hello measured world</Text>
      </View>
    );
    await root.flush();
    const tree = root.getLayoutTree();
    const short = findNode(tree, (n) => n.text === 'Hi')!;
    const long = findNode(tree, (n) => n.text === 'Hello measured world')!;
    expect(short.frame.width).toBeGreaterThan(4);
    expect(long.frame.width).toBeGreaterThan(short.frame.width * 3);
    expect(short.frame.height).toBeGreaterThan(10);
    root.unmount();
  });

  test('wrapping increases height under a width constraint', async () => {
    const long = 'The quick brown fox jumps over the lazy dog again and again and again';
    const rootWide = createTestRoot(600, 200);
    rootWide.render(
      <View style={{ flex: 1, alignItems: 'flex-start' }}>
        <Text>{long}</Text>
      </View>
    );
    await rootWide.flush();
    const wide = findNode(rootWide.getLayoutTree(), (n) => n.type === 'Text')!;

    const rootNarrow = createTestRoot(150, 400);
    rootNarrow.render(
      <View style={{ flex: 1 }}>
        <Text>{long}</Text>
      </View>
    );
    await rootNarrow.flush();
    const narrow = findNode(rootNarrow.getLayoutTree(), (n) => n.type === 'Text')!;

    expect(narrow.frame.width).toBeLessThanOrEqual(150);
    expect(narrow.frame.height).toBeGreaterThan(wide.frame.height * 2);
    rootWide.unmount();
    rootNarrow.unmount();
  });

  test('numberOfLines caps height', async () => {
    const long = 'word '.repeat(60).trim();
    const root = createTestRoot(150, 400);
    root.render(
      <View style={{ flex: 1 }}>
        <Text testID="capped" numberOfLines={2}>
          {long}
        </Text>
        <Text testID="free">{long}</Text>
      </View>
    );
    await root.flush();
    const tree = root.getLayoutTree();
    const [capped, free] = tree.children[0]!.children;
    expect(capped!.frame.height).toBeLessThan(free!.frame.height / 3);
    root.unmount();
  });

  test('nested spans concatenate and inherit', async () => {
    const root = createTestRoot(400, 100);
    root.render(
      <View style={{ flex: 1, alignItems: 'flex-start' }}>
        <Text style={{ fontSize: 16 }}>
          Total:{' '}
          <Text style={{ fontWeight: 'bold' }}>$42</Text>
        </Text>
      </View>
    );
    await root.flush();
    const node = findNode(root.getLayoutTree(), (n) => n.type === 'Text')!;
    expect(node.text).toBe('Total: $42');
    expect(node.frame.width).toBeGreaterThan(20);
    root.unmount();
  });

  test('larger fontSize measures taller', async () => {
    const root = createTestRoot(400, 300);
    root.render(
      <View style={{ flex: 1, alignItems: 'flex-start' }}>
        <Text style={{ fontSize: 14 }}>Sample</Text>
        <Text style={{ fontSize: 28 }}>Sample</Text>
      </View>
    );
    await root.flush();
    const [small, big] = root.getLayoutTree().children[0]!.children;
    expect(big!.frame.height).toBeGreaterThan(small!.frame.height * 1.5);
    expect(big!.frame.width).toBeGreaterThan(small!.frame.width * 1.5);
    root.unmount();
  });

  test('lineHeight controls measured line box', async () => {
    const root = createTestRoot(400, 300);
    root.render(
      <View style={{ flex: 1, alignItems: 'flex-start' }}>
        <Text testID="tight" style={{ fontSize: 14 }}>
          One
        </Text>
        <Text testID="loose" style={{ fontSize: 14, lineHeight: 40 }}>
          One
        </Text>
      </View>
    );
    await root.flush();
    const [tight, loose] = root.getLayoutTree().children[0]!.children;
    expect(loose!.frame.height).toBeGreaterThan(tight!.frame.height + 10);
    expect(Math.abs(loose!.frame.height - 40)).toBeLessThan(6);
    root.unmount();
  });

  test('text content updates re-measure', async () => {
    const root = createTestRoot(400, 100);
    function App({ label }: { label: string }): React.JSX.Element {
      return (
        <View style={{ flex: 1, alignItems: 'flex-start' }}>
          <Text>{label}</Text>
        </View>
      );
    }
    root.render(<App label="Hi" />);
    await root.flush();
    const w1 = findNode(root.getLayoutTree(), (n) => n.type === 'Text')!.frame.width;
    root.render(<App label="Hi there, much longer content" />);
    await root.flush();
    const w2 = findNode(root.getLayoutTree(), (n) => n.type === 'Text')!.frame.width;
    expect(w2).toBeGreaterThan(w1 * 2);
    root.unmount();
  });
});
