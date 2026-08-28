/**
 * PanResponder — RN's gesture-negotiation helper, wired to the engine's real
 * pointer stream.
 *
 * WHAT IT IS ON RN: PanResponder turns a config of `onPanResponder*` callbacks
 * into a bag of RESPONDER PROPS (`panHandlers`) that you spread onto a View.
 * RN's responder system then negotiates, per touch, which view owns the
 * gesture, and calls back with a mutable `gestureState`.
 *
 * WHAT IT IS HERE: this host has no responder negotiation system. It has one
 * pointer pipeline (engine/events.ts) that hands the raw down/move/up/cancel
 * stream to the deepest node carrying the internal `__panHandler` prop, and
 * arbitrates that node against press and scroll. So `panHandlers` carries BOTH
 * the RN-named responder props AND `__panHandler` — spreading it onto a View,
 * exactly as RN code already does, is what connects the gesture:
 *
 *     <View {...panResponder.panHandlers} />       // works, unchanged
 *     <View onResponderMove={h.onResponderMove} /> // does NOT: __panHandler lost
 *
 * The RN-named props are real delegating functions (so code that inspects or
 * invokes them directly still works), but the engine never calls them.
 *
 * WHAT IS FAITHFUL:
 *   - Grant negotiation: onStartShouldSetPanResponder{,Capture} decide at
 *     touch-down, onMoveShouldSetPanResponder{,Capture} on any later move —
 *     including the RN behavior everyone trips on, where dx/dy accumulate from
 *     the touch start while deciding and RESET to 0 at grant, so a gesture
 *     granted mid-drag measures translation from the activation point.
 *   - Grant / Move / Release / Terminate callbacks and their ordering
 *     (Start after a grant that came from the touch itself; End before
 *     Release).
 *   - gestureState fields and units: dx/dy in px from the grant point, vx/vy in
 *     px per MILLISECOND (RN's unit — not RNGH's px/s), moveX/moveY the current
 *     pointer position in surface coordinates. vx/vy are estimated over a
 *     recency window rather than RN's last-two-samples derivative — see the
 *     velocity constants for why a browser pointer stream forces that.
 *   - A granted responder wins the gesture: press cancels, an ancestor
 *     ScrollView does not scroll.
 *
 * WHAT IS NOT, precisely:
 *   - Single pointer only. numberActiveTouches is 1 while down and 0 after
 *     release; it never reaches 2, so pinch/rotate gestures built on
 *     PanResponder cannot work here.
 *   - locationX/locationY equal pageX/pageY. The engine's pan seam carries
 *     surface coordinates only, so there is no node-local origin to subtract.
 *   - Only the DEEPEST node with panHandlers in the hit path receives a given
 *     gesture; nested PanResponders do not both see it, and there is no
 *     capture/bubble walk across separate nodes (the Capture variants are
 *     consulted before their non-capture twins on the SAME node).
 *   - onPanResponderReject never fires: the engine has no third party that can
 *     deny a claim. onPanResponderTerminationRequest and
 *     onShouldBlockNativeResponder are accepted and never consulted — a
 *     pointercancel terminates unconditionally, it is not negotiable.
 *   - A nested Pressable still receives onPressIn on the touch-down of a
 *     gesture this responder grants at start; the press is cancelled at the
 *     first move rather than never firing.
 */
import type { PanHandler, PanStreamEvent } from '../engine/events';

/** RN's mutable gesture record. The SAME object is passed to every callback of
 *  a given responder — read it, don't retain it. */
export interface PanResponderGestureState {
  /** Identity of this responder instance (RN assigns it once, at create). */
  stateID: number;
  /** Latest pointer position; 0 until the first move (RN semantics). */
  moveX: number;
  moveY: number;
  /** Pointer position at grant; 0 before the responder is granted. */
  x0: number;
  y0: number;
  /** Translation since grant (since touch-down while still deciding). */
  dx: number;
  dy: number;
  /** Velocity in px/ms, over the last ~100ms of pointer samples. */
  vx: number;
  vy: number;
  /** 1 while a pointer is down, 0 otherwise (this host is single-touch). */
  numberActiveTouches: number;
  /** RN-internal bookkeeping field, present so the shape matches exactly. */
  _accountsForMovesUpTo: number;
}

