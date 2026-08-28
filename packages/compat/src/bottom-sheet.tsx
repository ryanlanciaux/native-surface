/**
 * Bottom-sheet compat — the modal sheet an Expo app reaches through the
 * local-module name registry:
 *
 *     const NativeView = requireNativeViewManager('BottomSheet')
 *     const NativeModule = requireNativeModule('BottomSheet')
 *
 * The NAME belongs to the app; the BEHAVIOR is boundary-general. So this ships
 * the implementation and a host wires it up in one line, the same way
 * `createSharedPrefsModule` and `createVisibilityViewComponent` are wired:
 *
 *     import { registerBottomSheet } from '@native-surface/compat/bottom-sheet'
 *     registerBottomSheet()              // or registerBottomSheet('MySheet')
 *
 * WHAT IT BRIDGES. On iOS the sheet is a UISheetPresentationController holding
 * a presented view controller; on Android a BottomSheetDialog in its own
 * window. Both put the sheet OUTSIDE the app's view hierarchy, and both drive
 * a detent model (a content-sized detent plus a full-height one) with an
 * interactive dismiss gesture. A canvas surface has exactly one window, so the
 * sheet here is an ordinary node tree: a surface-sized overlay with a very
 * high zIndex holding a dimmed backdrop and a bottom-anchored sheet, moved by
 * the engine's own Animated. This host paints its own frames — CSS transitions
 * cannot reach a canvas — so every motion below is an Animated value the
 * engine samples per painted frame.
 *
 * THE STATE MACHINE IS LOAD-BEARING. `onStateChange` drives the caller's
 * mount/unmount: BottomSheetNativeComponent renders null once it sees
 * 'closed'. A sheet that never emits 'closed' can never be closed, and one
 * that emits it early tears its own subtree down mid-animation. Hence
 * 'opening' on mount, 'open' when the present animation lands, 'closing' the
 * instant a dismissal starts, and 'closed' only when the dismiss animation
 * finishes.
 *
 * CEILINGS, stated plainly:
 *  - The overlay is an absolutely-positioned node sized from the surface, so
 *    it lands over the surface only while its parent's origin IS the surface
 *    origin. Apps portal their sheets near the root (this one does), where
 *    that holds. Same ceiling as the engine's Modal, and for the same reason:
 *    nothing on a canvas escapes its parent.
 *  - Content hugging is MEASURED out of a subtree this shim does not own (see
 *    `naturalSheetHeight`) and re-measured only when the sheet's OWN frame
 *    changes. Content that changes height without moving the sheet's frame is
 *    not re-detented: the native modules each needed a platform layout
 *    observer for that case (KVO on iOS, OnLayoutChangeListener on Android),
 *    and this host exposes no per-node layout observer to a shim that does not
 *    own the nodes.
 *  - Expanding to the full-height detent is recognized ON RELEASE, not
 *    followed with the finger. Growing the sheet is a Yoga height change;
 *    tracking a finger with it would relayout the caller's whole subtree every
 *    frame, where a released flick relayouts once. Dragging DOWN is fully
 *    interactive, which is the direction that dismisses.
 *  - `sourceViewTag` is accepted and ignored — it selects iOS 26's zoom
 *    transition out of a source view, which has no analogue here.
 *  - There is no grabber and no system bezel radius: an unset `cornerRadius`
 *    uses UIKit's default sheet radius rather than the device's.
 *  - The engine's PanResponder is single-touch, so a drag cannot be handed
 *    between fingers mid-gesture.
 */
import * as React from 'react';
import {
  Animated,
  Easing,
  PanResponder,
  Pressable,
  StyleSheet,
  useAnimatedValue,
  useWindowDimensions,
  View,
} from 'native-surface';
import type { ColorValue, PanResponderInstance, StyleProp, ViewStyle } from 'native-surface';
import { registerNativeModule, registerNativeView } from './expo-modules-core';

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

export type BottomSheetState = 'closed' | 'closing' | 'open' | 'opening';

/** The app declares this as a numeric enum; these are its members' values. */
export const BottomSheetSnapPoint = { Hidden: 0, Partial: 1, Full: 2 } as const;
export type BottomSheetSnapPoint = (typeof BottomSheetSnapPoint)[keyof typeof BottomSheetSnapPoint];

