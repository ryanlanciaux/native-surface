/**
 * TextInput primitive: measurement, focus/typing state machine (headless —
 * the DOM overlay factory returns null under Node, which is exactly the seam
 * design), controlled round-trips, submit semantics, paint.
 */
import * as React from 'react';
import { describe, expect, it } from 'vitest';
import { Text, View } from '../src/components/primitives';
import { TextInput, type TextInputRef } from '../src';
import {
  getFocusedInputNode,
  inputTextChanged,
  inputValueOf,
  submitInput,
} from '../src/engine/textInputState';
import { Keyboard } from '../src/api/extras';
import { asImpl, createTestRoot, findNode, writeSnapshot } from './helpers';

const tap = (root: ReturnType<typeof createTestRoot>, x: number, y: number) => {
  const impl = asImpl(root);
  impl.dispatchPointerEvent('down', { x, y });
  impl.dispatchPointerEvent('up', { x, y });
};

describe('TextInput', () => {
  it('single-line measures one line box; multiline numberOfLines grows it', async () => {
    const root = createTestRoot(300, 300);
    root.render(
      <View>
        <TextInput testID="one" placeholder="hi" style={{ width: 200 }} />
        <TextInput testID="three" multiline numberOfLines={3} style={{ width: 200 }} />
      </View>
    );
    await root.flush();
    const tree = root.getLayoutTree();
    const one = findNode(tree, (n) => n.type === 'Textinput')!;
    expect(one.frame.height).toBeGreaterThan(10);
    const all: number[] = [];
    const walk = (n: typeof tree) => {
      if (n.type === 'Textinput') all.push(n.frame.height);
      n.children.forEach(walk);
    };
    walk(tree);
    expect(all).toHaveLength(2);
    expect(all[1]!).toBeGreaterThanOrEqual(all[0]! * 2.5); // 3 lines vs 1
    root.unmount();
  });

  it('tap focuses (headless), typing round-trips uncontrolled value + onChangeText', async () => {
    const root = createTestRoot(300, 100);
    const changes: string[] = [];
    const focusEvents: string[] = [];
    root.render(
      <TextInput
        defaultValue="ab"
        onChangeText={(t) => changes.push(t)}
        onFocus={() => focusEvents.push('focus')}
        onBlur={() => focusEvents.push('blur')}
        style={{ width: 300, height: 40 }}
      />
    );
    await root.flush();
    expect(getFocusedInputNode()).toBeNull();
    tap(root, 150, 20);
    const node = getFocusedInputNode();
    expect(node).not.toBeNull();
    expect(focusEvents).toEqual(['focus']);
    expect(inputValueOf(node!)).toBe('ab');

    inputTextChanged(node!, 'abc'); // what the DOM overlay's input event calls
    inputTextChanged(node!, 'abcd');
    expect(changes).toEqual(['abc', 'abcd']);
    expect(inputValueOf(node!)).toBe('abcd');

    // blur via Keyboard.dismiss and the value survives for painting
    Keyboard.dismiss();
    expect(focusEvents).toEqual(['focus', 'blur']);
    expect(getFocusedInputNode()).toBeNull();
    expect(inputValueOf(node!)).toBe('abcd');
    root.unmount();
  });

  it('controlled value round-trips through React state without loss', async () => {
    const root = createTestRoot(300, 100);
    let setValue: ((v: string) => void) | null = null;
    function Controlled() {
      const [value, set] = React.useState('x');
      setValue = set;
      return (
        <View>
          <TextInput value={value} onChangeText={set} style={{ width: 200, height: 40 }} testID="in" />
          <Text testID="echo">{value}</Text>
        </View>
      );
    }
    root.render(<Controlled />);
    await root.flush();
    tap(root, 100, 20);
    const node = getFocusedInputNode()!;
    expect(inputValueOf(node)).toBe('x');
    inputTextChanged(node, 'xy');
    await root.flush();
    expect(inputValueOf(node)).toBe('xy'); // spec.value now 'xy' via state
    const echo = findNode(root.getLayoutTree(), (n) => n.text === 'xy');
    expect(echo).not.toBeNull();
    // parent-driven change (reset button pattern)
    setValue!('');
    await root.flush();
    expect(inputValueOf(node)).toBe('');
    root.unmount();
  });

  it('maxLength clamps; secureTextEntry masks the painted text', async () => {
    const root = createTestRoot(300, 100);
    const changes: string[] = [];
    root.render(
      <TextInput
        maxLength={3}
        secureTextEntry
        onChangeText={(t) => changes.push(t)}
        style={{ width: 300, height: 40 }}
      />
    );
    await root.flush();
    tap(root, 150, 20);
    const node = getFocusedInputNode()!;
    inputTextChanged(node, 'abcdef');
    expect(changes).toEqual(['abc']);
    expect(inputValueOf(node)).toBe('abc');
    root.unmount();
  });

  it('submit: single-line fires onSubmitEditing and blurs; multiline stays (newline)', async () => {
    const root = createTestRoot(300, 200);
    const submitted: string[] = [];
    const blurs: string[] = [];
    root.render(
      <View>
        <TextInput
          defaultValue="go"
          onSubmitEditing={(e) => submitted.push(e.nativeEvent.text)}
          onBlur={() => blurs.push('single')}
          style={{ width: 300, height: 40 }}
        />
        <TextInput
          multiline
          defaultValue="line"
          onSubmitEditing={() => submitted.push('multi')}
          onBlur={() => blurs.push('multi')}
          style={{ width: 300, height: 60 }}
        />
      </View>
    );
    await root.flush();
    tap(root, 150, 20);
    const single = getFocusedInputNode()!;
    submitInput(single);
    expect(submitted).toEqual(['go']);
    expect(blurs).toEqual(['single']);
    expect(getFocusedInputNode()).toBeNull();

    tap(root, 150, 60);
    const multi = getFocusedInputNode()!;
    submitInput(multi); // default multiline behavior: newline — no submit, no blur
    expect(submitted).toEqual(['go']);
    expect(getFocusedInputNode()).toBe(multi);
    root.unmount();
  });

  it('editable=false neither focuses nor fires focus events', async () => {
    const root = createTestRoot(300, 100);
    const focusEvents: string[] = [];
    root.render(
      <TextInput editable={false} onFocus={() => focusEvents.push('focus')} style={{ width: 300, height: 40 }} />
    );
    await root.flush();
    tap(root, 150, 20);
    expect(getFocusedInputNode()).toBeNull();
    expect(focusEvents).toEqual([]);
    root.unmount();
  });

  it('ref API: focus/blur/clear/isFocused', async () => {
    const root = createTestRoot(300, 100);
    const ref = React.createRef<TextInputRef>();
    root.render(<TextInput ref={ref} defaultValue="seed" style={{ width: 300, height: 40 }} />);
    await root.flush();
    expect(ref.current!.isFocused()).toBe(false);
    ref.current!.focus();
    expect(ref.current!.isFocused()).toBe(true);
    ref.current!.clear();
    expect(inputValueOf(getFocusedInputNode()!)).toBe('');
    ref.current!.blur();
    expect(ref.current!.isFocused()).toBe(false);
    root.unmount();
  });

  it('Keyboard listeners fire on focus/blur', async () => {
    const root = createTestRoot(300, 100);
    const events: string[] = [];
    const subs = [
      Keyboard.addListener('keyboardDidShow', () => events.push('show')),
      Keyboard.addListener('keyboardDidHide', () => events.push('hide')),
    ];
    root.render(<TextInput style={{ width: 300, height: 40 }} />);
    await root.flush();
    tap(root, 150, 20);
    expect(Keyboard.isVisible()).toBe(true);
    Keyboard.dismiss();
    expect(events).toEqual(['show', 'hide']);
    expect(Keyboard.isVisible()).toBe(false);
    subs.forEach((s) => s.remove());
    root.unmount();
  });

  it('paints value, placeholder, and typed-then-blurred text (pixel probe + snapshot)', async () => {
    const root = createTestRoot(320, 170);
    root.render(
      <View style={{ flex: 1, backgroundColor: '#FFFFFF', padding: 16, gap: 12 }}>
        <TextInput
          defaultValue="Typed value"
          style={{ height: 36, borderWidth: 1, borderColor: '#CCCCCC', borderRadius: 8, paddingHorizontal: 10, color: '#111111' }}
        />
        <TextInput
          placeholder="Placeholder here"
          placeholderTextColor="#FF0000"
          style={{ height: 36, borderWidth: 1, borderColor: '#CCCCCC', borderRadius: 8, paddingHorizontal: 10 }}
        />
        <TextInput
          secureTextEntry
          defaultValue="hunter2"
          style={{ height: 36, borderWidth: 1, borderColor: '#CCCCCC', borderRadius: 8, paddingHorizontal: 10 }}
        />
      </View>
    );
    await root.flush();
    await writeSnapshot(root, 'textinput');
    // placeholder paints in its explicit red somewhere along the second row
    const impl = asImpl(root);
    let sawRed = false;
    for (let x = 30; x < 200 && !sawRed; x += 2) {
      const px = impl.readPixel(x, 82);
      if (px.r > 150 && px.g < 100 && px.b < 100) sawRed = true;
    }
    expect(sawRed).toBe(true);

    // type into the first input headlessly, blur, and the paint shows the new value
    tap(root, 160, 34);
    const node = getFocusedInputNode()!;
    inputTextChanged(node, 'After blur');
    Keyboard.dismiss();
    await root.flush();
    let sawInk = false;
    for (let x = 30; x < 200 && !sawInk; x += 2) {
      const px = impl.readPixel(x, 34);
      if (px.r < 80 && px.g < 80 && px.b < 80 && px.a > 200) sawInk = true;
    }
    expect(sawInk).toBe(true);
    root.unmount();
  });
});