export interface PanResponderTouch {
  identifier: number;
  locationX: number;
  locationY: number;
  pageX: number;
  pageY: number;
  timestamp: number;
}

export interface PanResponderEvent {
  nativeEvent: PanResponderTouch & {
    changedTouches: PanResponderTouch[];
    touches: PanResponderTouch[];
    target: null;
  };
}

export type PanResponderShouldSet = (event: PanResponderEvent, gestureState: PanResponderGestureState) => boolean;
export type PanResponderCallback = (event: PanResponderEvent, gestureState: PanResponderGestureState) => void;

export interface PanResponderCallbacks {
  onStartShouldSetPanResponder?: PanResponderShouldSet;
  onStartShouldSetPanResponderCapture?: PanResponderShouldSet;
  onMoveShouldSetPanResponder?: PanResponderShouldSet;
  onMoveShouldSetPanResponderCapture?: PanResponderShouldSet;
  onPanResponderGrant?: PanResponderCallback;
  onPanResponderStart?: PanResponderCallback;
  onPanResponderMove?: PanResponderCallback;
  onPanResponderEnd?: PanResponderCallback;
  onPanResponderRelease?: PanResponderCallback;
  onPanResponderTerminate?: PanResponderCallback;
  /** Accepted; never consulted here (see module doc). */
  onPanResponderTerminationRequest?: PanResponderShouldSet;
  /** Accepted; never fires here (see module doc). */
  onPanResponderReject?: PanResponderCallback;
  /** Android-only in RN; accepted and inert. */
  onShouldBlockNativeResponder?: PanResponderShouldSet;
}

/** The props bag spread onto a View. `__panHandler` is what actually connects
 *  the gesture on this host; the rest are RN's responder props. */
export interface PanResponderHandlers {
  onStartShouldSetResponder: (event: PanResponderEvent) => boolean;
  onStartShouldSetResponderCapture: (event: PanResponderEvent) => boolean;
  onMoveShouldSetResponder: (event: PanResponderEvent) => boolean;
  onMoveShouldSetResponderCapture: (event: PanResponderEvent) => boolean;
  onResponderGrant: (event: PanResponderEvent) => void;
  onResponderStart: (event: PanResponderEvent) => void;
  onResponderMove: (event: PanResponderEvent) => void;
  onResponderEnd: (event: PanResponderEvent) => void;
  onResponderRelease: (event: PanResponderEvent) => void;
  onResponderTerminate: (event: PanResponderEvent) => void;
  onResponderTerminationRequest: (event: PanResponderEvent) => boolean;
  onResponderReject: (event: PanResponderEvent) => void;
  /** Engine seam (see engine/events.ts) — the prop the pointer pipeline reads. */
  __panHandler: PanHandler;
}

export interface PanResponderInstance {
  panHandlers: PanResponderHandlers;
  /** RN returns the InteractionManager handle held during the gesture; this
   *  host has no interaction queue to block, so there is none. */
  getInteractionHandle(): number | null;
}

/**
 * Velocity is estimated over a recency WINDOW rather than from the last two
 * samples the way RN does, because a browser's pointer stream breaks the
 * two-sample derivative in both directions: moves are coalesced (a fast flick
 * can arrive as one move), and the pointerUP almost always repeats the last
 * move's coordinates — so an instantaneous estimate reads exactly 0 at
 * release, which is the one moment a fling handler needs a number. Same
 * reasoning, and the same constants, as the engine's own scroll-release
 * velocity (engine/events.ts).
 */
const VELOCITY_WINDOW_MS = 100;
const VELOCITY_MAX_SPAN_MS = 350;
/** Below this the samples are bunched at one instant (synthetic dispatch, a
 *  coalesced burst) and no honest velocity can be read out of them. */
const MIN_VELOCITY_DT_MS = 1;

let nextStateID = 1;

