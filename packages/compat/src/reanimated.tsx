/**
 * react-native-reanimated compat shim for the native-surface engine.
 * Scope: the exact import surface of @gorhom/bottom-sheet v5 (see the
 * recon inventory in the PR description). Shared values are JS boxes with
 * dependency tracking; `sv.value = withTiming(x)` drives a real rAF
 * animation; animated styles re-render their component per frame.
 */
import * as React from 'react';
import { ScrollView, View } from 'native-surface';
import {
  type AnimationDescriptor,
  isAnimationDescriptor,
  SharedBox,
  stopAnimation,
  track,
} from './core';

export type SharedValue<T> = SharedBox<T>;
export type AnimatedStyle<T = Record<string, unknown>> = T;
export type AnimatedProps<T = Record<string, unknown>> = Partial<T>;

// ---------------------------------------------------------------------------
// Easing
// ---------------------------------------------------------------------------

type EasingFn = (t: number) => number;

function cubicBezier(x1: number, y1: number, x2: number, y2: number): EasingFn {
  // Standard CSS cubic-bezier solve (Newton + bisection fallback).
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const sampleDX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = sampleX(t) - x;
      if (Math.abs(err) < 1e-5) return sampleY(t);
      const d = sampleDX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    let lo = 0;
    let hi = 1;
    t = x;
    while (hi - lo > 1e-5) {
      if (sampleX(t) < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return sampleY(t);
  };
}

const quad: EasingFn = (t) => t * t;
export const Easing = {
  linear: ((t: number) => t) as EasingFn,
  ease: cubicBezier(0.25, 0.1, 0.25, 1),
  quad,
  cubic: ((t: number) => t * t * t) as EasingFn,
  sin: ((t: number) => 1 - Math.cos((t * Math.PI) / 2)) as EasingFn,
  circle: ((t: number) => 1 - Math.sqrt(1 - t * t)) as EasingFn,
  exp: ((t: number) => (t === 0 ? 0 : Math.pow(2, 10 * (t - 1)))) as EasingFn,
  poly: (n: number): EasingFn => (t) => Math.pow(t, n),
  elastic:
    (b = 1): EasingFn =>
    (t) => {
      const p = b * Math.PI;
      return 1 - Math.pow(Math.cos((t * Math.PI) / 2), 3) * Math.cos(t * p);
    },
  bezier: (x1: number, y1: number, x2: number, y2: number) => {
    const fn = cubicBezier(x1, y1, x2, y2);
    return Object.assign(fn, { factory: () => fn });
  },
  in: (fn: EasingFn = quad): EasingFn => fn,
  out:
    (fn: EasingFn = quad): EasingFn =>
    (t) => 1 - fn(1 - t),
  inOut:
    (fn: EasingFn = quad): EasingFn =>
    (t) => (t < 0.5 ? fn(2 * t) / 2 : 1 - fn(2 * (1 - t)) / 2),
};

// ---------------------------------------------------------------------------
// Animation factories
// ---------------------------------------------------------------------------

export enum ReduceMotion {
  System = 'system',
  Always = 'always',
  Never = 'never',
}

export interface WithTimingConfig {
  duration?: number;
  easing?: EasingFn;
  reduceMotion?: ReduceMotion;
}

export function withTiming(
  toValue: number,
  config?: WithTimingConfig,
  callback?: (finished: boolean) => void
): number {
  const duration = config?.duration ?? 300;
  const easing = config?.easing ?? Easing.inOut(quad);
  const desc: AnimationDescriptor = {
    __cnAnimation: true,
    toValue,
    callback,
    make(from: number) {
      let start = -1;
      return (nowMs: number) => {
        if (start < 0) start = nowMs;
        const t = duration <= 0 ? 1 : Math.min(1, (nowMs - start) / duration);
        if (t >= 1) return { value: toValue, done: true };
        return { value: from + (toValue - from) * easing(t), done: false };
      };
    },
  };
  return desc as unknown as number;
}

export function withDelay(delayMs: number, animation: number, _reduceMotion?: ReduceMotion): number {
  const inner: AnimationDescriptor = isAnimationDescriptor(animation)
    ? animation
    : { __cnAnimation: true, toValue: Number(animation), make: () => () => ({ value: Number(animation), done: true }) };
  const desc: AnimationDescriptor = {
    __cnAnimation: true,
    toValue: inner.toValue,
    callback: inner.callback,
    make(from: number) {
      let start = -1;
      let step: ReturnType<AnimationDescriptor['make']> | null = null;
      return (nowMs: number) => {
        if (start < 0) start = nowMs;
        if (nowMs - start < delayMs) return { value: from, done: false };
        step ??= inner.make(from);
        return step(nowMs);
      };
    },
  };
  return desc as unknown as number;
}

export interface WithSpringConfig {
  damping?: number;
  mass?: number;
  stiffness?: number;
  velocity?: number;
  overshootClamping?: boolean;
  restDisplacementThreshold?: number;
  restSpeedThreshold?: number;
  reduceMotion?: ReduceMotion;
  duration?: number;
  dampingRatio?: number;
}

export function withSpring(
  toValue: number,
  config?: WithSpringConfig,
  callback?: (finished: boolean) => void
): number {
  const damping = config?.damping ?? 10;
  const mass = config?.mass ?? 1;
  const stiffness = config?.stiffness ?? 100;
  const restD = config?.restDisplacementThreshold ?? 0.01;
  const restV = config?.restSpeedThreshold ?? 2;
  const clamp = config?.overshootClamping ?? false;
  const desc: AnimationDescriptor = {
    __cnAnimation: true,
    toValue,
    callback,
    make(from: number) {
      // Semi-implicit Euler in real units (x px, v px/s, dt s), 4ms substeps.
      // Stable for stiff configs like gorhom's {stiffness:1000, damping:500,
      // mass:3} (fastest mode ~c/m ≈ 166 s⁻¹ ≪ 1/0.004): matches RN's spring
      // model x'' = (-k(x-to) - c·x')/m with no ad-hoc scaling.
      let x = from;
      let v = config?.velocity ?? 0;
      let last = -1;
      return (nowMs: number) => {
        if (last < 0) last = nowMs - 16; // first tick integrates one frame
        let dtMs = Math.min(64, nowMs - last);
        last = nowMs;
        while (dtMs > 0) {
          const stepS = Math.min(dtMs, 4) / 1000;
          const a = (-stiffness * (x - toValue) - damping * v) / mass;
          v += a * stepS;
          x += v * stepS;
          if (clamp && ((from < toValue && x > toValue) || (from > toValue && x < toValue))) {
            x = toValue;
            v = 0;
            break;
          }
          dtMs -= stepS * 1000;
        }
        if (Math.abs(v) < restV && Math.abs(x - toValue) < Math.max(restD, 0.01)) {
          return { value: toValue, done: true };
        }
        return { value: x, done: false };
      };
    },
  };
  return desc as unknown as number;
}

export function cancelAnimation<T>(sv: SharedValue<T>): void {
  stopAnimation(sv as SharedBox<unknown>, false);
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function makeMutable<T>(initial: T): SharedValue<T> {
  return new SharedBox(initial);
}

export function useSharedValue<T>(initial: T): SharedValue<T> {
  const [box] = React.useState(() => new SharedBox(initial));
  return box;
}

/** Reactive recompute bound to whatever SharedValues fn reads. */
function useTrackedValue<T>(fn: () => T, deps: React.DependencyList | undefined, sink: (v: T) => void): void {
  const fnRef = React.useRef(fn);
  fnRef.current = fn;
  const sinkRef = React.useRef(sink);
  sinkRef.current = sink;
  React.useEffect(() => {
    let unsubs: Array<() => void> = [];
    let disposed = false;
    const run = () => {
      if (disposed) return;
      for (const u of unsubs) u();
      const { result, deps: boxes } = track(() => fnRef.current());
      unsubs = [...boxes].map((b) => b.subscribe(run));
      sinkRef.current(result);
    };
    run();
    return () => {
      disposed = true;
      for (const u of unsubs) u();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps ?? []);
}

export function useDerivedValue<T>(fn: () => T, deps?: React.DependencyList): SharedValue<T> {
  const boxRef = React.useRef<SharedBox<T> | null>(null);
  if (boxRef.current === null) {
    boxRef.current = new SharedBox(track(fn).result);
  }
  useTrackedValue(
    fn,
    deps,
    (v) => {
      const box = boxRef.current!;
      // a derived value may itself return an animation (rare but legal)
      box.value = v;
    }
  );
  return boxRef.current;
}

export function useAnimatedReaction<T>(
  prepare: () => T,
  react: (prepared: T, previous: T | null) => void,
  deps?: React.DependencyList
): void {
  const prevRef = React.useRef<T | null>(null);
  useTrackedValue(prepare, deps, (v) => {
    const prev = prevRef.current;
    prevRef.current = v;
    if (!Object.is(prev, v)) react(v, prev);
  });
}

/** Handle protocol consumed by createAnimatedComponent. */
interface AnimatedHandle {
  __cnAnimatedHandle: true;
  kind: 'style' | 'props';
  get(): Record<string, unknown>;
  subscribe(l: () => void): () => void;
}

function isAnimatedHandle(v: unknown): v is AnimatedHandle {
  return typeof v === 'object' && v !== null && (v as AnimatedHandle).__cnAnimatedHandle === true;
}

interface PropAnimationState {
  box: SharedBox<number>;
  target: number;
}

/**
 * Reanimated lets a style prop's value BE an animation (e.g. gorhom's
 * `paddingBottom: animate({...})`), meaning "animate this prop to the
 * target". Resolve such values through a per-prop animated box; reading
 * `box.value` inside the tracked compute keeps the style live per frame.
 */
function resolvePropAnimations(
  style: Record<string, unknown>,
  state: Map<string, PropAnimationState>
): Record<string, unknown> {
  let out: Record<string, unknown> | null = null;
  for (const [key, v] of Object.entries(style)) {
    if (!isAnimationDescriptor(v)) continue;
    out ??= { ...style };
    let entry = state.get(key);
    if (!entry) {
      entry = { box: new SharedBox<number>(v.toValue), target: v.toValue };
      state.set(key, entry);
      if (v.callback) queueMicrotask(() => v.callback?.(true));
    } else if (entry.target !== v.toValue) {
      entry.target = v.toValue;
      entry.box.value = v as unknown as number;
    }
    out[key] = entry.box.value;
  }
  return out ?? style;
}

function useAnimatedHandle(
  kind: 'style' | 'props',
  fn: () => Record<string, unknown>,
  deps?: React.DependencyList
): AnimatedHandle {
  const listeners = React.useRef(new Set<() => void>()).current;
  const animState = React.useRef(new Map<string, PropAnimationState>()).current;
  const fnRef = React.useRef(fn);
  fnRef.current = fn;
  const wrapped = React.useCallback(
    () => resolvePropAnimations(fnRef.current(), animState),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  const valueRef = React.useRef<Record<string, unknown> | null>(null);
  if (valueRef.current === null) valueRef.current = track(wrapped).result;
  const handleRef = React.useRef<AnimatedHandle | null>(null);
  if (handleRef.current === null) {
    handleRef.current = {
      __cnAnimatedHandle: true,
      kind,
      get: () => valueRef.current!,
      subscribe: (l) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
    };
  }
  useTrackedValue(wrapped, deps, (v) => {
    valueRef.current = v;
    for (const l of [...listeners]) l();
  });
  return handleRef.current;
}

export function useAnimatedStyle<T extends Record<string, unknown>>(
  fn: () => T,
  deps?: React.DependencyList
): T {
  return useAnimatedHandle('style', fn, deps) as unknown as T;
}

export function useAnimatedProps<T extends Record<string, unknown>>(
  fn: () => T,
  deps?: React.DependencyList
): Partial<T> {
  return useAnimatedHandle('props', fn, deps) as unknown as Partial<T>;
}

export function useAnimatedRef<T>(): React.RefObject<T> & ((instance: T | null) => void) {
  const ref = React.useRef<T | null>(null);
  const cbRef = React.useRef<((instance: T | null) => void) & { current: T | null }>(null as never);
  if (!cbRef.current) {
    const cb = ((instance: T | null) => {
      ref.current = instance;
    }) as ((instance: T | null) => void) & { current: T | null };
    Object.defineProperty(cb, 'current', {
      get: () => ref.current,
      set: (v) => {
        ref.current = v;
      },
    });
    cbRef.current = cb;
  }
  return cbRef.current as never;
}

export interface MeasuredDimensions {
  x: number;
  y: number;
  width: number;
  height: number;
  pageX: number;
  pageY: number;
}

/** Reanimated `measure(ref)` — layout of the host node, or null. Never throws. */
export function measure(animatedRef: { current?: unknown } | null | undefined): MeasuredDimensions | null {
  try {
    if (animatedRef == null || typeof animatedRef !== 'object') return null;
    const node = 'current' in animatedRef ? animatedRef.current : animatedRef;
    if (node == null || typeof node !== 'object') return null;
    const n = node as {
      absoluteRect?: () => { x: number; y: number; w: number; h: number };
      getBoundingClientRect?: () => { x: number; y: number; width: number; height: number; left?: number; top?: number };
      frame?: { x: number; y: number; width: number; height: number };
    };
    if (typeof n.absoluteRect === 'function') {
      const r = n.absoluteRect();
      if (!r || !Number.isFinite(r.w) || !Number.isFinite(r.h)) return null;
      return { x: n.frame?.x ?? 0, y: n.frame?.y ?? 0, width: r.w, height: r.h, pageX: r.x, pageY: r.y };
    }
    if (typeof n.getBoundingClientRect === 'function') {
      const r = n.getBoundingClientRect();
      if (!r || !Number.isFinite(r.width) || !Number.isFinite(r.height)) return null;
      const x = r.x ?? r.left ?? 0;
      const y = r.y ?? r.top ?? 0;
      return { x, y, width: r.width, height: r.height, pageX: x, pageY: y };
    }
    const f = n.frame;
    if (f && Number.isFinite(f.width) && Number.isFinite(f.height)) {
      return { x: f.x, y: f.y, width: f.width, height: f.height, pageX: f.x, pageY: f.y };
    }
    return null;
  } catch {
    return null;
  }
}

interface ScrollHandlers<Ctx> {
  onScroll?: (event: Record<string, unknown>, ctx: Ctx) => void;
  onBeginDrag?: (event: Record<string, unknown>, ctx: Ctx) => void;
  onEndDrag?: (event: Record<string, unknown>, ctx: Ctx) => void;
  onMomentumBegin?: (event: Record<string, unknown>, ctx: Ctx) => void;
  onMomentumEnd?: (event: Record<string, unknown>, ctx: Ctx) => void;
}

export function useAnimatedScrollHandler<Ctx extends Record<string, unknown>>(
  handlers: ScrollHandlers<Ctx> | ((event: Record<string, unknown>, ctx: Ctx) => void),
  _deps?: React.DependencyList
): (event: { nativeEvent?: Record<string, unknown> }) => void {
  const ctxRef = React.useRef({} as Ctx);
  const hRef = React.useRef(handlers);
  hRef.current = handlers;
  return React.useCallback((event) => {
    const native = (event?.nativeEvent ?? event) as Record<string, unknown>;
    const h = hRef.current;
    if (typeof h === 'function') h(native, ctxRef.current);
    else h.onScroll?.(native, ctxRef.current);
  }, []);
}

export function useReducedMotion(): boolean {
  return false;
}

// ---------------------------------------------------------------------------
// Worklet + utility surface
// ---------------------------------------------------------------------------

export function runOnJS<A extends unknown[]>(fn: (...args: A) => void): (...args: A) => void {
  return (...args: A) => {
    queueMicrotask(() => fn(...args));
  };
}

export function runOnUI<A extends unknown[]>(fn: (...args: A) => void): (...args: A) => void {
  return (...args: A) => fn(...args);
}

export function scrollTo(
  ref: { current: { scrollTo?: (opts: { x: number; y: number; animated: boolean }) => void } | null },
  x: number,
  y: number,
  animated: boolean
): void {
  ref?.current?.scrollTo?.({ x, y, animated });
}

export enum Extrapolation {
  IDENTITY = 'identity',
  CLAMP = 'clamp',
  EXTEND = 'extend',
}

type ExtrapolationType =
  | Extrapolation
  | 'identity'
  | 'clamp'
  | 'extend'
  | { extrapolateLeft?: string; extrapolateRight?: string };

export function interpolate(
  x: number,
  input: readonly number[],
  output: readonly number[],
  type?: ExtrapolationType
): number {
  const left = typeof type === 'object' ? (type.extrapolateLeft ?? 'extend') : (type ?? 'extend');
  const right = typeof type === 'object' ? (type.extrapolateRight ?? 'extend') : (type ?? 'extend');
  const n = Math.min(input.length, output.length);
  if (n === 0) return 0;
  if (n === 1) return output[0]!;
  let i = 0;
  while (i < n - 2 && x >= input[i + 1]!) i++;
  const x0 = input[i]!;
  const x1 = input[i + 1]!;
  const y0 = output[i]!;
  const y1 = output[i + 1]!;
  if (x < x0) {
    if (left === 'clamp') return y0;
    if (left === 'identity') return x;
  }
  if (x > input[n - 1]!) {
    if (right === 'clamp') return output[n - 1]!;
    if (right === 'identity') return x;
  }
  if (x1 === x0) return y0;
  return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
}

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

// ---------------------------------------------------------------------------
// Animated components
// ---------------------------------------------------------------------------

type AnyStyle = unknown;

function resolveStyle(style: AnyStyle, handles: AnimatedHandle[]): AnyStyle {
  if (Array.isArray(style)) return style.map((s) => resolveStyle(s, handles));
  if (isAnimatedHandle(style)) {
    handles.push(style);
    return style.get();
  }
  return style;
}

export function createAnimatedComponent<P>(
  Component: React.ComponentType<P>
): React.ComponentType<P & { animatedProps?: unknown }> {
  const Animated = React.forwardRef<unknown, P & { animatedProps?: unknown }>((props, ref) => {
    const [, force] = React.useReducer((c: number) => c + 1, 0);
    const handles: AnimatedHandle[] = [];
    const { animatedProps, style, ...rest } = props as Record<string, unknown>;
    const resolvedStyle = resolveStyle(style, handles);
    let extraProps: Record<string, unknown> = {};
    if (isAnimatedHandle(animatedProps)) {
      handles.push(animatedProps);
      extraProps = animatedProps.get();
    }
    const keys = handles;
    React.useEffect(() => {
      const unsubs = keys.map((h) => h.subscribe(force));
      return () => {
        for (const u of unsubs) u();
      };
      // subscription set is derived from render output; length is a good proxy
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [keys.length]);
    return React.createElement(Component as React.ElementType, {
      ...(rest as unknown as P),
      ...extraProps,
      style: resolvedStyle,
      ref,
    } as P & { ref: unknown });
  });
  Animated.displayName = `Animated(${Component.displayName ?? Component.name ?? 'Component'})`;
  (Animated as unknown as { __nsInner: React.ComponentType<P> }).__nsInner = Component;
  return Animated as unknown as React.ComponentType<P & { animatedProps?: unknown }>;
}

const AnimatedView = createAnimatedComponent(View as React.ComponentType<{ style?: unknown }>);
const AnimatedScrollView = createAnimatedComponent(ScrollView as React.ComponentType<{ style?: unknown }>);

const Animated = {
  View: AnimatedView,
  ScrollView: AnimatedScrollView,
  createAnimatedComponent,
  addWhitelistedUIProps: (_props: Record<string, boolean>) => {},
  addWhitelistedNativeProps: (_props: Record<string, boolean>) => {},
};

export default Animated;

export type AnimatedRef<T> = React.RefObject<T>;
export type DerivedValue<T> = SharedValue<T>;
export type WithSpringConfig_ = WithSpringConfig;
