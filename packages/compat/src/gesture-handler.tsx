/**
 * react-native-gesture-handler compat shim for the native-surface engine.
 * Scope: the import surface of @gorhom/bottom-sheet v5 — Gesture.Pan/Tap/
 * Native builders, GestureDetector, State, GestureHandlerRootView, and the
 * touchable/TextInput re-exports. The detector wires the engine's internal
 * `__panHandler` pointer stream (see native-surface events.ts) into RNGH-shaped
 * events: translation, velocity, absolute position, numeric state.
 */
import * as React from 'react';
import {
  TextInput,
  TouchableHighlight,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'native-surface';

export { TextInput, TouchableHighlight, TouchableOpacity, TouchableWithoutFeedback };

export const State = {
  UNDETERMINED: 0,
  FAILED: 1,
  BEGAN: 2,
  CANCELLED: 3,
  ACTIVE: 4,
  END: 5,
} as const;

export interface PanGestureEvent {
  translationX: number;
  translationY: number;
  velocityX: number;
  velocityY: number;
  absoluteX: number;
  absoluteY: number;
  x: number;
  y: number;
  changeX: number;
  changeY: number;
  state: number;
  numberOfPointers: number;
}

type Handler = (event: PanGestureEvent) => void;

type OffsetSpec = number | [number, number] | undefined;

interface BuilderConfig {
  enabled: boolean;
  activeOffsetX: OffsetSpec;
  activeOffsetY: OffsetSpec;
  failOffsetX: OffsetSpec;
  failOffsetY: OffsetSpec;
}

const HANDLER_NAMES = [
  'onBegin',
  'onStart',
  'onChange',
  'onUpdate',
  'onEnd',
  'onFinalize',
  'onTouchesDown',
  'onTouchesMove',
  'onTouchesUp',
  'onTouchesCancelled',
] as const;
type HandlerName = (typeof HANDLER_NAMES)[number];

const CONFIG_CARRIERS = [
  'shouldCancelWhenOutside',
  'simultaneousWithExternalGesture',
  'requiresExternalGestureToFail',
  'blocksExternalGesture',
  'runOnJS',
  'withTestId',
  'withRef',
  'hitSlop',
  'minDistance',
  'minPointers',
  'maxPointers',
  'averageTouches',
  'cancelsTouchesInView',
  'maxDuration',
  'maxDistance',
  'maxDelayMs',
  'numberOfTaps',
  'manualActivation',
  'enableTrackpadTwoFingerGesture',
  'activateAfterLongPress',
] as const;

export class GestureBuilder {
  readonly kind: 'pan' | 'tap' | 'native';
  config: BuilderConfig = {
    enabled: true,
    activeOffsetX: undefined,
    activeOffsetY: undefined,
    failOffsetX: undefined,
    failOffsetY: undefined,
  };
  handlers: Partial<Record<HandlerName, Handler>> = {};

  constructor(kind: 'pan' | 'tap' | 'native') {
    this.kind = kind;
    for (const name of HANDLER_NAMES) {
      (this as Record<string, unknown>)[name] = (h: Handler) => {
        this.handlers[name] = h;
        return this;
      };
    }
    for (const name of CONFIG_CARRIERS) {
      (this as Record<string, unknown>)[name] = () => this;
    }
  }

  enabled(v: boolean): this {
    this.config.enabled = v;
    return this;
  }
  activeOffsetX(v: OffsetSpec): this {
    this.config.activeOffsetX = v;
    return this;
  }
  activeOffsetY(v: OffsetSpec): this {
    this.config.activeOffsetY = v;
    return this;
  }
  failOffsetX(v: OffsetSpec): this {
    this.config.failOffsetX = v;
    return this;
  }
  failOffsetY(v: OffsetSpec): this {
    this.config.failOffsetY = v;
    return this;
  }
}

// The dynamic handler/config methods above make the class type-incomplete;
// gorhom consumes it as an opaque GestureType anyway.
export type GestureType = GestureBuilder;
export type PanGesture = GestureBuilder;
export type TapGesture = GestureBuilder;
export type NativeGesture = GestureBuilder;
export type GestureRef = GestureBuilder;
export type SimultaneousGesture = GestureBuilder[];

function flatten(g: unknown): GestureBuilder[] {
  if (!g) return [];
  if (Array.isArray(g)) return g.flatMap(flatten);
  if (g instanceof GestureBuilder) return [g];
  const composed = (g as { gestures?: unknown[] }).gestures;
  if (composed) return composed.flatMap(flatten);
  return [];
}

export const Gesture = {
  Pan: () => new GestureBuilder('pan'),
  Tap: () => new GestureBuilder('tap'),
  Native: () => new GestureBuilder('native'),
  Simultaneous: (...gestures: unknown[]) => ({ gestures }),
  Exclusive: (...gestures: unknown[]) => ({ gestures }),
  Race: (...gestures: unknown[]) => ({ gestures }),
  toGestureArray: (g: unknown) => flatten(g),
};

// ---------------------------------------------------------------------------
// Pan driver: engine raw stream -> RNGH events
// ---------------------------------------------------------------------------

interface Sample {
  y: number;
  x: number;
  t: number;
}

function exceeds(delta: number, spec: OffsetSpec): boolean {
  if (spec == null) return false;
  if (typeof spec === 'number') return spec >= 0 ? delta >= spec : delta <= spec;
  const [lo, hi] = spec;
  return delta <= lo || delta >= hi;
}

class PanDriver {
  private startX = 0;
  private startY = 0;
  private lastX = 0;
  private lastY = 0;
  private active = false;
  private failed = false;
  private samples: Sample[] = [];

  constructor(public gestures: GestureBuilder[]) {}

  private event(x: number, y: number, state: number, changeX = 0, changeY = 0): PanGestureEvent {
    const v = this.velocity();
    return {
      translationX: x - this.startX,
      translationY: y - this.startY,
      velocityX: v.x,
      velocityY: v.y,
      absoluteX: x,
      absoluteY: y,
      x,
      y,
      changeX,
      changeY,
      state,
      numberOfPointers: 1,
    };
  }

  private velocity(): { x: number; y: number } {
    const s = this.samples;
    if (s.length < 2) return { x: 0, y: 0 };
    const newest = s[s.length - 1]!;
    let i = s.length - 2;
    while (i > 0 && newest.t - s[i - 1]!.t <= 100) i--;
    const oldest = s[i]!;
    const dt = Math.max(1, newest.t - oldest.t);
    return { x: ((newest.x - oldest.x) / dt) * 1000, y: ((newest.y - oldest.y) / dt) * 1000 };
  }

  private fire(name: HandlerName, ev: PanGestureEvent): void {
    for (const g of this.gestures) {
      if (g.kind !== 'pan' || g.config.enabled === false) continue;
      g.handlers[name]?.(ev);
    }
  }

  private fireTap(ev: PanGestureEvent): void {
    for (const g of this.gestures) {
      if (g.kind !== 'tap' || g.config.enabled === false) continue;
      g.handlers.onStart?.({ ...ev, state: State.ACTIVE });
      g.handlers.onEnd?.({ ...ev, state: State.END });
      g.handlers.onFinalize?.({ ...ev, state: State.END });
    }
  }

  onDown(e: { x: number; y: number; timestamp: number }): void {
    this.startX = e.x;
    this.startY = e.y;
    this.lastX = e.x;
    this.lastY = e.y;
    this.active = false;
    this.failed = false;
    this.samples = [{ x: e.x, y: e.y, t: e.timestamp }];
    this.fire('onBegin', this.event(e.x, e.y, State.BEGAN));
  }

  onMove(e: { x: number; y: number; timestamp: number }): void {
    if (this.failed) return;
    const changeX = e.x - this.lastX;
    const changeY = e.y - this.lastY;
    this.lastX = e.x;
    this.lastY = e.y;
    this.samples.push({ x: e.x, y: e.y, t: e.timestamp });
    if (this.samples.length > 20) this.samples.shift();

    if (!this.active) {
      const dx = e.x - this.startX;
      const dy = e.y - this.startY;
      const cfg = this.gestures.find((g) => g.kind === 'pan')?.config;
      if (cfg && (exceeds(dx, cfg.failOffsetX) || exceeds(dy, cfg.failOffsetY))) {
        this.failed = true;
        this.fire('onFinalize', this.event(e.x, e.y, State.FAILED));
        return;
      }
      const hasActivation = cfg && (cfg.activeOffsetX != null || cfg.activeOffsetY != null);
      const activated = hasActivation
        ? exceeds(dx, cfg.activeOffsetX) || exceeds(dy, cfg.activeOffsetY)
        : Math.hypot(dx, dy) > 0;
      if (!activated) return;
      this.active = true;
      // RNGH measures translation from the activation point
      this.startX = e.x;
      this.startY = e.y;
      this.fire('onStart', this.event(e.x, e.y, State.ACTIVE));
      return;
    }
    const ev = this.event(e.x, e.y, State.ACTIVE, changeX, changeY);
    this.fire('onChange', ev);
    this.fire('onUpdate', ev);
  }

  onUp(e: { x: number; y: number; timestamp: number }): void {
    this.samples.push({ x: e.x, y: e.y, t: e.timestamp });
    if (this.active) {
      const ev = this.event(e.x, e.y, State.END);
      this.fire('onEnd', ev);
      this.fire('onFinalize', ev);
    } else if (!this.failed) {
      const moved = Math.hypot(e.x - this.startX, e.y - this.startY);
      if (moved < 10) this.fireTap(this.event(e.x, e.y, State.END));
      this.fire('onFinalize', this.event(e.x, e.y, State.END));
    }
    this.active = false;
  }

  onCancel(): void {
    if (this.active) {
      const ev = this.event(this.lastX, this.lastY, State.CANCELLED);
      this.fire('onEnd', ev);
      this.fire('onFinalize', ev);
    }
    this.active = false;
    this.failed = false;
  }

  claimed(): boolean {
    return this.active;
  }
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

export function GestureDetector(props: { gesture: unknown; children: React.ReactElement }): React.ReactElement {
  const gestures = flatten(props.gesture);
  const driverRef = React.useRef<PanDriver | null>(null);
  // Rebind gestures each render so latest handler closures win, but keep one
  // driver so an in-flight gesture survives re-renders.
  if (driverRef.current === null) driverRef.current = new PanDriver(gestures);
  else driverRef.current.gestures = gestures;

  const interactive = gestures.some((g) => (g.kind === 'pan' || g.kind === 'tap') && g.config.enabled !== false);
  if (!interactive) return props.children;

  const d = driverRef.current;
  const panHandler = {
    onDown: (e: { x: number; y: number; timestamp: number }) => d.onDown(e),
    onMove: (e: { x: number; y: number; timestamp: number }) => d.onMove(e),
    onUp: (e: { x: number; y: number; timestamp: number }) => d.onUp(e),
    onCancel: () => d.onCancel(),
    claimed: () => d.claimed(),
  };
  return React.cloneElement(props.children, { __panHandler: panHandler } as Record<string, unknown>);
}

export function GestureHandlerRootView(props: {
  children?: React.ReactNode;
  style?: unknown;
}): React.ReactElement {
  return React.createElement(View as React.ComponentType<Record<string, unknown>>, { style: props.style }, props.children);
}

export function gestureHandlerRootHOC<P extends object>(Component: React.ComponentType<P>): React.ComponentType<P> {
  return Component;
}

export type GestureStateChangeEvent = PanGestureEvent;
export type GestureUpdateEvent = PanGestureEvent;
export type PanGestureHandlerEventPayload = PanGestureEvent;

// RNGH re-exports RN's list/scroll components wrapped for gesture
// interop; on this host the engine components already share the gesture
// pipeline, so the engine implementations are the correct re-export.
export { FlatList, ScrollView, RefreshControl } from 'native-surface';

// ---------------------------------------------------------------------------
// Legacy (v1-style) handler components — imported by libraries' NATIVE files
// now that Metro platform-extension resolution is active (e.g.
// @react-navigation/stack's GestureHandler.native). Passthrough rendering:
// children render; gesture callbacks are accepted and currently inert (the
// modern Gesture.Pan()/GestureDetector path is the wired one).
// ---------------------------------------------------------------------------
interface LegacyHandlerProps {
  children?: React.ReactNode;
  enabled?: boolean;
  onGestureEvent?: unknown;
  onHandlerStateChange?: unknown;
  [key: string]: unknown;
}

function legacyHandler(name: string): React.FC<LegacyHandlerProps> {
  const C: React.FC<LegacyHandlerProps> = ({ children }) => <>{children}</>;
  C.displayName = name;
  return C;
}

export const PanGestureHandler = legacyHandler('PanGestureHandler');
export const TapGestureHandler = legacyHandler('TapGestureHandler');
export const LongPressGestureHandler = legacyHandler('LongPressGestureHandler');
export const NativeViewGestureHandler = legacyHandler('NativeViewGestureHandler');

