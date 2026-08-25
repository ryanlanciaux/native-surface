import { describe, expect, it } from 'vitest';
import * as React from 'react';
import { View } from '../src/components/primitives';
import { asImpl, createTestRoot } from './helpers';

describe('stack card seam shadow', () => {
  it('a transparent wrapper with stack shadowStyle casts a visible edge shadow', async () => {
    const root = createTestRoot(200, 100);
    const impl = asImpl(root);
    root.render(
      <View style={{ flex: 1, backgroundColor: '#ffffff' }}>
        {/* card wrapper at x=100, transparent bg, stack's shadowStyle */}
        <View
          style={{
            position: 'absolute',
            left: 100,
            top: 0,
            width: 100,
            height: 100,
            shadowColor: '#000',
            shadowOffset: { width: -1, height: 1 },
            shadowRadius: 5,
            shadowOpacity: 0.3,
          }}
        >
          <View style={{ flex: 1, backgroundColor: '#f4f5f8' }} />
        </View>
      </View>
    );
    await root.flush();
    const seam = impl.readPixel(97, 50); // just left of the card edge
    const far = impl.readPixel(20, 50);
    console.log('seam:', JSON.stringify(seam), 'far:', JSON.stringify(far));
    expect(far.r).toBeGreaterThan(250);
    expect(seam.r).toBeLessThan(250); // darkened by the shadow
    root.unmount();
  });
});
