/**
 * TextInput focus/value state machine — DOM-free.
 *
 * The canvas paints unfocused inputs; typing needs a real DOM element (the one
 * thing a canvas cannot do is summon a keyboard). This module owns WHICH input
 * is focused and WHAT its value is; the DOM sliver lives in
 * `textInputOverlay.ts` behind the `OverlayFactory` seam, so everything here
 * runs (and is tested) under Node: a headless focus is a real focus with no
 * overlay attached.
 */
import type { CNode } from './node';
import { runDiscreteEvent } from '../reconciler/hostConfig';

export interface TextInputSpec {
  /** value != null makes the input controlled (RN semantics). */
  value?: string;
  defaultValue?: string;
  placeholder?: string;
  placeholderTextColor?: string;
  secureTextEntry?: boolean;
  multiline?: boolean;
  numberOfLines?: number;
  editable?: boolean;
  maxLength?: number;
  autoFocus?: boolean;
  keyboardType?: string;
  returnKeyType?: string;
  autoCapitalize?: string;
  autoCorrect?: boolean;
  autoComplete?: string;
  selectTextOnFocus?: boolean;
  selectionColor?: string;
  cursorColor?: string;
  blurOnSubmit?: boolean;
  submitBehavior?: 'submit' | 'blurAndSubmit' | 'newline';
  onChangeText?: (text: string) => void;
  onChange?: (e: { nativeEvent: { text: string; target: number } }) => void;
  onFocus?: (e: { nativeEvent: { target: number } }) => void;
  onBlur?: (e: { nativeEvent: { target: number } }) => void;
  onSubmitEditing?: (e: { nativeEvent: { text: string; target: number } }) => void;
  onKeyPress?: (e: { nativeEvent: { key: string } }) => void;
  onEndEditing?: (e: { nativeEvent: { text: string; target: number } }) => void;
}

/** What the browser overlay must provide; `null` factory = headless (Node). */
export interface InputOverlay {
  /** Push the engine's value into the DOM element, preserving the caret. */
  sync(value: string): void;
  /** Re-derive fixed-position geometry from canvas + node frames. */
  reposition(): void;
  destroy(): void;
}
export interface OverlayController {
  onInput(text: string): void;
  onSubmit(): void;
  onDomBlur(): void;
  onKeyPress(key: string): void;
}
export type OverlayFactory = (node: CNode, controller: OverlayController) => InputOverlay | null;

let overlayFactory: OverlayFactory | null = null;
export function setOverlayFactory(f: OverlayFactory | null): void {
  overlayFactory = f;
}

/** Keyboard show/hide fan-out (the Keyboard shim registers here). */
type KeyboardEvent = 'keyboardWillShow' | 'keyboardDidShow' | 'keyboardWillHide' | 'keyboardDidHide';
let keyboardEmitter: ((event: KeyboardEvent) => void) | null = null;
export function setKeyboardEmitter(fn: ((event: KeyboardEvent) => void) | null): void {
  keyboardEmitter = fn;
}

/** Uncontrolled values live here, keyed by host node. */
const uncontrolled = new WeakMap<CNode, string>();

let focusedNode: CNode | null = null;
let focusedOverlay: InputOverlay | null = null;
/** Set on pointer-down over the focused input: the DOM blur that the canvas
 *  press inevitably causes must not read as a real blur. */
let reclaim: { node: CNode; at: number } | null = null;
const RECLAIM_WINDOW_MS = 600;

export function specOfInput(node: CNode): TextInputSpec {
  return (node.props.__input as TextInputSpec | undefined) ?? {};
}

function isControlled(spec: TextInputSpec): boolean {
  return spec.value != null;
}

/** The string the engine paints / the overlay edits (before secure masking). */
export function inputValueOf(node: CNode): string {
  const spec = specOfInput(node);
  if (isControlled(spec)) return spec.value ?? '';
  const stored = uncontrolled.get(node);
  return stored ?? spec.defaultValue ?? '';
}

export function getFocusedInputNode(): CNode | null {
  return focusedNode;
}

export function isFocusedInput(node: CNode): boolean {
  return focusedNode === node;
}

/** True when a real DOM element is showing the text (suppress Skia text). */
export function hasDomOverlay(node: CNode): boolean {
  return focusedNode === node && focusedOverlay != null;
}

export function notePointerDownOnInput(node: CNode): void {
  if (focusedNode === node) reclaim = { node, at: Date.now() };
}

