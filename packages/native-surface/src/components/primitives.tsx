import * as React from 'react';
import { loadImage } from '../engine/init';
import { createElement, useMemo, useState } from 'react';
import type {
  ImageProps,
  PressableProps,
  PressableStateCallbackType,
  ScrollViewHandle,
  ScrollViewProps,
  StyleProp,
  TextProps,
  TouchableOpacityProps,
  ViewProps,
  ViewStyle,
  ColorValue,
} from '../types';
import { parseColor } from '../engine/colors';
import { flattenStyle } from '../engine/styles';
import { scrollNodeTo, scrollNodeToEnd } from '../engine/scrollPhysics';
import type { CNode } from '../engine/node';

/* eslint-disable @typescript-eslint/no-explicit-any */
const CnView = 'cn-view' as unknown as React.FC<any>;
const CnText = 'cn-text' as unknown as React.FC<any>;
const CnImage = 'cn-image' as unknown as React.FC<any>;
const CnScroll = 'cn-scroll' as unknown as React.FC<any>;

export function View(props: ViewProps): React.JSX.Element {
  const { children, ...rest } = props;
  return createElement(CnView, rest, children);
}

export function Text(props: TextProps): React.JSX.Element {
  const { children, onPress, ...rest } = props;
  const pressProps = onPress
    ? { __pressable: true, __onPress: onPress, __onPressIn: undefined, __onPressOut: undefined }
    : null;
  return createElement(CnText, { ...rest, ...pressProps }, children);
}

export function Image(props: ImageProps): React.JSX.Element {
  return createElement(CnImage, props);
}

export function Pressable(props: PressableProps): React.JSX.Element {
  const {
    style,
    children,
    onPress,
    onPressIn,
    onPressOut,
    onLongPress,
    disabled,
    hitSlop,
    ...rest
  } = props;
  const [pressed, setPressed] = useState(false);
  const state: PressableStateCallbackType = { pressed };
  const resolvedStyle = typeof style === 'function' ? style(state) : style;
  const resolvedChildren = typeof children === 'function' ? children(state) : children;

  const handlers = disabled
    ? { __pressable: true, __disabled: true }
    : {
        __pressable: true,
        __hitSlop: hitSlop,
        __onPressIn: (e: unknown) => {
          setPressed(true);
          (onPressIn as ((e: unknown) => void) | undefined)?.(e);
        },
        __onPressOut: (e: unknown) => {
          setPressed(false);
          (onPressOut as ((e: unknown) => void) | undefined)?.(e);
        },
        __onPress: onPress,
        __onLongPress: onLongPress,
      };

  return createElement(CnView, { ...rest, style: resolvedStyle, ...handlers }, resolvedChildren);
}

export function TouchableOpacity(props: TouchableOpacityProps): React.JSX.Element {
  const { style, children, activeOpacity = 0.2, ...rest } = props;
  const baseOpacity = useMemo(() => {
    const flat = flattenStyle(style as StyleProp<unknown>);
    return typeof flat.opacity === 'number' ? flat.opacity : 1;
  }, [style]);
  return createElement(
    Pressable,
    {
      ...rest,
      style: ({ pressed }: PressableStateCallbackType): StyleProp<ViewStyle> => [
        style,
        { opacity: pressed ? activeOpacity : baseOpacity },
      ],
    },
    children
  );
}

/** Typed here (not in ScrollViewProps) to keep the paging plumbing scoped to
 *  this file; the engine reads it off the scroll spec (scrollPhysics.ts). */
type PagingScrollViewProps = ScrollViewProps & {
  /** Snap releases to viewport-sized page boundaries (UIScrollView pagingEnabled). */
  pagingEnabled?: boolean;
};

export const ScrollView = React.forwardRef<ScrollViewHandle, PagingScrollViewProps>(function ScrollView(
  props: PagingScrollViewProps,
  ref
): React.JSX.Element {
  const {
    children,
    style,
    contentContainerStyle,
    horizontal = false,
    scrollEnabled = true,
    showsVerticalScrollIndicator = true,
    showsHorizontalScrollIndicator = true,
    decelerationRate = 'normal',
    bounces = true,
    pagingEnabled = false,
    scrollEventThrottle: _scrollEventThrottle, // engine emits per painted frame
    onScroll,
    onScrollBeginDrag,
    onScrollEndDrag,
    onMomentumScrollBegin,
    onMomentumScrollEnd,
    ...rest
  } = props;
  const hostRef = React.useRef<CNode | null>(null);
  React.useImperativeHandle(
    ref,
    () => ({
      scrollTo({ x = 0, y = 0, animated = true } = {}) {
        if (hostRef.current) scrollNodeTo(hostRef.current, x, y, animated);
      },
      scrollToEnd({ animated = true } = {}) {
        if (hostRef.current) scrollNodeToEnd(hostRef.current, animated);
      },
    }),
    []
  );
  const scrollSpec = {
    horizontal,
    enabled: scrollEnabled,
    bounces,
    pagingEnabled,
    decelerationRate,
    onScroll,
    onScrollBeginDrag,
    onScrollEndDrag,
    onMomentumScrollBegin,
    onMomentumScrollEnd,
    showsIndicator: horizontal ? showsHorizontalScrollIndicator : showsVerticalScrollIndicator,
  };
  return createElement(
    CnScroll,
    {
      ...rest,
      ref: hostRef,
      // RN ScrollView base style (Libraries/Components/ScrollView baseVertical/
      // baseHorizontal): grows into free space AND shrinks under constraint —
      // without flexShrink:1, a long list inside a justify-flex-end container
      // shoves its siblings off-screen (seen in template Screen presets).
      style: [{ flexGrow: 1, flexShrink: 1 }, style],
      __scroll: scrollSpec,
    },
    createElement(
      CnView,
      {
        style: [
          horizontal ? { flexDirection: 'row' as const } : null,
          { flexShrink: 0, alignSelf: horizontal ? ('flex-start' as const) : ('auto' as const) },
          contentContainerStyle,
        ],
        __scrollContent: true,
      },
      children
    )
  );
});

export function ActivityIndicator(props: {
  size?: 'small' | 'large' | number;
  color?: ColorValue;
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  const { size = 'small', color = '#999999', style } = props;
  const px = typeof size === 'number' ? size : size === 'large' ? 36 : 20;
  const rgba = parseColor(color) ?? { r: 153, g: 153, b: 153, a: 1 };
  return createElement(CnView, {
    style: [{ width: px, height: px }, style],
    __spinner: { size: px, color: rgba },
  });
}

/**
 * RN Image statics. getSize resolves through the engine's image cache (same
 * fetch+decode path paints use); resolveAssetSource mirrors RN's web shape.
 */
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Image {
  export function getSize(
    uri: string,
    success: (width: number, height: number) => void,
    failure?: (error: unknown) => void
  ): void {
    loadImage(uri, (entry) => {
      if (entry.status === 'loaded') success(entry.image.width(), entry.image.height());
      else if (entry.status === 'error') failure?.(new Error(entry.error));
    });
  }
  export function resolveAssetSource(source: unknown): { uri: string; width?: number; height?: number } | null {
    if (typeof source === 'string') return { uri: source };
    if (source && typeof source === 'object' && 'uri' in (source as object))
      return source as { uri: string };
    return null;
  }
  export function prefetch(uri: string): Promise<boolean> {
    return new Promise((resolve) => loadImage(uri, (e) => resolve(e.status === 'loaded')));
  }
}