export interface BottomSheetAttemptDismissEvent {
  nativeEvent: Record<string, unknown>;
}
export interface BottomSheetSnapPointChangeEvent {
  nativeEvent: { snapPoint: BottomSheetSnapPoint };
}
export interface BottomSheetStateChangeEvent {
  nativeEvent: { state: BottomSheetState };
}

/** What `BottomSheetNativeComponent.dismiss()` reaches for through its ref. */
export interface BottomSheetViewHandle {
  dismiss(): void;
}

export interface BottomSheetViewProps {
  children?: React.ReactNode;
  /** Top corners only, like a presented sheet. */
  cornerRadius?: number;
  /** A dismissal is reported through onAttemptDismiss and then refused. */
  preventDismiss?: boolean;
  /** Removes the full-height detent: the sheet stays at its content height. */
  preventExpansion?: boolean;
  /** Fills the sheet's content area. */
  backgroundColor?: ColorValue;
  /** Paints the sheet box itself — what shows through the rounded corners. */
  containerBackgroundColor?: ColorValue;
  /** Toggled live by callers that own a scroll view inside the sheet. */
  disableDrag?: boolean;
  /** Accepted and ignored (see module doc). */
  sourceViewTag?: number;
  fullHeight?: boolean;
  minHeight?: number;
  maxHeight?: number;
  onAttemptDismiss?: (event: BottomSheetAttemptDismissEvent) => void;
  onSnapPointChange?: (event: BottomSheetSnapPointChangeEvent) => void;
  onStateChange?: (event: BottomSheetStateChangeEvent) => void;
  /**
   * The presentation box the caller sizes for the native view
   * (`{position:'absolute', height: screen - topInset, width:'100%'}`). Only
   * its `height` is read — it is the sheet's maximum extent. The rest
   * describes a box in the app's hierarchy that the native sheet never
   * actually occupies, and honoring it here would anchor the sheet to the top
   * of the surface.
   */
  style?: StyleProp<ViewStyle>;
  testID?: string;
  ref?: React.Ref<BottomSheetViewHandle>;
}

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** UIKit's default `preferredCornerRadius` for a form sheet. */
const DEFAULT_CORNER_RADIUS = 10;
const PRESENT_MS = 300;
const DISMISS_MS = 250;
const SNAP_MS = 220;
/** Standard system dimming for a presented sheet. */
const BACKDROP_COLOR = '#000000';
const BACKDROP_OPACITY = 0.4;
/** Above app content, and above the engine's Modal (9999): a presented sheet
 *  is the topmost UI on both platforms. Orders SIBLINGS only — see module doc. */
const SHEET_Z_INDEX = 10000;
/** Movement before the sheet claims the gesture from a press underneath it. */
const DRAG_SLOP_PX = 8;
/** Release velocity is projected forward this far to pick a detent (px/ms). */
const VELOCITY_PROJECTION_MS = 120;
/** Upward flick that expands regardless of how far the finger travelled (px/ms). */
const EXPAND_VELOCITY = 0.5;
/** ...or this much upward travel, for a drag too slow to have a velocity. */
const EXPAND_TRAVEL_PX = 48;
/** Fraction of the visible sheet that must be dragged away to dismiss... */
const DISMISS_TRAVEL_RATIO = 0.35;
/** ...but never less than this, so a short sheet is not trivially dismissed. */
const MIN_DISMISS_TRAVEL_PX = 64;
/** Sub-pixel layout noise must not read as a height change (see the loop guard). */
const EPSILON = 0.5;
/** Depth cap for the content-hugging descent; real sheets bottom out in ~4. */
const MEASURE_MAX_DEPTH = 32;

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

/**
 * The engine's layout node, as the reconciler hands it back through a host
 * ref. Typed STRUCTURALLY on purpose: a compat shim imports the engine by
 * package name only, and the node class is not part of that public surface.
 * This is the whole shape the measurement below reads.
 */
interface LayoutProbeNode {
  readonly frame: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly children: readonly LayoutProbeNode[];
  /** False for nodes with no box of their own (raw text inside a <Text>). */
  readonly participatesInYoga: boolean;
}

