import type * as React from 'react';

export type ColorValue = string;

export type DimensionValue = number | 'auto' | `${number}%`;

export interface FlexStyle {
  alignContent?: 'flex-start' | 'flex-end' | 'center' | 'stretch' | 'space-between' | 'space-around' | 'space-evenly';
  alignItems?: 'flex-start' | 'flex-end' | 'center' | 'stretch' | 'baseline';
  alignSelf?: 'auto' | 'flex-start' | 'flex-end' | 'center' | 'stretch' | 'baseline';
  aspectRatio?: number | string;
  borderBottomWidth?: number;
  borderLeftWidth?: number;
  borderRightWidth?: number;
  borderTopWidth?: number;
  borderWidth?: number;
  bottom?: DimensionValue;
  display?: 'none' | 'flex';
  flex?: number;
  flexBasis?: DimensionValue;
  flexDirection?: 'row' | 'column' | 'row-reverse' | 'column-reverse';
  flexGrow?: number;
  flexShrink?: number;
  flexWrap?: 'wrap' | 'nowrap' | 'wrap-reverse';
  gap?: number | `${number}%`;
  rowGap?: number | `${number}%`;
  columnGap?: number | `${number}%`;
  height?: DimensionValue;
  justifyContent?: 'flex-start' | 'flex-end' | 'center' | 'space-between' | 'space-around' | 'space-evenly';
  left?: DimensionValue;
  margin?: DimensionValue;
  marginBottom?: DimensionValue;
  marginEnd?: DimensionValue;
  marginHorizontal?: DimensionValue;
  marginLeft?: DimensionValue;
  marginRight?: DimensionValue;
  marginStart?: DimensionValue;
  marginTop?: DimensionValue;
  marginVertical?: DimensionValue;
  maxHeight?: DimensionValue;
  maxWidth?: DimensionValue;
  minHeight?: DimensionValue;
  minWidth?: DimensionValue;
  overflow?: 'visible' | 'hidden' | 'scroll';
  padding?: DimensionValue;
  paddingBottom?: DimensionValue;
  paddingEnd?: DimensionValue;
  paddingHorizontal?: DimensionValue;
  paddingLeft?: DimensionValue;
  paddingRight?: DimensionValue;
  paddingStart?: DimensionValue;
  paddingTop?: DimensionValue;
  paddingVertical?: DimensionValue;
  position?: 'absolute' | 'relative';
  right?: DimensionValue;
  top?: DimensionValue;
  width?: DimensionValue;
  zIndex?: number;
}

export type TransformStyle =
  | { translateX: number }
  | { translateY: number }
  | { scale: number }
  | { scaleX: number }
  | { scaleY: number }
  | { rotate: string };

export interface ShadowStyle {
  shadowColor?: ColorValue;
  shadowOffset?: { width: number; height: number };
  shadowOpacity?: number;
  shadowRadius?: number;
  elevation?: number;
}

export interface ViewStyle extends FlexStyle, ShadowStyle {
  backgroundColor?: ColorValue;
  borderColor?: ColorValue;
  borderRadius?: number;
  borderTopLeftRadius?: number;
  borderTopRightRadius?: number;
  borderBottomLeftRadius?: number;
  borderBottomRightRadius?: number;
  opacity?: number;
  transform?: TransformStyle[];
}

export interface TextStyle extends ViewStyle {
  color?: ColorValue;
  fontFamily?: string;
  fontSize?: number;
  fontStyle?: 'normal' | 'italic';
  fontWeight?: 'normal' | 'bold' | '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900' | number;
  letterSpacing?: number;
  lineHeight?: number;
  textAlign?: 'auto' | 'left' | 'right' | 'center' | 'justify';
  textDecorationLine?: 'none' | 'underline' | 'line-through' | 'underline line-through';
}

export interface ImageStyle extends ViewStyle {
  resizeMode?: 'cover' | 'contain' | 'stretch' | 'center';
  tintColor?: ColorValue;
}

export type StyleProp<T> = T | ReadonlyArray<StyleProp<T>> | null | undefined | false;

export interface LayoutRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutChangeEvent {
  nativeEvent: { layout: LayoutRectangle };
}

