/**
 * FlatList / SectionList / VirtualizedList — ScrollView-backed list components.
 *
 * Boundary-general implementation of RN's documented list API subset
 * (docs/compat-strategy.md): data/sections, renderItem, keyExtractor,
 * separators, header/footer/empty components, contentContainerStyle,
 * horizontal, onEndReached, refreshing/onRefresh (accepted; no pull gesture),
 * extraData (re-render trigger), scrollEnabled and other ScrollView props
 * passed through.
 *
 * NOT virtualized: every item renders. Fine at demo/playground scale; window
 * virtualization is a later, transparent optimization (tracked in API.md).
 */
import * as React from 'react';
import { ScrollView } from './primitives';
import { View } from './primitives';
import type { LayoutChangeEvent, ScrollViewHandle, ScrollViewProps, StyleProp, ViewStyle } from '../types';

export interface ListRenderItemInfo<ItemT> {
  item: ItemT;
  index: number;
  separators: {
    highlight: () => void;
    unhighlight: () => void;
    updateProps: (select: 'leading' | 'trailing', newProps: object) => void;
  };
}

export type ListRenderItem<ItemT> = (info: ListRenderItemInfo<ItemT>) => React.ReactElement | null;

type ComponentOrElement = React.ComponentType<unknown> | React.ReactElement | null | undefined;

function renderComponentOrElement(c: ComponentOrElement): React.ReactNode {
  if (c == null) return null;
  if (React.isValidElement(c)) return c;
  const C = c as React.ComponentType<unknown>;
  return <C />;
}

const NOOP_SEPARATORS: ListRenderItemInfo<unknown>['separators'] = {
  highlight: () => {},
  unhighlight: () => {},
  updateProps: () => {},
};

export interface FlatListProps<ItemT> extends Omit<ScrollViewProps, 'children'> {
  data: ReadonlyArray<ItemT> | null | undefined;
  renderItem: ListRenderItem<ItemT> | null | undefined;
  keyExtractor?: (item: ItemT, index: number) => string;
  ItemSeparatorComponent?: React.ComponentType<{ highlighted?: boolean }> | null;
  ListHeaderComponent?: ComponentOrElement;
  ListFooterComponent?: ComponentOrElement;
  ListEmptyComponent?: ComponentOrElement;
  ListHeaderComponentStyle?: StyleProp<ViewStyle>;
  ListFooterComponentStyle?: StyleProp<ViewStyle>;
  columnWrapperStyle?: StyleProp<ViewStyle>;
  numColumns?: number;
  extraData?: unknown;
  inverted?: boolean;
  initialNumToRender?: number; // accepted; everything renders
  maxToRenderPerBatch?: number; // accepted
  windowSize?: number; // accepted
  removeClippedSubviews?: boolean; // accepted
  refreshing?: boolean | null;
  onRefresh?: (() => void) | null;
  onEndReached?: ((info: { distanceFromEnd: number }) => void) | null;
  onEndReachedThreshold?: number | null;
  getItemLayout?: (data: unknown, index: number) => { length: number; offset: number; index: number };
}

function defaultKey<ItemT>(item: ItemT, index: number): string {
  const it = item as { key?: string; id?: string | number } | null;
  if (it && typeof it === 'object') {
    if (typeof it.key === 'string') return it.key;
    if (it.id != null) return String(it.id);
  }
  return String(index);
}

interface EndReachedState {
  fired: boolean;
}

function useEndReached(
  onEndReached: FlatListProps<unknown>['onEndReached'],
  threshold: number | null | undefined,
  horizontal: boolean | undefined | null,
  onScrollProp: ScrollViewProps['onScroll']
): ScrollViewProps['onScroll'] {
  const state = React.useRef<EndReachedState>({ fired: false });
  return React.useCallback<NonNullable<ScrollViewProps['onScroll']>>(
    (e) => {
      onScrollProp?.(e);
      if (!onEndReached) return;
      const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
      const offset = horizontal ? contentOffset.x : contentOffset.y;
      const visible = horizontal ? layoutMeasurement.width : layoutMeasurement.height;
      const content = horizontal ? contentSize.width : contentSize.height;
      const distanceFromEnd = content - visible - offset;
      const t = (threshold ?? 2) * visible;
      if (distanceFromEnd <= t) {
        if (!state.current.fired) {
          state.current.fired = true;
          onEndReached({ distanceFromEnd });
        }
      } else {
        state.current.fired = false;
      }
    },
    [onEndReached, threshold, horizontal, onScrollProp]
  );
}