const controllerFor = (node: CNode): OverlayController => ({
  onInput: (text) => inputTextChanged(node, text),
  onSubmit: () => submitInput(node),
  onDomBlur: () => {
    if (reclaim && reclaim.node === node && Date.now() - reclaim.at < RECLAIM_WINDOW_MS) {
      // The canvas press stole DOM focus; focusInput() re-takes it. Not a blur.
      return;
    }
    if (focusedNode === node) blurInput(node);
  },
  onKeyPress: (key) => specOfInput(node).onKeyPress?.({ nativeEvent: { key } }),
});

export function focusInput(node: CNode): void {
  const spec = specOfInput(node);
  if (spec.editable === false) return;
  if (focusedNode === node) {
    // re-tap on the already-focused input: re-take DOM focus, keep state
    reclaim = null;
    focusedOverlay?.reposition();
    focusedOverlay?.sync(inputValueOf(node));
    return;
  }
  if (focusedNode) blurInput(focusedNode);
  focusedNode = node;
  reclaim = null;
  focusedOverlay = overlayFactory ? overlayFactory(node, controllerFor(node)) : null;
  focusedOverlay?.sync(inputValueOf(node));
  keyboardEmitter?.('keyboardWillShow');
  spec.onFocus?.({ nativeEvent: { target: node.id } });
  keyboardEmitter?.('keyboardDidShow');
  node.markDirty(); // repaint: Skia text hides under a DOM overlay
}

export function blurInput(node: CNode): void {
  if (focusedNode !== node) return;
  const spec = specOfInput(node);
  focusedOverlay?.destroy();
  focusedOverlay = null;
  focusedNode = null;
  reclaim = null;
  keyboardEmitter?.('keyboardWillHide');
  const text = inputValueOf(node);
  spec.onEndEditing?.({ nativeEvent: { text, target: node.id } });
  spec.onBlur?.({ nativeEvent: { target: node.id } });
  keyboardEmitter?.('keyboardDidHide');
  node.markDirty(); // repaint the (possibly typed-into) value via Skia
}

export function dismissKeyboard(): void {
  if (focusedNode) blurInput(focusedNode);
}

export function inputTextChanged(node: CNode, text: string): void {
  const spec = specOfInput(node);
  let next = text;
  if (spec.maxLength != null && next.length > spec.maxLength) next = next.slice(0, spec.maxLength);
  if (!isControlled(spec)) uncontrolled.set(node, next);
  // Discrete + synchronous: a controlled parent's setState must COMMIT before
  // this input event returns (react-dom semantics), or the async flush later
  // pushes a stale value into the DOM mid-typing.
  runDiscreteEvent(() => {
    spec.onChangeText?.(next);
    spec.onChange?.({ nativeEvent: { text: next, target: node.id } });
  });
  // The committed value is now authoritative (parent may have transformed or
  // rejected it — controlled uppercase/clamp patterns); reflect it in the DOM.
  if (focusedNode === node) focusedOverlay?.sync(inputValueOf(node));
  node.invalidateInput();
  node.markDirty();
}

export function clearInput(node: CNode): void {
  inputTextChanged(node, '');
  focusedOverlay?.sync('');
}

export function submitInput(node: CNode): void {
  const spec = specOfInput(node);
  const text = inputValueOf(node);
  // RN: submitBehavior defaults to 'blurAndSubmit' for single-line and
  // 'newline' for multiline; blurOnSubmit is the legacy spelling.
  const behavior =
    spec.submitBehavior ??
    (spec.blurOnSubmit != null
      ? spec.blurOnSubmit
        ? 'blurAndSubmit'
        : 'submit'
      : spec.multiline
        ? 'newline'
        : 'blurAndSubmit');
  if (behavior === 'newline') return; // overlay's textarea inserts the newline itself
  spec.onSubmitEditing?.({ nativeEvent: { text, target: node.id } });
  if (behavior === 'blurAndSubmit') blurInput(node);
}

/**
 * Called by the renderer after every flush: controlled value changes and
 * layout/scroll movement must reach the live overlay.
 */
export function syncFocusedOverlay(rootNode: CNode): void {
  if (!focusedNode || !focusedOverlay) return;
  let n: CNode | null = focusedNode;
  while (n && n !== rootNode) n = n.parent;
  if (n !== rootNode) return; // focused input belongs to another root
  focusedOverlay.sync(inputValueOf(focusedNode));
  focusedOverlay.reposition();
}

/** Node teardown (deletion or root unmount): drop focus without callbacks. */
export function inputNodeDestroyed(node: CNode): void {
  if (focusedNode !== node) return;
  focusedOverlay?.destroy();
  focusedOverlay = null;
  focusedNode = null;
  reclaim = null;
}