export interface PressEvent {
  nativeEvent: {
    locationX: number;
    locationY: number;
    pageX: number;
    pageY: number;
    timestamp: number;
  };
}

export interface ScrollEvent {
  nativeEvent: {
    contentOffset: { x: number; y: number };
    contentSize: { width: number; height: number };
    layoutMeasurement: { width: number; height: number };
    /** Present on onScrollEndDrag: release velocity in px/ms (RN semantics). */
    velocity?: { x: number; y: number };
  };
}

export type Insets = { top?: number; left?: number; bottom?: number; right?: number };

/** The instance host-component refs resolve to (RN host-instance API subset). */
export interface HostInstance {
  measure(cb: (x: number, y: number, w: number, h: number, pageX: number, pageY: number) => void): void;
  measureInWindow(cb: (x: number, y: number, w: number, h: number) => void): void;
  measureLayout(
    relativeTo: unknown,
    onSuccess: (left: number, top: number, w: number, h: number) => void,
    onFail?: () => void
  ): void;
  setNativeProps(patch: Record<string, unknown>): void;
}

export interface ViewProps {
  ref?: React.Ref<HostInstance>;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
  pointerEvents?: 'auto' | 'none' | 'box-none' | 'box-only';
  onLayout?: (e: LayoutChangeEvent) => void;
  testID?: string;
}

export interface TextProps {
  style?: StyleProp<TextStyle>;
  children?: React.ReactNode;
  numberOfLines?: number;
  ellipsizeMode?: 'head' | 'middle' | 'tail' | 'clip';
  onPress?: (e: PressEvent) => void;
  onLayout?: (e: LayoutChangeEvent) => void;
  testID?: string;
  selectable?: boolean;
}

/** `scale` follows RN resolveAssetSource semantics: intrinsic pt = px/scale. */
export type ImageSource = { uri: string; scale?: number } | string;

export interface ImageProps {
  source: ImageSource;
  style?: StyleProp<ImageStyle>;
  resizeMode?: 'cover' | 'contain' | 'stretch' | 'center';
  onLoad?: () => void;
  onError?: (e: { nativeEvent: { error: string } }) => void;
  onLayout?: (e: LayoutChangeEvent) => void;
  testID?: string;
}

export interface PressableStateCallbackType {
  pressed: boolean;
}

export interface PressableProps {
  style?: StyleProp<ViewStyle> | ((state: PressableStateCallbackType) => StyleProp<ViewStyle>);
  children?: React.ReactNode | ((state: PressableStateCallbackType) => React.ReactNode);
  onPress?: (e: PressEvent) => void;
  onPressIn?: (e: PressEvent) => void;
  onPressOut?: (e: PressEvent) => void;
  onLongPress?: (e: PressEvent) => void;
  disabled?: boolean;
  hitSlop?: number | Insets;
  pointerEvents?: ViewProps['pointerEvents'];
  onLayout?: (e: LayoutChangeEvent) => void;
  testID?: string;
}

export interface TouchableOpacityProps extends Omit<PressableProps, 'style' | 'children'> {
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
  activeOpacity?: number;
}

export interface ScrollViewProps {
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
  horizontal?: boolean;
  scrollEnabled?: boolean;
  showsVerticalScrollIndicator?: boolean;
  showsHorizontalScrollIndicator?: boolean;
  /** 'normal' ≈ 0.998/ms, 'fast' ≈ 0.99/ms (UIScrollView semantics), or a per-ms number. */
  decelerationRate?: 'normal' | 'fast' | number;
  /** Rubber-band overscroll + bounce-back at the edges (default true, iOS semantics). */
  bounces?: boolean;
  /** Accepted for RN compatibility; the engine already emits one onScroll per painted frame. */
  scrollEventThrottle?: number;
  onScroll?: (e: ScrollEvent) => void;
  onScrollBeginDrag?: (e: ScrollEvent) => void;
  onScrollEndDrag?: (e: ScrollEvent) => void;
  onMomentumScrollBegin?: (e: ScrollEvent) => void;
  onMomentumScrollEnd?: (e: ScrollEvent) => void;
  onLayout?: (e: LayoutChangeEvent) => void;
  testID?: string;
}