export interface FlatListHandle extends ScrollViewHandle {
  scrollToOffset(params: { offset: number; animated?: boolean }): void;
}

function FlatListInner<ItemT>(
  props: FlatListProps<ItemT>,
  ref: React.ForwardedRef<FlatListHandle>
): React.ReactElement {
  const {
    data,
    renderItem,
    keyExtractor,
    ItemSeparatorComponent,
    ListHeaderComponent,
    ListFooterComponent,
    ListEmptyComponent,
    ListHeaderComponentStyle,
    ListFooterComponentStyle,
    columnWrapperStyle,
    numColumns = 1,
    extraData: _extraData,
    inverted,
    initialNumToRender: _i,
    maxToRenderPerBatch: _m,
    windowSize: _w,
    removeClippedSubviews: _r,
    refreshing: _refreshing,
    onRefresh: _onRefresh,
    onEndReached,
    onEndReachedThreshold,
    getItemLayout: _g,
    onScroll,
    horizontal,
    contentContainerStyle,
    ...scrollProps
  } = props;

  const items = React.useMemo(() => (data ? Array.from(data) : []), [data]);
  const key = keyExtractor ?? defaultKey;
  const scrollRef = React.useRef<ScrollViewHandle | null>(null);
  React.useImperativeHandle(
    ref,
    () => ({
      scrollTo: (opts) => scrollRef.current?.scrollTo(opts),
      scrollToEnd: (opts) => scrollRef.current?.scrollToEnd(opts),
      scrollToOffset({ offset, animated = true }) {
        scrollRef.current?.scrollTo(horizontal ? { x: offset, animated } : { y: offset, animated });
      },
    }),
    [horizontal]
  );
  const handleScroll = useEndReached(
    onEndReached as FlatListProps<unknown>['onEndReached'],
    onEndReachedThreshold,
    horizontal,
    onScroll
  );

  const children: React.ReactNode[] = [];
  if (items.length === 0) {
    children.push(
      <React.Fragment key="__empty">{renderComponentOrElement(ListEmptyComponent)}</React.Fragment>
    );
  } else if (numColumns > 1) {
    for (let row = 0; row * numColumns < items.length; row++) {
      const rowItems = items.slice(row * numColumns, (row + 1) * numColumns);
      children.push(
        <View key={`__row_${row}`} style={[{ flexDirection: 'row' }, columnWrapperStyle]}>
          {rowItems.map((item, i) => {
            const index = row * numColumns + i;
            return (
              <React.Fragment key={key(item, index)}>
                {renderItem?.({ item, index, separators: NOOP_SEPARATORS }) ?? null}
              </React.Fragment>
            );
          })}
        </View>
      );
    }
  } else {
    items.forEach((item, index) => {
      children.push(
        <React.Fragment key={key(item, index)}>
          {renderItem?.({ item, index, separators: NOOP_SEPARATORS }) ?? null}
          {ItemSeparatorComponent && index < items.length - 1 ? <ItemSeparatorComponent /> : null}
        </React.Fragment>
      );
    });
  }
  if (inverted) children.reverse();

  return (
    <ScrollView
      ref={scrollRef}
      horizontal={horizontal}
      contentContainerStyle={contentContainerStyle}
      onScroll={handleScroll}
      {...scrollProps}
    >
      {ListHeaderComponent != null && (
        <View style={ListHeaderComponentStyle}>{renderComponentOrElement(ListHeaderComponent)}</View>
      )}
      {children}
      {ListFooterComponent != null && (
        <View style={ListFooterComponentStyle}>{renderComponentOrElement(ListFooterComponent)}</View>
      )}
    </ScrollView>
  );
}

