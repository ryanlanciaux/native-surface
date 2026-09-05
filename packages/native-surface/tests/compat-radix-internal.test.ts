import { describe, expect, it } from 'vitest';
import * as React from 'react';
import { DismissableLayer, FocusGuards, FocusScope } from '../../compat/src/radix-internal';

describe('radix-ui/internal canvas stub', () => {
  it('no-ops FocusGuards and passes children through FocusScope / DismissableLayer', () => {
    expect(() => FocusGuards.useFocusGuards()).not.toThrow();
    const child = React.createElement('span', null, 'ok');
    expect(FocusScope.FocusScope({ asChild: true, children: child })).toBe(child);
    expect(DismissableLayer.DismissableLayer({ children: child })).toBe(child);
  });
});
