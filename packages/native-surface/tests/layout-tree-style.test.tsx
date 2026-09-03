import { describe, expect, it } from 'vitest';
import { Text, View } from '../src/index';
import { flattenStyle } from '../src/engine/styles';
import { createTestRoot, findNode } from './helpers';

describe('flattenStyle', () => {
  it('does not walk reanimated viewDescriptor handles or circular style arrays', () => {
    const cycle: unknown[] = [{ opacity: 1 }];
    cycle.push(cycle);
    expect(flattenStyle(cycle as never)).toEqual({ opacity: 1 });
    expect(flattenStyle({ viewDescriptors: {}, opacity: 0.5 } as never)).toEqual({});
    expect(flattenStyle([{ opacity: 1 }, { viewDescriptors: {} }, { width: 10 }] as never)).toEqual({
      opacity: 1,
      width: 10,
    });
  });
});

describe('getLayoutTree: spacing and font', () => {
  it('reports padding, margin, gap, and font from own style', async () => {
    const root = createTestRoot(300, 300);
    root.render(
      <View testID="box" style={{ padding: 8, marginTop: 4, gap: 6 }}>
        <Text testID="label" style={{ fontSize: 18, fontWeight: '700', fontFamily: 'Inter', color: '#0f172a' }}>
          Hi
        </Text>
      </View>
    );
    await root.flush();
    const box = findNode(root.getLayoutTree(), (n) => n.testID === 'box')!;
    expect(box.padding).toEqual({ top: 8, right: 8, bottom: 8, left: 8 });
    expect(box.margin).toEqual({ top: 4, right: 0, bottom: 0, left: 0 });
    expect(box.gap).toBe(6);
    const label = findNode(root.getLayoutTree(), (n) => n.testID === 'label')!;
    expect(label.font).toEqual({ size: 18, family: 'Inter', weight: '700', color: '#0f172a' });
    root.unmount();
  });
});
