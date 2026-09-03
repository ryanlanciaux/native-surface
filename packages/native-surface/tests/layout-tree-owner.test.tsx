import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { Pressable, Text } from '../src/index';
import { createTestRoot, findNode } from './helpers';

function Button({ children }: { children?: ReactNode }) {
  return <Pressable testID="btn">{children}</Pressable>;
}

describe('getLayoutTree: composite owner', () => {
  it('tags a Pressable host with the app composite, not Pressable', async () => {
    const root = createTestRoot(200, 100);
    root.render(
      <Button>
        <Text>Hi</Text>
      </Button>
    );
    await root.flush();
    const host = findNode(root.getLayoutTree(), (n) => n.testID === 'btn')!;
    expect(host.name).toBe('Button');
    expect(host.name).not.toBe('Pressable');
    root.unmount();
  });
});