/**
 * The natural — content-hugging — height of the sheet's subtree.
 *
 * WHY THIS IS MEASURED RATHER THAN ASKED FOR. The caller's subtree is
 *
 *     <sheet>                     ← ours; needs a definite height
 *       <View style={flex:1} />   ← A: stretch wrapper carrying the background
 *         <View />                ← B: sized by the actual dialog content
 *
 * and under Yoga `flex: 1` means `flexBasis: 0`, so A contributes nothing to
 * an auto-height parent: give the sheet an automatic height and A — with
 * everything under it — collapses to zero. The sheet must therefore carry a
 * definite height, and the only place the content's own height exists is the
 * laid-out tree. Native solves it the same way: iOS reads
 * `innerView.subviews.first?.frame.height` and turns it into a custom detent.
 *
 * THE RULE. Descend while a node's only laid-out child is exactly `full` tall
 * — those are the stretch wrappers, whose height is the one the sheet imposed
 * on them. The first child that is NOT that tall is the one sized by its own
 * content, and its height is the answer. When the chain never breaks,
 * everything stretches (which is what `maxHeight` and `fullHeight` produce)
 * and the answer is the full height.
 *
 * WHY IT COMPARES AGAINST `full` AND NOT AGAINST THE PARENT. Comparing each
 * child to its parent looks equivalent and is not: the moment the sheet is
 * resized DOWN to the height this returned, every wrapper and the content node
 * all share that one height, and a parent-relative test walks straight past
 * the content node into its internals — returning the height of some button
 * inside the dialog, and then of something inside that. Measuring against the
 * sheet's full extent is what makes the answer a fixed point: once the sheet
 * has been resized, the first child is no longer `full` tall and the descent
 * stops there and reports the height it already has.
 *
 * THE CEILING. This is a shape heuristic over a subtree this shim does not
 * own, and it can only tell a stretch wrapper from a content box WHILE THE
 * SHEET IS AT ITS FULL EXTENT — which is how it mounts, and where the first
 * measurement therefore happens. A layout that puts two laid-out children in a
 * stretch wrapper stops the descent early and reports a taller sheet than the
 * content needs; zero-sized children (a portal outlet with nothing in it, a
 * conditionally-empty row) are skipped for that reason, since they are not
 * what gives a wrapper its height.
 */
function naturalSheetHeight(sheet: LayoutProbeNode, full: number): number {
  let node = sheet;
  for (let depth = 0; depth < MEASURE_MAX_DEPTH; depth++) {
    const laidOut = node.children.filter(
      (child) => child.participatesInYoga && (child.frame.width > 0 || child.frame.height > 0)
    );
    if (laidOut.length !== 1) break;
    const only = laidOut[0]!;
    if (Math.abs(only.frame.height - full) > EPSILON) return only.frame.height;
    node = only;
  }
  return node.frame.height;
}

/** The caller's presentation box height, when it is a resolvable number. */
function presentationHeight(style: StyleProp<ViewStyle>): number | null {
  const height = StyleSheet.flatten(style).height;
  return typeof height === 'number' && height > 0 ? height : null;
}

const clamp = (value: number, low: number, high: number): number => Math.min(Math.max(value, low), high);

// ---------------------------------------------------------------------------
// Mounted-sheet registry
// ---------------------------------------------------------------------------

interface SheetHandle {
  dismiss(): void;
}

/**
 * Keyed on globalThis for the reason spelled out in the expo-modules-core
 * registry: a bundler inlines a module into every prebundled dependency that
 * imports it, so module scope is not one scope. `dismissAll()` reached through
 * the app's copy must see the sheets mounted through the host's.
 */
const globalScope = globalThis as unknown as { __nativeSurfaceBottomSheets?: Set<SheetHandle> };
const mountedSheets: Set<SheetHandle> = (globalScope.__nativeSurfaceBottomSheets ??= new Set());

export interface BottomSheetModule {
  dismissAll(): Promise<void>;
}

/**
 * The module half of the contract. `dismissAll` STARTS every mounted sheet's
 * dismissal and resolves — it does not wait for the animations, matching the
 * native AsyncFunction, which returns as soon as SheetManager has told each
 * sheet to dismiss. Callers that need the teardown observe 'closed'.
 */
