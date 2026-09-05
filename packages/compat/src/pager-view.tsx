/**
 * react-native-pager-view compat shim for the native-surface engine.
 *
 * A PagerView is an engine ScrollView with `pagingEnabled` (horizontal by
 * default, vertical via `orientation`) whose children are each wrapped in a
 * pager-sized page View. The pager measures itself with onLayout and sizes
 * every page to exactly one viewport, so the engine's page-snap physics
 * (native-surface engine/scrollPhysics.ts) land every release on a page
 * boundary.
 *
 * Event derivation — the engine's scroll spec emits onScroll /
 * onScrollBeginDrag / onScrollEndDrag / onMomentumScrollBegin /
 * onMomentumScrollEnd:
 * - onPageScroll from onScroll: position = leading page index, offset 0-1.
 * - onPageScrollStateChanged: beginDrag → 'dragging'; momentumBegin →
 *   'settling' (the engine announces page snaps AND animated programmatic
 *   scrolls on paging nodes as momentum); momentumEnd → 'idle'. A release
 *   resting exactly on a boundary starts no motion and emits no momentum
 *   events, so endDrag arms a microtask that settles to 'idle' when no
 *   momentum began (the engine starts release motion synchronously inside
 *   the same pointer dispatch, so the microtask observes the truth).
 * - onPageSelected: fired when motion ends with the offset resting on a page
 *   boundary (±1 px) and the page differs from the last selection. A
 *   momentum-end away from a boundary is an interrupted glide (finger catch,
 *   or setPage during settle) and selects nothing.
 *
 * Prop coverage notes:
 * - offscreenPageLimit: ignored — every page stays mounted (the canvas engine
 *   paints only what is visible; there is no native view inflation to limit).
 * - overdrag: mapped to ScrollView `bounces` (default false = hard clamp at
 *   the first/last page, matching the package default).
 * - layoutDirection: ignored — the engine lays out LTR only.
 * - keyboardDismissMode: ignored — no soft keyboard in the canvas engine.
 */
import * as React from 'react';
import { ScrollView, View } from 'native-surface';
import type { LayoutChangeEvent, ScrollEvent, StyleProp, ViewStyle } from 'native-surface';

export type PageScrollState = 'idle' | 'dragging' | 'settling';

export interface PagerViewOnPageSelectedEvent {
  nativeEvent: { position: number };
}

export interface PagerViewOnPageScrollEvent {
  nativeEvent: { position: number; offset: number };
}

export interface PageScrollStateChangedNativeEvent {
  nativeEvent: { pageScrollState: PageScrollState };
}

export interface PagerViewProps {
  /** One element per page; keys follow the package contract (keyed children). */
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  initialPage?: number;
  scrollEnabled?: boolean;
  orientation?: 'horizontal' | 'vertical';
  /** Ignored: every page stays mounted (see module doc). */
  offscreenPageLimit?: number;
  /** Rubber-band past the first/last page (maps to ScrollView bounces). */
  overdrag?: boolean;
  /** Ignored: the engine lays out LTR only. */
  layoutDirection?: 'ltr' | 'rtl' | 'locale';
  /** Ignored: no soft keyboard in the canvas engine. */
  keyboardDismissMode?: 'none' | 'on-drag';
  onPageSelected?: (e: PagerViewOnPageSelectedEvent) => void;
  onPageScroll?: (e: PagerViewOnPageScrollEvent) => void;
  onPageScrollStateChanged?: (e: PageScrollStateChangedNativeEvent) => void;
  testID?: string;
}

export interface PagerViewHandle {
  setPage(index: number): void;
  setPageWithoutAnimation(index: number): void;
  setScrollEnabled(enabled: boolean): void;
}

/** Offsets within this distance of an exact boundary count as resting on it. */
const BOUNDARY_EPSILON = 1;

interface PagerBook {
  state: PageScrollState;
  /** Last position handed to onPageSelected (-1 before the initial dispatch). */
  selected: number;
  /** Latest scrolled-axis content offset seen via onScroll. */
  offset: number;
  /** Page to land on once pages exist at a measured size; -1 when applied. */
  pending: number;
  /** Page size the current offset was aligned against (resize detection). */
  appliedDim: number;
}

