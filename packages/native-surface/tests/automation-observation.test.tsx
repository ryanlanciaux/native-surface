import * as React from 'react';
import { expect, it } from 'vitest';
import { TextInput, Pressable, Text, View } from '../src';
import { createAutomationController } from '../src/automation';
import { createTestRoot } from './helpers';

it('observes full input values separately from glyphs and omits secure values', async () => {
  const root = createTestRoot(300, 200);
  root.render(<View>
    <TextInput testID="normal" accessibilityLabel="Name" defaultValue="original" placeholder="Name" style={{ width: 200, height: 40 }} />
    <TextInput testID="secure" defaultValue="private-value" secureTextEntry style={{ width: 200, height: 40 }} />
    <Pressable testID="button" accessibilityState={{ selected: true }} style={{ height: 40 }}><Text>Tap</Text></Pressable>
  </View>);
  await root.flush();
  const controller = createAutomationController(root);
  try {
    const before = controller.snapshot();
    expect(before.nodes.find(n => n.testID === 'normal')).toMatchObject({ value: 'original', label: 'Name', secure: false, placeholder: 'Name' });
    expect(before.nodes.find(n => n.testID === 'secure')).toMatchObject({ secure: true, inputPurpose: 'password' });
    expect(before.nodes.find(n => n.testID === 'secure')!.value).toBeUndefined();
    expect(before.nodes.find(n => n.testID === 'button')).toMatchObject({ role: 'button', selected: true });
    expect(JSON.stringify(before)).not.toContain('private-value');
    controller.tap({ x: 50, y: 20 }); controller.type('!');
    expect(controller.inputElement()).toBeNull();
    expect(controller.snapshot().nodes.find(n => n.testID === 'normal')!.value).toBe('original!');
    expect(controller.hitTest({ x: 50, y: 20 })).toContain(before.nodes.find(n => n.testID === 'normal')!.id);
  } finally { controller.dispose(); root.unmount(); }
});