/** Imperative handle exposed by ScrollView refs (RN subset). */
export interface ScrollViewHandle {
  scrollTo(opts: { x?: number; y?: number; animated?: boolean }): void;
  scrollToEnd(opts?: { animated?: boolean }): void;
}

export interface FontSpec {
  family: string;
  data?: ArrayBuffer;
  url?: string;
  weight?: number;
  style?: 'normal' | 'italic';
}

export interface InitOptions {
  canvasKitWasmUrl?: string;
  yogaWasmUrl?: string;
  fonts?: FontSpec[];
}

export interface RootOptions {
  width: number;
  height: number;
  dpr?: number;
  theme?: 'ios' | 'android';
  /**
   * The OS chrome this surface stands in for — status bar, notch, home
   * indicator. Zero by default, because a canvas in a page has none; an
   * embedder simulating a device viewport declares the device's insets here
   * and `react-native-safe-area-context` (via the compat shim) reports them.
   */
  safeAreaInsets?: { top?: number; right?: number; bottom?: number; left?: number };
  onAction?: (name: string, payload?: unknown) => void;
}

export interface LayoutNode {
  type: string;
  /** Where Yoga put the node, in surface coordinates. Transforms are NOT in
   *  here — see `painted` for where it actually ended up. */
  frame: { x: number; y: number; width: number; height: number };
  /**
   * Where the node is actually PAINTED, once every `transform` between it and
   * the surface has been applied — and therefore where a press lands, since
   * the hit path inverts those same transforms.
   *
   * Present only when it differs from `frame`, so a tree with no transforms in
   * it reads exactly as before. Omitting this was a real hole: a node animated
   * by a translate reports a frame it is nowhere near, which makes a driver
   * tap empty space and makes a layout dump quietly disagree with the screen.
   *
   * `rotated` marks the case this rectangle cannot describe honestly: under a
   * rotation (or a skew) the painted region is not axis-aligned, so the rect is
   * the transformed BOUNDING BOX and the center is still exact.
   */
  painted?: { x: number; y: number; width: number; height: number; rotated?: boolean };
  text?: string;
  /** The component's testID prop, when set — the driver-facing address. */
  testID?: string;
  /** accessibilityRole (or RN 0.71+ `role`), when set. */
  role?: string;
  /** accessibilityLabel (or `aria-label`), when set. */
  label?: string;
  /** TextInput placeholder, when set. */
  placeholder?: string;
  children: LayoutNode[];
}

export type PointerEventType = 'down' | 'move' | 'up' | 'cancel' | 'wheel';

export interface SyntheticPointer {
  x: number;
  y: number;
  deltaX?: number;
  deltaY?: number;
  /** Test hook: overrides the event timestamp (ms) used for velocity tracking. */
  t?: number;
}

export interface NativeRoot {
  render(element: React.ReactElement): void;
  unmount(): void;
  resize(width: number, height: number, dpr?: number): void;
  getLayoutTree(): LayoutNode;
  flush(): Promise<void>;
  /** Resolves once the engine (Yoga + CanvasKit WASM) is loaded. For
   *  "mounted AND painted", await flush() after render(). */
  whenReady(): Promise<void>;
  readonly canvas: HTMLCanvasElement | null;
  /** Live update of the declared safe-area insets (see RootOptions). */
  setSafeAreaInsets(insets: RootOptions['safeAreaInsets']): void;
  /** Test hook: drive the pointer pipeline without a DOM. Coordinates in CSS px. */
  dispatchPointerEvent(type: PointerEventType, e: SyntheticPointer): void;
  /** Switches the theme live (repaints; no remount needed). */
  setTheme(theme: 'ios' | 'android'): void;
  /** Swaps the action-log callback live (dispatch always reads the latest). */
  setOnAction(onAction: RootOptions['onAction']): void;
}

/** RN-compatible constraint for StyleSheet.create — keeps literal inference. */
export type NamedStyles<T> = { [P in keyof T]: ViewStyle | TextStyle | ImageStyle };