export const FlatList = React.forwardRef(FlatListInner) as <ItemT>(
  props: FlatListProps<ItemT> & { ref?: React.Ref<FlatListHandle> }
) => React.ReactElement;

// ---------------------------------------------------------------------------
// SectionList
// ---------------------------------------------------------------------------

export interface SectionBase<ItemT> {
  data: ReadonlyArray<ItemT>;
  key?: string;
  title?: string;
  renderItem?: ListRenderItem<ItemT>;
  ItemSeparatorComponent?: React.ComponentType | null;
  keyExtractor?: (item: ItemT, index: number) => string;
}

export type SectionListData<ItemT, SectionT = Record<string, unknown>> = SectionBase<ItemT> & SectionT;

export interface SectionListRenderItemInfo<ItemT, SectionT = Record<string, unknown>>
  extends ListRenderItemInfo<ItemT> {
  section: SectionListData<ItemT, SectionT>;
}

export interface SectionListHandle {
  scrollToLocation(params: {
    sectionIndex: number;
    itemIndex: number;
    viewPosition?: number;
    viewOffset?: number;
    animated?: boolean;
  }): void;
  getScrollResponder(): ScrollViewHandle | null;
  scrollTo?: ScrollViewHandle['scrollTo'];
}

export interface SectionListProps<ItemT, SectionT = Record<string, unknown>>
  extends Omit<ScrollViewProps, 'children'> {
  sections: ReadonlyArray<SectionListData<ItemT, SectionT>>;
  /** RN SectionList API: render a custom scroll container (receives scroll props + children). */
  renderScrollComponent?: (props: ScrollViewProps & { children?: React.ReactNode }) => React.ReactNode;
  onScrollToIndexFailed?: (info: {
    index: number;
    highestMeasuredFrameIndex: number;
    averageItemLength: number;
  }) => void;
  renderItem?: (info: SectionListRenderItemInfo<ItemT, SectionT>) => React.ReactElement | null;
  renderSectionHeader?: (info: { section: SectionListData<ItemT, SectionT> }) => React.ReactElement | null;
  renderSectionFooter?: (info: { section: SectionListData<ItemT, SectionT> }) => React.ReactElement | null;
  keyExtractor?: (item: ItemT, index: number) => string;
  ItemSeparatorComponent?: React.ComponentType | null;
  SectionSeparatorComponent?: React.ComponentType | null;
  ListHeaderComponent?: ComponentOrElement;
  ListFooterComponent?: ComponentOrElement;
  ListEmptyComponent?: ComponentOrElement;
  extraData?: unknown;
  stickySectionHeadersEnabled?: boolean; // accepted; headers scroll with content
  onEndReached?: ((info: { distanceFromEnd: number }) => void) | null;
  onEndReachedThreshold?: number | null;
}