function initializeGestureState(g: PanResponderGestureState): void {
  g.moveX = 0;
  g.moveY = 0;
  g.x0 = 0;
  g.y0 = 0;
  g.dx = 0;
  g.dy = 0;
  g.vx = 0;
  g.vy = 0;
  g.numberActiveTouches = 0;
  g._accountsForMovesUpTo = 0;
}

/** RN-shaped touch event. locationX/Y equal pageX/Y here — the pan seam carries
 *  surface coordinates only (module doc). */
function touchEvent(x: number, y: number, timestamp: number): PanResponderEvent {
  const touch: PanResponderTouch = {
    identifier: 0,
    locationX: x,
    locationY: y,
    pageX: x,
    pageY: y,
    timestamp,
  };
  return {
    nativeEvent: { ...touch, changedTouches: [touch], touches: [touch], target: null },
  };
}

/** Page coordinates carried by an RN-shaped event handed to the delegating
 *  responder props (the engine path passes coordinates directly). */
function pointOf(event: PanResponderEvent | undefined): { x: number; y: number; t: number } {
  const n = event?.nativeEvent;
  return { x: n?.pageX ?? 0, y: n?.pageY ?? 0, t: n?.timestamp ?? 0 };
}

export const PanResponder = {
  /**
   * RN's factory. Returns `{ panHandlers }` to spread onto a View; the
   * returned object is stable, so it can be built once in a ref/useMemo the
   * way RN examples do.
   */
  create(config: PanResponderCallbacks): PanResponderInstance {
    const gestureState: PanResponderGestureState = {
      stateID: nextStateID++,
      moveX: 0,
      moveY: 0,
      x0: 0,
      y0: 0,
      dx: 0,
      dy: 0,
      vx: 0,
      vy: 0,
      numberActiveTouches: 0,
      _accountsForMovesUpTo: 0,
    };

    let granted = false;
    /** Last sample, for the per-move delta. */
    let lastX = 0;
    let lastY = 0;
    let lastT = 0;
    /** Recent pointer samples, for the windowed velocity estimate. */
    let samples: Array<{ t: number; x: number; y: number }> = [];

    const ask = (name: keyof PanResponderCallbacks, event: PanResponderEvent): boolean => {
      const fn = config[name] as PanResponderShouldSet | undefined;
      return fn ? fn(event, gestureState) === true : false;
    };

    const call = (name: keyof PanResponderCallbacks, event: PanResponderEvent): void => {
      (config[name] as PanResponderCallback | undefined)?.(event, gestureState);
    };

    /** Oldest sample still inside the velocity window (see the constants). */
    const velocityBaseline = (): { t: number; x: number; y: number } | null => {
      const newest = samples[samples.length - 1];
      if (!newest || samples.length < 2) return null;
      let oldest = newest;
      for (let i = samples.length - 2; i >= 0; i--) {
        const candidate = samples[i]!;
        const span = newest.t - candidate.t;
        if (span > VELOCITY_MAX_SPAN_MS) break;
        oldest = candidate;
        if (span >= VELOCITY_WINDOW_MS) break;
      }
      return oldest === newest ? null : oldest;
    };

    /** Accumulate translation and velocity. Runs while DECIDING too: that is
     *  what lets `onMoveShouldSetPanResponder: (e, g) => g.dy > 5` work. */
    const accumulate = (x: number, y: number, t: number): void => {
      gestureState.dx += x - lastX;
      gestureState.dy += y - lastY;
      gestureState.moveX = x;
      gestureState.moveY = y;
      gestureState._accountsForMovesUpTo = t;
      lastX = x;
      lastY = y;
      lastT = t;

      samples.push({ t, x, y });
      while (samples.length > 2 && t - samples[0]!.t > VELOCITY_MAX_SPAN_MS) samples.shift();
      const baseline = velocityBaseline();
      const dt = baseline ? t - baseline.t : 0;
      if (!baseline || dt < MIN_VELOCITY_DT_MS) {
        gestureState.vx = 0;
        gestureState.vy = 0;
        return;
      }
      gestureState.vx = (x - baseline.x) / dt;
      gestureState.vy = (y - baseline.y) / dt;
    };

    /** RN's grant: the gesture now measures from HERE. */
    const grant = (x: number, y: number, event: PanResponderEvent, fromTouchStart: boolean): void => {
      granted = true;
      gestureState.x0 = x;
      gestureState.y0 = y;
      gestureState.dx = 0;
      gestureState.dy = 0;
      call('onPanResponderGrant', event);
      // onResponderStart means "a touch began while we own the gesture" — true
      // of a start-grant, not of one negotiated mid-drag.
      if (fromTouchStart) call('onPanResponderStart', event);
    };

    const down = (x: number, y: number, t: number): void => {
      initializeGestureState(gestureState);
      gestureState.numberActiveTouches = 1;
      granted = false;
      lastX = x;
      lastY = y;
      lastT = t;
      samples = [{ t, x, y }];
      const event = touchEvent(x, y, t);
      if (ask('onStartShouldSetPanResponderCapture', event) || ask('onStartShouldSetPanResponder', event)) {
        grant(x, y, event, true);
      }
    };

    const move = (x: number, y: number, t: number): void => {
      accumulate(x, y, t);
      const event = touchEvent(x, y, t);
      if (granted) {
        call('onPanResponderMove', event);
        return;
      }
      if (ask('onMoveShouldSetPanResponderCapture', event) || ask('onMoveShouldSetPanResponder', event)) {
        // No move callback for the granting event itself — RN delivers the
        // first onPanResponderMove on the NEXT move.
        grant(x, y, event, false);
      }
    };

    const up = (x: number, y: number, t: number): void => {
      // Deliberate small deviation from RN, which leaves dx/dy at their last
      // move value: a browser can coalesce the final movement into the up
      // event, and a release handler reading dx must see where the finger
      // actually ended.
      accumulate(x, y, t);
      gestureState.numberActiveTouches = 0;
      const event = touchEvent(x, y, t);
      if (granted) {
        call('onPanResponderEnd', event);
        call('onPanResponderRelease', event);
      }
      granted = false;
    };

    const terminate = (event: PanResponderEvent): void => {
      gestureState.numberActiveTouches = 0;
      if (granted) call('onPanResponderTerminate', event);
      granted = false;
    };

    const panHandlers: PanResponderHandlers = {
      // RN responder props: real delegates, so anything that calls them by
      // name behaves; the engine drives __panHandler instead.
      onStartShouldSetResponder: (event) => {
        const p = pointOf(event);
        down(p.x, p.y, p.t);
        return granted;
      },
      onStartShouldSetResponderCapture: (event) => ask('onStartShouldSetPanResponderCapture', event),
      onMoveShouldSetResponder: (event) => {
        const p = pointOf(event);
        move(p.x, p.y, p.t);
        return granted;
      },
      onMoveShouldSetResponderCapture: (event) => ask('onMoveShouldSetPanResponderCapture', event),
      onResponderGrant: (event) => {
        const p = pointOf(event);
        if (!granted) grant(p.x, p.y, event, true);
      },
      onResponderStart: (event) => call('onPanResponderStart', event),
      onResponderMove: (event) => {
        const p = pointOf(event);
        move(p.x, p.y, p.t);
      },
      onResponderEnd: (event) => call('onPanResponderEnd', event),
      onResponderRelease: (event) => {
        const p = pointOf(event);
        up(p.x, p.y, p.t);
      },
      onResponderTerminate: (event) => terminate(event),
      onResponderTerminationRequest: (event) =>
        config.onPanResponderTerminationRequest ? ask('onPanResponderTerminationRequest', event) : true,
      onResponderReject: (event) => call('onPanResponderReject', event),

      __panHandler: {
        onDown: (e: PanStreamEvent) => down(e.x, e.y, e.timestamp),
        onMove: (e: PanStreamEvent) => move(e.x, e.y, e.timestamp),
        onUp: (e: PanStreamEvent) => up(e.x, e.y, e.timestamp),
        onCancel: () => terminate(touchEvent(lastX, lastY, lastT)),
        // The engine asks this on every move to arbitrate against press and
        // scroll: a granted PanResponder owns the gesture, exactly as an RN
        // responder does.
        claimed: () => granted,
      },
    };

    return { panHandlers, getInteractionHandle: () => null };
  },
};