export function createBottomSheetModule(): BottomSheetModule {
  return {
    async dismissAll(): Promise<void> {
      // Snapshot: dismissing mutates the registry as sheets unmount.
      for (const sheet of [...mountedSheets]) sheet.dismiss();
    },
  };
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

interface PendingCommit {
  /** Added to the offset so the sheet's top edge survives the relayout. */
  delta: number;
  /** Runs once the new box is in the tree (see the layout effect). */
  then?: () => void;
}

interface SheetRuntime {
  /** Committed layout height of the sheet box. */
  height: number;
  /** Detent the box is sized to — a target, not the announced snap point. */
  detent: BottomSheetSnapPoint;
  /** Measured + clamped content height: the Partial detent. */
  natural: number;
  phase: BottomSheetState;
  /** Last snap point announced, so the same detent is not reported twice. */
  snap: BottomSheetSnapPoint;
  presented: boolean;
  dragging: boolean;
  /** Offset at the moment the current drag was granted. */
  dragBase: number;
  pending: PendingCommit | null;
}

export function BottomSheetView(props: BottomSheetViewProps): React.JSX.Element {
  const {
    children,
    cornerRadius = DEFAULT_CORNER_RADIUS,
    preventDismiss = false,
    preventExpansion = false,
    backgroundColor,
    containerBackgroundColor,
    disableDrag = false,
    fullHeight = false,
    minHeight,
    maxHeight,
    style,
    testID,
    ref,
  } = props;

  const surface = useWindowDimensions();
  /** The sheet's maximum extent: the caller's box, or the whole surface. */
  const fullSheetHeight = presentationHeight(style) ?? surface.height;

  const [layoutHeight, setLayoutHeight] = React.useState(fullSheetHeight);
  /**
   * Distance from the resting position, in px, downward-positive:
   *   sheetTop = surfaceBottom - layoutHeight + offset
   * One value carries the present/dismiss animations AND the drag, so a drag
   * that interrupts an animation simply continues from where it was.
   */
  const offset = useAnimatedValue(fullSheetHeight);

  const runtimeRef = React.useRef<SheetRuntime | null>(null);
  if (runtimeRef.current === null) {
    runtimeRef.current = {
      height: fullSheetHeight,
      detent: BottomSheetSnapPoint.Partial,
      natural: fullSheetHeight,
      phase: 'opening',
      snap: BottomSheetSnapPoint.Hidden,
      presented: false,
      dragging: false,
      dragBase: 0,
      pending: null,
    };
  }
  const runtime = runtimeRef.current;

  // Read by the imperative paths (gesture callbacks, animation completions) so
  // none of them has to be rebuilt when a parent re-renders with a fresh
  // inline callback — rebuilding the gesture mid-drag would drop it.
  const liveProps = {
    preventDismiss,
    preventExpansion,
    disableDrag,
    fullHeight,
    minHeight,
    maxHeight,
    fullSheetHeight,
    onAttemptDismiss: props.onAttemptDismiss,
    onSnapPointChange: props.onSnapPointChange,
    onStateChange: props.onStateChange,
  };
  const latest = React.useRef(liveProps);
  latest.current = liveProps;

  const sheetNode = React.useRef<LayoutProbeNode | null>(null);
  /** Stable, so the sheet's node is not detached and re-attached every render. */
  const setSheetNode = React.useCallback((node: unknown) => {
    sheetNode.current = node as LayoutProbeNode | null;
  }, []);
  const running = React.useRef<{ stop(): void } | null>(null);

  const currentOffset = (): number => offset.__getValue();

  const emitState = (next: BottomSheetState): void => {
    runtime.phase = next;
    latest.current.onStateChange?.({ nativeEvent: { state: next } });
  };

  /** Deduped like Android's `selectedSnapPoint`, so a re-settle at the same
   *  detent does not re-announce it (callers count Full transitions). */
  const emitSnapPoint = (next: BottomSheetSnapPoint): void => {
    if (runtime.snap === next) return;
    runtime.snap = next;
    latest.current.onSnapPointChange?.({ nativeEvent: { snapPoint: next } });
  };

  const animateOffset = (to: number, duration: number, easing: (t: number) => number, landed?: () => void): void => {
    running.current?.stop();
    const animation = Animated.timing(offset, { toValue: to, duration, easing, useNativeDriver: false });
    running.current = animation;
    animation.start(({ finished }) => {
      if (running.current === animation) running.current = null;
      // A stop() — an interrupting drag, an unmount — reports finished:false,
      // and must not run the completion that would emit 'closed' or a detent.
      if (finished) landed?.();
    });
  };

  /**
   * Commits a new layout height.
   *
   * `preserveTop` holds the sheet's top edge across the relayout: the sheet is
   * bottom-anchored, so `top = bottom - height + offset` and a height change
   * of Δ is cancelled by adding Δ to the offset. That compensation and `then`
   * both run in the layout effect below, which is after React has committed
   * the new height and before the engine's next flush — so the taller box and
   * its offset reach the same painted frame and nothing jumps.
   *
   * Returns whether anything changed; an unchanged height runs `then` at once.
   */
  const commitHeight = (next: number, preserveTop: boolean, then?: () => void): boolean => {
    const delta = next - runtime.height;
    if (Math.abs(delta) < EPSILON) {
      then?.();
      return false;
    }
    runtime.height = next;
    runtime.pending = { delta: preserveTop ? delta : 0, then };
    setLayoutHeight(next);
    return true;
  };

  React.useLayoutEffect(() => {
    const pending = runtime.pending;
    if (!pending) return;
    runtime.pending = null;
    // setValue stops any in-flight animation, which is why every caller either
    // has no animation running or starts one from `then`.
    if (pending.delta !== 0) offset.setValue(currentOffset() + pending.delta);
    pending.then?.();
    // Runs on the commit that carries the new height.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutHeight]);

  /** iOS clamps the measured content height into [minHeight, maxHeight], with
   *  maxHeight itself clamped to the screen. `fullHeight` skips the detent
   *  entirely and presents at .large(). */
  const clampNatural = (measured: number): number => {
    const l = latest.current;
    if (l.fullHeight) return l.fullSheetHeight;
    const upper = Math.min(l.maxHeight ?? l.fullSheetHeight, l.fullSheetHeight);
    return clamp(measured, Math.min(l.minHeight ?? 0, upper), upper);
  };

  /** Whether a full-height detent exists alongside the content one — the
   *  `.large()` companion iOS appends unless expansion is prevented. */
  const canExpand = (): boolean =>
    !latest.current.preventExpansion &&
    !latest.current.fullHeight &&
    runtime.natural < latest.current.fullSheetHeight - EPSILON;

  const detentHeight = (snap: BottomSheetSnapPoint): number =>
    snap === BottomSheetSnapPoint.Full ? latest.current.fullSheetHeight : runtime.natural;

  /**
   * The detent the sheet is sized to, which is NOT the last announced snap
   * point: a settle commits its height up front and announces the detent when
   * the motion lands, and a layout event arriving in between must not decide
   * the sheet belongs back at the height it just left.
   */
  const currentDetent = (): BottomSheetSnapPoint => runtime.detent;

  /**
   * Animates to a detent.
   *
   * Growing commits the taller box FIRST (the compensation holds the top edge,
   * so the frame that gains the height looks identical) and then slides the
   * extra height in. Shrinking has to animate first and commit after: a
   * bottom-anchored box that is already short cannot be translated upward
   * without opening a gap beneath it.
   */
  const settleTo = (snap: BottomSheetSnapPoint): void => {
    runtime.detent = snap;
    const target = detentHeight(snap);
    if (target > runtime.height + EPSILON) {
      commitHeight(target, true, () =>
        animateOffset(0, SNAP_MS, Easing.out(Easing.ease), () => emitSnapPoint(snap))
      );
      return;
    }
    animateOffset(runtime.height - target, SNAP_MS, Easing.out(Easing.ease), () => {
      commitHeight(target, true);
      emitSnapPoint(snap);
    });
  };

  const dismiss = (): void => {
    if (runtime.phase === 'closing' || runtime.phase === 'closed') return;
    emitState('closing');
    animateOffset(runtime.height, DISMISS_MS, Easing.in(Easing.ease), () => {
      emitSnapPoint(BottomSheetSnapPoint.Hidden);
      // Last: the caller unmounts this subtree the moment it lands.
      emitState('closed');
    });
  };

  /**
   * A user-initiated dismissal — the backdrop, or a drag past the threshold.
   * iOS reports the ATTEMPT and then decides:
   * `presentationControllerShouldDismiss` fires onAttemptDismiss and returns
   * `!preventDismiss`, so the event is not a refusal notice; a prevented sheet
   * simply settles back where it was.
   */
  const attemptDismiss = (): void => {
    if (runtime.phase === 'closing' || runtime.phase === 'closed') return;
    latest.current.onAttemptDismiss?.({ nativeEvent: {} });
    if (latest.current.preventDismiss) {
      settleTo(currentDetent());
      return;
    }
    dismiss();
  };

  const present = (): void => {
    if (runtime.presented) return;
    runtime.presented = true;
    offset.setValue(runtime.height);
    // iOS/Android both announce the detent as the presentation starts.
    emitSnapPoint(
      latest.current.fullHeight || runtime.natural >= latest.current.fullSheetHeight - EPSILON
        ? BottomSheetSnapPoint.Full
        : BottomSheetSnapPoint.Partial
    );
    animateOffset(0, PRESENT_MS, Easing.out(Easing.ease), () => {
      if (runtime.phase === 'opening') emitState('open');
    });
  };

  /**
   * The sheet's own layout event is the one post-layout hook a shim gets: it
   * fires after the engine has computed frames, which is exactly when the
   * subtree can be measured. It fires on mount, on every height this component
   * causes itself, and on surface resizes.
   */
  const onSheetLayout = (): void => {
    const node = sheetNode.current;
    if (!node || runtime.phase === 'closing' || runtime.phase === 'closed') return;
    runtime.natural = clampNatural(naturalSheetHeight(node, latest.current.fullSheetHeight));
    // Android defers layout updates raised mid-gesture (`pendingLayoutUpdate`)
    // rather than moving the sheet under the finger; so does this.
    if (runtime.dragging) return;
    // Re-detenting from content is not animated (the caller's content just
    // changed size); only user-driven snaps animate. `preserveTop: false`
    // keeps the sheet resting on the surface bottom.
    const changed = commitHeight(detentHeight(currentDetent()), false);
    // A committed height relayouts, which fires this again — settle there.
    if (changed) return;
    if (!runtime.presented) present();
    else if (runtime.natural >= latest.current.fullSheetHeight - EPSILON) emitSnapPoint(BottomSheetSnapPoint.Full);
  };

  // -------------------------------------------------------------------------
  // Drag
  // -------------------------------------------------------------------------

  const onDragStart = (): void => {
    running.current?.stop();
    runtime.dragging = true;
    runtime.dragBase = currentOffset();
  };

  const onDragMove = (dy: number): void => {
    // Clamped at 0: upward is the expand direction, and expansion is a taller
    // BOX, not a negative offset — a bottom-anchored sheet translated upward
    // would open a gap underneath it. The release picks the detent.
    offset.setValue(clamp(runtime.dragBase + dy, 0, runtime.height));
  };

  const onDragRelease = (dy: number, vy: number): void => {
    runtime.dragging = false;
    if (runtime.phase === 'closing' || runtime.phase === 'closed') return;
    const partialOffset = Math.max(0, runtime.height - runtime.natural);
    // Where the flick is heading, not just where it stopped — a short fast
    // swipe dismisses, a long slow one does not.
    const projected = currentOffset() + vy * VELOCITY_PROJECTION_MS;
    const dismissAt = partialOffset + Math.max(MIN_DISMISS_TRAVEL_PX, runtime.natural * DISMISS_TRAVEL_RATIO);
    if (projected >= dismissAt) {
      attemptDismiss();
      return;
    }
    // Past the midpoint between the two detents, or any upward intent at all:
    // expand. That intent is read from the GESTURE, not from the offset — the
    // offset is clamped at 0 going up, so it carries no evidence of an upward
    // drag. Everything else returns to the content detent.
    if (canExpand() && (projected < partialOffset / 2 || dy < -EXPAND_TRAVEL_PX || vy < -EXPAND_VELOCITY)) {
      settleTo(BottomSheetSnapPoint.Full);
      return;
    }
    settleTo(BottomSheetSnapPoint.Partial);
  };

  // The gesture is created once and calls through this ref, so the responder
  // always runs the current render's logic.
  const gestureImpl = React.useRef<{
    onDragStart(): void;
    onDragMove(dy: number): void;
    onDragRelease(dy: number, vy: number): void;
    shouldDrag(dx: number, dy: number): boolean;
  }>({ onDragStart, onDragMove, onDragRelease, shouldDrag: () => false });
  gestureImpl.current = {
    onDragStart,
    onDragMove,
    onDragRelease,
    shouldDrag: (dx: number, dy: number): boolean => {
      if (latest.current.disableDrag) return false;
      if (runtime.phase === 'closing' || runtime.phase === 'closed') return false;
      // Vertical intent only, past the slop — a horizontal swipe or a tap
      // belongs to whatever the sheet contains.
      return Math.abs(dy) > DRAG_SLOP_PX && Math.abs(dy) > Math.abs(dx);
    },
  };

  const gesture = React.useRef<PanResponderInstance | null>(null);
  if (gesture.current === null) {
    gesture.current = PanResponder.create({
      // Never claims at touch-down: a sheet full of buttons must stay pressable.
      onMoveShouldSetPanResponder: (_e, g) => gestureImpl.current.shouldDrag(g.dx, g.dy),
      onPanResponderGrant: () => gestureImpl.current.onDragStart(),
      onPanResponderMove: (_e, g) => gestureImpl.current.onDragMove(g.dy),
      onPanResponderRelease: (_e, g) => gestureImpl.current.onDragRelease(g.dy, g.vy),
      onPanResponderTerminate: () => gestureImpl.current.onDragRelease(0, 0),
    });
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  const dismissRef = React.useRef<() => void>(() => {});
  dismissRef.current = dismiss;

  React.useImperativeHandle(ref, () => ({ dismiss: () => dismissRef.current() }), []);

  const announced = React.useRef(false);
  React.useEffect(() => {
    const handle: SheetHandle = { dismiss: () => dismissRef.current() };
    mountedSheets.add(handle);
    // Guarded rather than run bare: StrictMode remounts effects, and the
    // native sheets announce 'opening' exactly once per presentation.
    if (!announced.current) {
      announced.current = true;
      emitState('opening');
    }
    return () => {
      mountedSheets.delete(handle);
      running.current?.stop();
    };
    // Mount/unmount only; everything inside reads refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const radius = Math.max(0, cornerRadius);
  /** Fades with the sheet, so a drag toward dismissal lightens the scrim. */
  const backdropOpacity = offset.interpolate({
    inputRange: [0, Math.max(EPSILON, layoutHeight)],
    outputRange: [BACKDROP_OPACITY, 0],
    extrapolate: 'clamp',
  });

  return (
    <View
      // Sized from the surface rather than inset to 0: an absolute box with
      // four insets takes its PARENT's size, and a portal outlet frequently
      // has none.
      style={{ position: 'absolute', left: 0, top: 0, width: surface.width, height: surface.height, zIndex: SHEET_Z_INDEX }}
      pointerEvents="box-none"
    >
      <Animated.View style={[StyleSheet.absoluteFillObject, { backgroundColor: BACKDROP_COLOR, opacity: backdropOpacity }]}>
        {/* The scrim paints; this takes the press. Presses on the sheet never
            reach it: the engine's hit path descends the visually topmost child
            only, so the sheet — a later sibling — swallows its own touches. */}
        <Pressable style={StyleSheet.absoluteFillObject} onPress={attemptDismiss} />
      </Animated.View>
      <Animated.View
        ref={setSheetNode}
        testID={testID}
        onLayout={onSheetLayout}
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: layoutHeight,
          backgroundColor: containerBackgroundColor ?? backgroundColor,
          borderTopLeftRadius: radius,
          borderTopRightRadius: radius,
          // Clips the caller's square-cornered background to the sheet's
          // rounded top, the way the presented view controller does.
          overflow: 'hidden',
          transform: [{ translateY: offset }],
        }}
        {...gesture.current.panHandlers}
      >
        {/* No separate presentation window exists here, so the sheet box IS
            the container and takes `containerBackgroundColor`. A distinct
            `backgroundColor` gets its own fill inside — and only then, so the
            usual case of setting one of the two stays a single node. */}
        {backgroundColor != null && backgroundColor !== containerBackgroundColor ? (
          <View style={{ flex: 1, backgroundColor }}>{children}</View>
        ) : (
          children
        )}
      </Animated.View>
    </View>
  );
}

BottomSheetView.displayName = 'BottomSheetView';

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Wires both halves of the contract under one name, so an app's
 * `requireNativeViewManager('BottomSheet')` and
 * `requireNativeModule('BottomSheet')` both resolve. Returns the module half
 * for a host that wants to call `dismissAll()` itself.
 */
export function registerBottomSheet(name = 'BottomSheet'): BottomSheetModule {
  registerNativeView(name, BottomSheetView as unknown as React.ComponentType<Record<string, unknown>>);
  return registerNativeModule(name, createBottomSheetModule());
}