function SectionListInner<ItemT, SectionT>(
  props: SectionListProps<ItemT, SectionT>,
  ref: React.ForwardedRef<SectionListHandle>
): React.ReactElement {
  const {
    sections,
    renderItem,
    renderSectionHeader,
    renderSectionFooter,
    renderScrollComponent,
    onScrollToIndexFailed: _onScrollToIndexFailed,
    keyExtractor,
    ItemSeparatorComponent,
    SectionSeparatorComponent,
    ListHeaderComponent,
    ListFooterComponent,
    ListEmptyComponent,
    extraData: _extraData,
    stickySectionHeadersEnabled: _sticky,
    onEndReached,
    onEndReachedThreshold,
    onScroll,
    horizontal,
    contentContainerStyle,
    ...scrollProps
  } = props;

  const key = keyExtractor ?? defaultKey;
  const scrollRef = React.useRef<ScrollViewHandle | null>(null);
  const viewportRef = React.useRef({ width: 0, height: 0 });
  /** y-offset of each section header / item within the scroll content. */
  const offsetsRef = React.useRef(new Map<string, number>());
  const trackLayout = (mapKey: string) => (e: LayoutChangeEvent) => {
    offsetsRef.current.set(mapKey, horizontal ? e.nativeEvent.layout.x : e.nativeEvent.layout.y);
  };

  React.useImperativeHandle(
    ref,
    () => ({
      scrollToLocation({ sectionIndex, itemIndex, viewPosition = 0, viewOffset = 0, animated = true }) {
        // RN semantics: itemIndex 0 targets the section header; >=1 the items.
        const target =
          itemIndex <= 0
            ? offsetsRef.current.get(`h${sectionIndex}`)
            : (offsetsRef.current.get(`i${sectionIndex}:${itemIndex - 1}`) ??
              offsetsRef.current.get(`h${sectionIndex}`));
        if (target == null) return;
        const viewport = horizontal ? viewportRef.current.width : viewportRef.current.height;
        const y = Math.max(0, target - viewOffset - viewPosition * viewport);
        scrollRef.current?.scrollTo(horizontal ? { x: y, animated } : { y, animated });
      },
      getScrollResponder: () => scrollRef.current,
      scrollTo: (opts) => scrollRef.current?.scrollTo(opts),
    }),
    [horizontal]
  );

  const handleScroll = useEndReached(
    onEndReached as FlatListProps<unknown>['onEndReached'],
    onEndReachedThreshold,
    horizontal,
    onScroll
  );

  const isEmpty = sections.every((s) => s.data.length === 0);

  const content: React.ReactNode = (
    <>
      {ListHeaderComponent != null && renderComponentOrElement(ListHeaderComponent)}
      {isEmpty
        ? renderComponentOrElement(ListEmptyComponent)
        : sections.map((section, sIndex) => {
            const sectionKey = section.key ?? section.title ?? String(sIndex);
            const itemRenderer = section.renderItem ?? renderItem;
            const itemKey = section.keyExtractor ?? key;
            const Sep = section.ItemSeparatorComponent ?? ItemSeparatorComponent;
            return (
              <React.Fragment key={sectionKey}>
                <View onLayout={trackLayout(`h${sIndex}`)}>
                  {renderSectionHeader?.({ section }) ?? null}
                </View>
                {section.data.map((item, index) => (
                  <React.Fragment key={itemKey(item, index)}>
                    <View onLayout={trackLayout(`i${sIndex}:${index}`)}>
                      {itemRenderer?.({ item, index, section, separators: NOOP_SEPARATORS }) ?? null}
                    </View>
                    {Sep && index < section.data.length - 1 ? <Sep /> : null}
                  </React.Fragment>
                ))}
                {renderSectionFooter?.({ section }) ?? null}
                {SectionSeparatorComponent && sIndex < sections.length - 1 ? (
                  <SectionSeparatorComponent />
                ) : null}
              </React.Fragment>
            );
          })}
      {ListFooterComponent != null && renderComponentOrElement(ListFooterComponent)}
    </>
  );

  const scrollElementProps = {
    horizontal,
    contentContainerStyle,
    onScroll: handleScroll,
    onLayout: (e: LayoutChangeEvent) => {
      viewportRef.current = {
        width: e.nativeEvent.layout.width,
        height: e.nativeEvent.layout.height,
      };
      (scrollProps as { onLayout?: (e: LayoutChangeEvent) => void }).onLayout?.(e);
    },
    ...scrollProps,
  };

  if (renderScrollComponent) {
    const el = renderScrollComponent({ ...scrollElementProps, children: content });
    if (React.isValidElement(el)) {
      return React.cloneElement(el as React.ReactElement<Record<string, unknown>>, {
        ref: scrollRef,
      } as Record<string, unknown>);
    }
  }

  return (
    <ScrollView ref={scrollRef} {...scrollElementProps}>
      {content}
    </ScrollView>
  );
}

export const SectionList = React.forwardRef(SectionListInner) as <ItemT, SectionT = Record<string, unknown>>(
  props: SectionListProps<ItemT, SectionT> & { ref?: React.Ref<SectionListHandle> }
) => React.ReactElement;

/** RN exports VirtualizedList as the FlatList base; here they are the same. */
export const VirtualizedList = FlatList;