export const PagerView = React.forwardRef<PagerViewHandle, PagerViewProps>(function PagerView(
  props,
  ref
): React.JSX.Element {
  const {
    children,
    style,
    initialPage = 0,
    scrollEnabled = true,
    orientation = 'horizontal',
    overdrag = false,
    onPageSelected,
    onPageScroll,
    onPageScrollStateChanged,
    testID,
  } = props;
  const horizontal = orientation !== 'vertical';
  const [size, setSize] = React.useState<{ width: number; height: number } | null>(null);
  const [scrollEnabledOverride, setScrollEnabledOverride] = React.useState<boolean | null>(null);
  const scrollRef = React.useRef<React.ComponentRef<typeof ScrollView> | null>(null);

  const pageElements = React.Children.toArray(children).filter(React.isValidElement);
  const pageCount = pageElements.length;
  const dim = size ? (horizontal ? size.width : size.height) : 0;

  const st = React.useRef<PagerBook>({
    state: 'idle',
    selected: -1,
    offset: 0,
    pending: Math.max(0, Math.floor(initialPage)),
    appliedDim: 0,
  });

  const emitState = (next: PageScrollState): void => {
    if (st.current.state === next) return;
    st.current.state = next;
    onPageScrollStateChanged?.({ nativeEvent: { pageScrollState: next } });
  };

  const selectFromOffset = (): void => {
    if (dim <= 0 || pageCount === 0) return;
    const off = st.current.offset;
    const page = Math.min(pageCount - 1, Math.max(0, Math.round(off / dim)));
    if (Math.abs(off - page * dim) > BOUNDARY_EPSILON) return; // interrupted mid-glide
    if (page === st.current.selected) return;
    st.current.selected = page;
    onPageSelected?.({ nativeEvent: { position: page } });
  };

  const scrollToOffset = (target: number, animated: boolean): void => {
    scrollRef.current?.scrollTo({
      x: horizontal ? target : 0,
      y: horizontal ? 0 : target,
      animated,
    });
  };

  const jumpTo = (index: number, animated: boolean): void => {
    const page = Math.min(Math.max(0, Math.floor(index)), Math.max(0, pageCount - 1));
    if (dim <= 0) {
      st.current.pending = page; // pages not measurable yet: land there on first layout
      return;
    }
    scrollToOffset(page * dim, animated);
    if (animated) return; // the snap's momentum-end drives selection + 'idle'
    selectFromOffset();
    emitState('idle');
  };

  React.useImperativeHandle(ref, () => ({
    setPage: (index: number) => jumpTo(index, true),
    setPageWithoutAnimation: (index: number) => jumpTo(index, false),
    setScrollEnabled: (enabled: boolean) => setScrollEnabledOverride(enabled),
  }));

  const handleLayout = (e: LayoutChangeEvent): void => {
    const { width, height } = e.nativeEvent.layout;
    setSize((prev) => (prev && prev.width === width && prev.height === height ? prev : { width, height }));
  };

  /** On the first page's layout: pages now exist at the measured size (the
   *  engine syncs content size before firing layout events, so scrollTo
   *  clamps against fresh bounds). Apply the initial/pending jump, or keep
   *  the selected page aligned after a pager resize. */
  const handleFirstPageLayout = (): void => {
    if (dim <= 0) return;
    if (st.current.pending >= 0) {
      const page = Math.min(st.current.pending, Math.max(0, pageCount - 1));
      st.current.pending = -1;
      st.current.appliedDim = dim;
      if (page > 0) scrollToOffset(page * dim, false);
      // ViewPager dispatches an initial onPageSelected for the starting page
      st.current.offset = page * dim;
      selectFromOffset();
      return;
    }
    if (st.current.appliedDim !== dim && st.current.selected >= 0) {
      st.current.appliedDim = dim;
      scrollToOffset(st.current.selected * dim, false);
    }
  };

  const handleScroll = (e: ScrollEvent): void => {
    const off = horizontal ? e.nativeEvent.contentOffset.x : e.nativeEvent.contentOffset.y;
    st.current.offset = off;
    if (dim <= 0 || pageCount === 0) return;
    const clamped = Math.min((pageCount - 1) * dim, Math.max(0, off));
    const position = Math.min(pageCount - 1, Math.floor(clamped / dim));
    onPageScroll?.({ nativeEvent: { position, offset: clamped / dim - position } });
  };

  const handleEndDrag = (): void => {
    // The engine starts the page snap synchronously right after this callback;
    // when none started (released resting on a boundary) no momentum events
    // will follow — settle now.
    queueMicrotask(() => {
      if (st.current.state !== 'dragging') return;
      selectFromOffset();
      emitState('idle');
    });
  };

  const handleMomentumEnd = (): void => {
    selectFromOffset();
    emitState('idle');
  };

  return (
    <View style={style} onLayout={handleLayout} testID={testID}>
      {size && pageCount > 0 ? (
        <ScrollView
          ref={scrollRef}
          horizontal={horizontal}
          pagingEnabled
          bounces={overdrag}
          scrollEnabled={scrollEnabledOverride ?? scrollEnabled}
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          onScroll={handleScroll}
          onScrollBeginDrag={() => emitState('dragging')}
          onScrollEndDrag={handleEndDrag}
          onMomentumScrollBegin={() => emitState('settling')}
          onMomentumScrollEnd={handleMomentumEnd}
        >
          {pageElements.map((child, i) => {
            const pageStyle = { width: size.width, height: size.height };
            return (
              <View
                key={child.key ?? i}
                style={pageStyle}
                onLayout={i === 0 ? handleFirstPageLayout : undefined}
              >
                {React.cloneElement(child as React.ReactElement<{ style?: StyleProp<ViewStyle> }>, {
                  style: [(child.props as { style?: StyleProp<ViewStyle> }).style, pageStyle],
                })}
              </View>
            );
          })}
        </ScrollView>
      ) : null}
    </View>
  );
});

export default PagerView;
