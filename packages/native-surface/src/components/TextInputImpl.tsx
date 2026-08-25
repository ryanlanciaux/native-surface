/**
 * TextInput — the real primitive. A `cn-textinput` host leaf: the engine
 * measures (Yoga measure func) and paints (Skia) the value/placeholder while
 * unfocused; a tap focuses it, which materializes ONE real DOM <input>/
 * <textarea> positioned over the canvas (engine/textInputOverlay.ts) so the
 * OS keyboard, IME, caret, and selection are all genuinely native. Blur syncs
 * the value back and returns painting to Skia. State machine:
 * engine/textInputState.ts (fully testable headless).
 */
import * as React from 'react';
import {
  blurInput,
  clearInput,
  focusInput,
  getFocusedInputNode,
  inputValueOf,
  isFocusedInput,
  notePointerDownOnInput,
  type TextInputSpec,
} from '../engine/textInputState';
import type { CNode } from '../engine/node';
import type { PressEvent, StyleProp, TextStyle, ViewStyle } from '../types';

/* eslint-disable @typescript-eslint/no-explicit-any */
const CnTextInput = 'cn-textinput' as unknown as React.FC<any>;

export interface TextInputProps {
  value?: string;
  defaultValue?: string;
  placeholder?: string;
  placeholderTextColor?: string;
  secureTextEntry?: boolean;
  multiline?: boolean;
  numberOfLines?: number;
  editable?: boolean;
  autoFocus?: boolean;
  maxLength?: number;
  keyboardType?: string;
  returnKeyType?: string;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  autoComplete?: string;
  autoCorrect?: boolean;
  selectTextOnFocus?: boolean;
  selectionColor?: string;
  cursorColor?: string;
  blurOnSubmit?: boolean;
  submitBehavior?: 'submit' | 'blurAndSubmit' | 'newline';
  style?: StyleProp<TextStyle & ViewStyle>;
  onChangeText?: (text: string) => void;
  onChange?: (e: { nativeEvent: { text: string; target: number } }) => void;
  onFocus?: (e: unknown) => void;
  onBlur?: (e: unknown) => void;
  onSubmitEditing?: (e: { nativeEvent: { text: string; target: number } }) => void;
  onEndEditing?: (e: unknown) => void;
  onKeyPress?: (e: { nativeEvent: { key: string } }) => void;
  onPressIn?: (e: PressEvent) => void;
  onLayout?: (e: unknown) => void;
  // Accepted for RN API compatibility (advisory here):
  textContentType?: string;
  readOnly?: boolean;
  testID?: string;
}

export interface TextInputRef {
  focus(): void;
  blur(): void;
  clear(): void;
  isFocused(): boolean;
  setNativeProps(patch: Record<string, unknown>): void;
}

export const TextInput = React.forwardRef<TextInputRef, TextInputProps>(function TextInput(props, ref) {
  const {
    style,
    onPressIn,
    onLayout,
    testID,
    editable = true,
    readOnly,
    autoFocus,
    ...rest
  } = props;
  const nodeRef = React.useRef<CNode | null>(null);
  const effectiveEditable = editable && !readOnly;

  const spec: TextInputSpec = {
    ...rest,
    editable: effectiveEditable,
  };

  React.useImperativeHandle(
    ref,
    () => ({
      focus: () => nodeRef.current && focusInput(nodeRef.current),
      blur: () => nodeRef.current && blurInput(nodeRef.current),
      clear: () => nodeRef.current && clearInput(nodeRef.current),
      isFocused: () => (nodeRef.current ? isFocusedInput(nodeRef.current) : false),
      setNativeProps: (patch) => nodeRef.current?.setNativeProps(patch),
    }),
    []
  );

  React.useEffect(() => {
    if (autoFocus && nodeRef.current) focusInput(nodeRef.current);
    // mount-only, like RN
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pressHandlers = effectiveEditable
    ? {
        __pressable: true,
        __onPressIn: (e: PressEvent) => {
          if (nodeRef.current) notePointerDownOnInput(nodeRef.current);
          onPressIn?.(e);
        },
        __onPress: () => {
          if (nodeRef.current) focusInput(nodeRef.current);
        },
      }
    : { __pressable: true, __disabled: true };

  return React.createElement(CnTextInput, {
    ref: nodeRef,
    style,
    testID,
    onLayout,
    __input: spec,
    ...pressHandlers,
  });
});

/** RN static (rarely used, but part of the contract). */
export const TextInputState = {
  currentlyFocusedInput: (): CNode | null => getFocusedInputNode(),
  focusTextInput: (node: CNode | null): void => {
    if (node) focusInput(node);
  },
  blurTextInput: (node: CNode | null): void => {
    if (node) blurInput(node);
  },
};

export { inputValueOf as unstable_inputValueOf };
