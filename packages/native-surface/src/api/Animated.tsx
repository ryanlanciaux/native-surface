/**
 * Core `Animated` for native-surface — the surface React Navigation's stack /
 * bottom-tabs / elements actually use (inventoried from their shipped code):
 * Value, timing, spring, event, parallel (+ sequence/delay/loop), multiply,
 * interpolate, createAnimatedComponent / Animated.View / Animated.Text /
 * Animated.Image, plus RN's `Easing` and `useAnimatedValue`.
 *
 * Updates bypass React and land on host nodes through the same
 * `setNativeProps` seam that real react-native-reanimated uses (see
 * engine/node.ts). The spring integrator is the semi-implicit Euler in real
 * units proven in compat's reanimated shim — its predecessor "completed"
 * stiff springs in one substep (see that file's history) — regression-guarded
 * here by tests.
 */
import * as React from 'react';
import { View, Text } from '../components/primitives';
import { Image } from '../components/primitives';
import { processColor } from '../engine/colors';
import { ticker, type TickFn } from '../engine/ticker';

type Listener = (state: { value: number }) => void;

// ---------------------------------------------------------------------------
// Node graph
// ---------------------------------------------------------------------------

let nextListenerId = 1;

export abstract class AnimatedNode {
  /** Sinks re-resolved when any upstream value changes. */
  readonly __subscribers = new Set<() => void>();

  abstract __getValue(): number | string;

  __subscribe(fn: () => void): () => void {
    this.__subscribers.add(fn);
    return () => this.__subscribers.delete(fn);
  }

  protected __notify(): void {
    for (const fn of [...this.__subscribers]) fn();
  }
}

export interface InterpolationConfig {
  inputRange: number[];
  outputRange: number[] | string[];
  extrapolate?: 'extend' | 'clamp' | 'identity';
  extrapolateLeft?: 'extend' | 'clamp' | 'identity';
  extrapolateRight?: 'extend' | 'clamp' | 'identity';
  easing?: (t: number) => number;
}

const NUMERIC_RE = /^(-?\d+\.?\d*)(deg|rad|%|px)?$/;

function parseUnit(s: string): { n: number; unit: string } | null {
  const m = NUMERIC_RE.exec(s.trim());
  if (!m) return null;
  return { n: parseFloat(m[1]!), unit: m[2] ?? '' };
}

/** 0xAARRGGBB → channels, for documented color-output interpolation. */
function colorChannels(c: number): [number, number, number, number] {
  return [(c >>> 24) & 0xff, (c >>> 16) & 0xff, (c >>> 8) & 0xff, c & 0xff];
}

class AnimatedInterpolation extends AnimatedNode {
  private detach: () => void;

  constructor(
    private readonly parent: AnimatedNode,
    private readonly config: InterpolationConfig
  ) {
    super();
    this.detach = parent.__subscribe(() => this.__notify());
  }

  interpolate(config: InterpolationConfig): AnimatedInterpolation {
    return new AnimatedInterpolation(this, config);
  }

  __getValue(): number | string {
    const input = Number(this.parent.__getValue());
    const { inputRange, outputRange } = this.config;
    const easing = this.config.easing ?? ((t: number) => t);
    const exLeft = this.config.extrapolateLeft ?? this.config.extrapolate ?? 'extend';
    const exRight = this.config.extrapolateRight ?? this.config.extrapolate ?? 'extend';

    // segment lookup
    let i = 1;
    while (i < inputRange.length - 1 && inputRange[i]! < input) i++;
    const x0 = inputRange[i - 1]!;
    const x1 = inputRange[i]!;

    let t = x1 === x0 ? 0 : (input - x0) / (x1 - x0);
    if (input < inputRange[0]!) {
      if (exLeft === 'identity') return input;
      if (exLeft === 'clamp') t = 0;
    }
    if (input > inputRange[inputRange.length - 1]!) {
      if (exRight === 'identity') return input;
      if (exRight === 'clamp') t = 1;
    }
    t = easing(t);

    const out = outputRange as Array<number | string>;
    const o0 = out[i - 1]!;
    const o1 = out[i]!;
    if (typeof o0 === 'number' && typeof o1 === 'number') {
      return o0 + t * (o1 - o0);
    }
    const p0 = parseUnit(String(o0));
    const p1 = parseUnit(String(o1));
    if (p0 && p1) {
      const n = p0.n + t * (p1.n - p0.n);
      return p0.unit ? `${n}${p0.unit}` : n;
    }
    // Documented color-output interpolation ('#rgb', 'rgba(...)', named).
    const c0 = processColor(String(o0));
    const c1 = processColor(String(o1));
    if (c0 != null && c1 != null) {
      const ch0 = colorChannels(c0);
      const ch1 = colorChannels(c1);
      const mix = ch0.map((v, k) => v + t * (ch1[k]! - v)) as [number, number, number, number];
      return `rgba(${Math.round(mix[1])}, ${Math.round(mix[2])}, ${Math.round(mix[3])}, ${(mix[0] / 255).toFixed(4)})`;
    }
    throw new Error(`native-surface Animated: unsupported outputRange value "${o0}"`);
  }
}

interface Driver {
  stop(): void;
}

export class AnimatedValue extends AnimatedNode {
  private _value: number;
  private _offset = 0;
  private listeners = new Map<string, Listener>();
  /** @internal current driving animation, if any */
  __driver: Driver | null = null;

  constructor(value: number) {
    super();
    this._value = value;
  }

  __getValue(): number {
    return this._value + this._offset;
  }

  /** @internal write from a driver or setValue; notifies graph + listeners */
  __update(value: number): void {
    this._value = value;
    const v = this.__getValue();
    for (const l of [...this.listeners.values()]) l({ value: v });
    this.__notify();
  }

  setValue(value: number): void {
    // RN semantics: an explicit set stops the in-flight animation.
    this.__driver?.stop();
    this.__driver = null;
    this.__update(value);
  }

  setOffset(offset: number): void {
    this._offset = offset;
    this.__notify();
  }

  flattenOffset(): void {
    this._value += this._offset;
    this._offset = 0;
  }

  extractOffset(): void {
    this._offset += this._value;
    this._value = 0;
  }

  addListener(callback: Listener): string {
    const id = String(nextListenerId++);
    this.listeners.set(id, callback);
    return id;
  }

  removeListener(id: string): void {
    this.listeners.delete(id);
  }

  removeAllListeners(): void {
    this.listeners.clear();
  }

  stopAnimation(callback?: (value: number) => void): void {
    this.__driver?.stop();
    this.__driver = null;
    callback?.(this.__getValue());
  }

  resetAnimation(callback?: (value: number) => void): void {
    this.stopAnimation(callback);
  }

  interpolate(config: InterpolationConfig): AnimatedInterpolation {
    return new AnimatedInterpolation(this, config);
  }
}

/** RN's binary nodes accept plain numbers alongside nodes. */
class AnimatedConstant extends AnimatedNode {
  constructor(private readonly v: number) {
    super();
  }
  __getValue(): number {
    return this.v;
  }
}

function toNode(v: AnimatedNode | number): AnimatedNode {
  return typeof v === 'number' ? new AnimatedConstant(v) : v;
}

class AnimatedMultiplication extends AnimatedNode {
  constructor(
    private readonly a: AnimatedNode,
    private readonly b: AnimatedNode
  ) {
    super();
    a.__subscribe(() => this.__notify());
    b.__subscribe(() => this.__notify());
  }

  interpolate(config: InterpolationConfig): AnimatedInterpolation {
    return new AnimatedInterpolation(this, config);
  }

  __getValue(): number {
    return Number(this.a.__getValue()) * Number(this.b.__getValue());
  }
}

// ---------------------------------------------------------------------------
// Easing (RN surface)
// ---------------------------------------------------------------------------

function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  // Newton–Raphson on the x(t) curve, then evaluate y.
  const cx = (u: number) => 3 * x1 * (1 - u) ** 2 * u + 3 * x2 * (1 - u) * u ** 2 + u ** 3;
  const cy = (u: number) => 3 * y1 * (1 - u) ** 2 * u + 3 * y2 * (1 - u) * u ** 2 + u ** 3;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let u = x;
    for (let i = 0; i < 8; i++) {
      const err = cx(u) - x;
      if (Math.abs(err) < 1e-5) break;
      const d = (cx(u + 1e-4) - cx(u - 1e-4)) / 2e-4;
      if (Math.abs(d) < 1e-6) break;
      u -= err / d;
      u = Math.min(1, Math.max(0, u));
    }
    return cy(u);
  };
}

type EasingFn = (t: number) => number;

const easeDefault: EasingFn = cubicBezier(0.42, 0, 1, 1);

export const Easing = {
  step0: ((t) => (t > 0 ? 1 : 0)) as EasingFn,
  step1: ((t) => (t >= 1 ? 1 : 0)) as EasingFn,
  linear: ((t) => t) as EasingFn,
  ease: easeDefault,
  quad: ((t) => t * t) as EasingFn,
  cubic: ((t) => t * t * t) as EasingFn,
  poly: (n: number): EasingFn => (t) => t ** n,
  sin: ((t) => 1 - Math.cos((t * Math.PI) / 2)) as EasingFn,
  circle: ((t) => 1 - Math.sqrt(1 - t * t)) as EasingFn,
  exp: ((t) => (t === 0 ? 0 : 2 ** (10 * (t - 1)))) as EasingFn,
  elastic:
    (bounciness = 1): EasingFn =>
    (t) => {
      const p = bounciness * Math.PI;
      return 1 - Math.cos((t * Math.PI) / 2) ** 3 * Math.cos(t * p);
    },
  back:
    (s = 1.70158): EasingFn =>
    (t) =>
      t * t * ((s + 1) * t - s),
  bounce: ((t) => {
    if (t < 1 / 2.75) return 7.5625 * t * t;
    if (t < 2 / 2.75) {
      const u = t - 1.5 / 2.75;
      return 7.5625 * u * u + 0.75;
    }
    if (t < 2.5 / 2.75) {
      const u = t - 2.25 / 2.75;
      return 7.5625 * u * u + 0.9375;
    }
    const u = t - 2.625 / 2.75;
    return 7.5625 * u * u + 0.984375;
  }) as EasingFn,
  bezier: cubicBezier,
  in: (fn: EasingFn = easeDefault): EasingFn => fn,
  out:
    (fn: EasingFn = easeDefault): EasingFn =>
    (t) =>
      1 - fn(1 - t),
  inOut:
    (fn: EasingFn = easeDefault): EasingFn =>
    (t) =>
      t < 0.5 ? fn(t * 2) / 2 : 1 - fn((1 - t) * 2) / 2,
};

// ---------------------------------------------------------------------------
// Drivers
// ---------------------------------------------------------------------------

export interface CompositeAnimation {
  start(callback?: (result: { finished: boolean }) => void): void;
  stop(): void;
  reset(): void;
}

interface TimingConfig {
  toValue: number;
  duration?: number;
  delay?: number;
  easing?: EasingFn;
  useNativeDriver?: boolean;
  isInteraction?: boolean;
}

interface SpringConfig {
  toValue: number;
  stiffness?: number;
  damping?: number;
  mass?: number;
  velocity?: number;
  overshootClamping?: boolean;
  restDisplacementThreshold?: number;
  restSpeedThreshold?: number;
  // legacy pair — mapped like RN does
  bounciness?: number;
  speed?: number;
  tension?: number;
  friction?: number;
  delay?: number;
  useNativeDriver?: boolean;
  isInteraction?: boolean;
}

function startDriver(
  value: AnimatedValue,
  step: (nowMs: number) => { value: number; done: boolean },
  delayMs: number,
  onEnd: (finished: boolean) => void
): Driver {
  let stopped = false;
  let delayTimer: ReturnType<typeof setTimeout> | null = null;

  const tick: TickFn = (now) => {
    if (stopped) return;
    const r = step(now);
    value.__update(r.value);
    if (r.done) {
      ticker.remove(tick);
      value.__driver = null;
      onEnd(true);
    }
  };

  const begin = () => {
    if (!stopped) ticker.add(tick);
  };
  if (delayMs > 0) delayTimer = setTimeout(begin, delayMs);
  else begin();

  const driver: Driver = {
    stop() {
      if (stopped) return;
      stopped = true;
      if (delayTimer) clearTimeout(delayTimer);
      ticker.remove(tick);
      if (value.__driver === driver) value.__driver = null;
      onEnd(false);
    },
  };
  return driver;
}

function timing(value: AnimatedValue, config: TimingConfig): CompositeAnimation {
  const duration = config.duration ?? 500;
  const easing = config.easing ?? Easing.inOut(Easing.ease);
  let running: Driver | null = null;
  return {
    start(callback) {
      const from = Number(value.__getValue());
      let startT = -1;
      value.__driver?.stop();
      const stepFn = (now: number) => {
        if (startT < 0) startT = now;
        const t = duration <= 0 ? 1 : Math.min(1, (now - startT) / duration);
        const v = from + easing(t) * (config.toValue - from);
        return { value: t >= 1 ? config.toValue : v, done: t >= 1 };
      };
      running = startDriver(value, stepFn, config.delay ?? 0, (finished) => {
        running = null;
        callback?.({ finished });
      });
      value.__driver = running;
    },
    stop() {
      running?.stop();
      running = null;
    },
    reset() {
      this.stop();
    },
  };
}

function spring(value: AnimatedValue, config: SpringConfig): CompositeAnimation {
  // RN legacy config mapping (bounciness/speed, tension/friction) — the
  // navigation packages pass the modern stiffness/damping/mass form.
  const stiffness = config.stiffness ?? (config.tension != null ? config.tension : 100);
  const damping = config.damping ?? (config.friction != null ? config.friction * 2 : 10);
  const mass = config.mass ?? 1;
  const restD = config.restDisplacementThreshold ?? 0.001;
  const restV = config.restSpeedThreshold ?? 0.001;
  const clampOvershoot = config.overshootClamping ?? false;
  let running: Driver | null = null;
  return {
    start(callback) {
      const from = Number(value.__getValue());
      const to = config.toValue;
      /**
       * DEVICE-FAITHFUL BY CONSTRUCTION: this is RN's SpringAnimation.onUpdate
       * closed-form algorithm (react-native/Libraries/Animated/animations/
       * SpringAnimation.js), which itself matches iOS CASpringAnimation.
       * The critical quirk: ζ ≥ 1 uses the CRITICALLY-damped envelope
       * e^(−ω₀·t) rather than the true overdamped solution. For the stack
       * navigator's spec {stiffness:1000, damping:500, mass:3} that means
       * ~97% completion at 200ms — the true overdamped physics (which the
       * previous integrator solved "correctly") has a slow eigenvalue of
       * ~2 s⁻¹ and crawls for seconds. Physically right, device-wrong.
       */
      const zeta = damping / (2 * Math.sqrt(stiffness * mass));
      const omega0 = Math.sqrt(stiffness / mass);
      const omega1 = omega0 * Math.sqrt(Math.abs(1 - zeta * zeta)) || 1e-9;
      const x0 = to - from;
      const v0 = -(config.velocity ?? 0);
      let frameTime = 0;
      let last = -1;
      value.__driver?.stop();
      const stepFn = (now: number) => {
        if (last < 0) last = now - 16;
        const dt = Math.min(64, now - last); // MAX_STEPS clamp, like RN
        last = now;
        frameTime += dt / 1000;
        const t = frameTime;
        let position: number;
        let velocity: number;
        if (zeta < 1) {
          const envelope = Math.exp(-zeta * omega0 * t);
          position =
            to - envelope * (((v0 + zeta * omega0 * x0) / omega1) * Math.sin(omega1 * t) + x0 * Math.cos(omega1 * t));
          velocity =
            zeta * omega0 * envelope * ((Math.sin(omega1 * t) * (v0 + zeta * omega0 * x0)) / omega1 + x0 * Math.cos(omega1 * t)) -
            envelope * (Math.cos(omega1 * t) * (v0 + zeta * omega0 * x0) - omega1 * x0 * Math.sin(omega1 * t));
        } else {
          const envelope = Math.exp(-omega0 * t);
          position = to - envelope * (x0 + (v0 + omega0 * x0) * t);
          velocity = envelope * (v0 * (t * omega0 - 1) + t * x0 * (omega0 * omega0));
        }
        let isOvershooting = false;
        if (clampOvershoot && stiffness !== 0) {
          isOvershooting = from < to ? position > to : position < to;
        }
        const atRest = Math.abs(velocity) <= restV && (stiffness === 0 || Math.abs(to - position) <= restD);
        if (isOvershooting || atRest) return { value: to, done: true };
        return { value: position, done: false };
      };
      running = startDriver(value, stepFn, config.delay ?? 0, (finished) => {
        running = null;
        callback?.({ finished });
      });
      value.__driver = running;
    },
    stop() {
      running?.stop();
      running = null;
    },
    reset() {
      this.stop();
    },
  };
}

function parallel(animations: CompositeAnimation[]): CompositeAnimation {
  let doneCount = 0;
  let failed = false;
  return {
    start(callback) {
      doneCount = 0;
      failed = false;
      if (animations.length === 0) {
        callback?.({ finished: true });
        return;
      }
      for (const a of animations) {
        a.start(({ finished }) => {
          doneCount++;
          if (!finished) failed = true;
          if (doneCount === animations.length) callback?.({ finished: !failed });
        });
      }
    },
    stop() {
      for (const a of animations) a.stop();
    },
    reset() {
      for (const a of animations) a.reset();
    },
  };
}

function sequence(animations: CompositeAnimation[]): CompositeAnimation {
  let current = -1;
  let stopped = false;
  return {
    start(callback) {
      stopped = false;
      const next = (i: number) => {
        if (stopped) return;
        if (i >= animations.length) {
          callback?.({ finished: true });
          return;
        }
        current = i;
        animations[i]!.start(({ finished }) => {
          if (finished) next(i + 1);
          else callback?.({ finished: false });
        });
      };
      next(0);
    },
    stop() {
      stopped = true;
      if (current >= 0 && current < animations.length) animations[current]!.stop();
    },
    reset() {
      this.stop();
      for (const a of animations) a.reset();
    },
  };
}

function delay(time: number): CompositeAnimation {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    start(callback) {
      timer = setTimeout(() => callback?.({ finished: true }), time);
    },
    stop() {
      if (timer) clearTimeout(timer);
    },
    reset() {
      this.stop();
    },
  };
}

function stagger(time: number, animations: CompositeAnimation[]): CompositeAnimation {
  return parallel(animations.map((a, i) => sequence([delay(time * i), a])));
}

function loop(animation: CompositeAnimation, config?: { iterations?: number }): CompositeAnimation {
  const iterations = config?.iterations ?? -1;
  let stopped = false;
  return {
    start(callback) {
      stopped = false;
      let count = 0;
      const run = () => {
        if (stopped || (iterations >= 0 && count >= iterations)) {
          callback?.({ finished: !stopped });
          return;
        }
        count++;
        animation.reset();
        animation.start(({ finished }) => {
          if (finished) run();
          else callback?.({ finished: false });
        });
      };
      run();
    },
    stop() {
      stopped = true;
      animation.stop();
    },
    reset() {
      this.stop();
      animation.reset();
    },
  };
}

// ---------------------------------------------------------------------------
// Animated.event
// ---------------------------------------------------------------------------

type EventMapping = { [key: string]: EventMapping | AnimatedValue };

function applyMapping(mapping: EventMapping | AnimatedValue, data: unknown): void {
  if (mapping instanceof AnimatedValue) {
    if (typeof data === 'number') mapping.setValue(data);
    return;
  }
  if (data == null || typeof data !== 'object') return;
  for (const key of Object.keys(mapping)) {
    applyMapping(mapping[key]!, (data as Record<string, unknown>)[key]);
  }
}

function event(
  argMapping: Array<EventMapping | null>,
  config?: { listener?: (...args: unknown[]) => void; useNativeDriver?: boolean }
): (...args: unknown[]) => void {
  return (...args: unknown[]) => {
    argMapping.forEach((mapping, i) => {
      if (mapping) applyMapping(mapping, args[i]);
    });
    config?.listener?.(...args);
  };
}

// ---------------------------------------------------------------------------
// createAnimatedComponent
// ---------------------------------------------------------------------------

interface HostRef {
  setNativeProps(patch: Record<string, unknown>): void;
}

function isAnimatedNode(v: unknown): v is AnimatedNode {
  return v instanceof AnimatedNode;
}

/**
 * Deep-resolve animated nodes in a STYLE value; collects found nodes.
 * Only plain objects/arrays are entered — and never React elements — so
 * cyclic structures (children, navigation descriptors) can't recurse.
 */
function resolveStyleValue(v: unknown, found: Set<AnimatedNode>): unknown {
  if (isAnimatedNode(v)) {
    found.add(v);
    return v.__getValue();
  }
  if (Array.isArray(v)) return v.map((item) => resolveStyleValue(item, found));
  if (
    v != null &&
    typeof v === 'object' &&
    (v as object).constructor === Object &&
    (v as { $$typeof?: unknown }).$$typeof === undefined
  ) {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = resolveStyleValue(val, found);
    }
    return out;
  }
  return v;
}

/**
 * Resolve a props object: `style` deeply (transforms live there); every other
 * prop only if the prop value itself is an AnimatedNode. Children and any
 * complex structures pass through untouched.
 */
function resolveProps(props: Record<string, unknown>, found: Set<AnimatedNode>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    if (k === 'style') out[k] = resolveStyleValue(v, found);
    else if (isAnimatedNode(v)) {
      found.add(v);
      out[k] = v.__getValue();
    } else out[k] = v;
  }
  return out;
}

export function createAnimatedComponent<P extends object>(
  Component: React.ComponentType<P>
): React.ForwardRefExoticComponent<React.PropsWithoutRef<P> & React.RefAttributes<unknown>> {
  const Animated = React.forwardRef<unknown, P>((props, forwardedRef) => {
    const hostRef = React.useRef<HostRef | null>(null);
    const latestProps = React.useRef(props);
    latestProps.current = props;

    // Initial + per-render resolution (so React commits carry current values).
    const found = new Set<AnimatedNode>();
    const resolved = resolveProps(props as Record<string, unknown>, found) as P;

    React.useEffect(() => {
      const update = () => {
        const host = hostRef.current;
        if (!host) return;
        const p = latestProps.current as Record<string, unknown>;
        const patch: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(p)) {
          // Only push prop groups that actually contain animated nodes —
          // style (incl. transforms) in practice.
          const probe = new Set<AnimatedNode>();
          const r = k === 'style' ? resolveStyleValue(v, probe) : isAnimatedNode(v) ? (probe.add(v), v.__getValue()) : v;
          if (probe.size > 0) patch[k] = r;
        }
        if (Object.keys(patch).length > 0) host.setNativeProps(patch);
      };
      const unsubs = [...found].map((n) => n.__subscribe(update));
      return () => unsubs.forEach((u) => u());
      // found's identity changes every render; effect re-binds via deps below.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [...found]);

    const setRef = React.useCallback(
      (inst: unknown) => {
        hostRef.current = inst as HostRef | null;
        if (typeof forwardedRef === 'function') forwardedRef(inst);
        else if (forwardedRef) (forwardedRef as React.MutableRefObject<unknown>).current = inst;
      },
      [forwardedRef]
    );

    return <Component {...resolved} ref={setRef} />;
  });
  Animated.displayName = `Animated(${Component.displayName ?? Component.name ?? 'Component'})`;
  return Animated as never;
}

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

class AnimatedAddition extends AnimatedNode {
  constructor(
    private readonly a: AnimatedNode,
    private readonly b: AnimatedNode
  ) {
    super();
    a.__subscribe(() => this.__notify());
    b.__subscribe(() => this.__notify());
  }
  interpolate(config: InterpolationConfig): AnimatedInterpolation {
    return new AnimatedInterpolation(this, config);
  }
  __getValue(): number {
    return Number(this.a.__getValue()) + Number(this.b.__getValue());
  }
}

/**
 * Animated components accept the base component's props with AnimatedNode
 * values allowed anywhere in `style` — expressing that precisely in TS costs
 * more than it buys (RN's own types special-case this); components are typed
 * permissively.
 */
type AnyAnimatedComponent = React.ComponentType<Record<string, unknown>>;

class AnimatedBinary extends AnimatedNode {
  constructor(
    private readonly a: AnimatedNode,
    private readonly b: AnimatedNode,
    private readonly op: (a: number, b: number) => number
  ) {
    super();
    a.__subscribe(() => this.__notify());
    b.__subscribe(() => this.__notify());
  }
  interpolate(config: InterpolationConfig): AnimatedInterpolation {
    return new AnimatedInterpolation(this, config);
  }
  __getValue(): number {
    return this.op(Number(this.a.__getValue()), Number(this.b.__getValue()));
  }
}

class AnimatedDiffClamp extends AnimatedNode {
  private lastInput: number;
  private value: number;
  constructor(
    private readonly parent: AnimatedNode,
    private readonly min: number,
    private readonly max: number
  ) {
    super();
    this.lastInput = Number(parent.__getValue());
    this.value = Math.min(Math.max(this.lastInput, min), max);
    parent.__subscribe(() => {
      const input = Number(this.parent.__getValue());
      const diff = input - this.lastInput;
      this.lastInput = input;
      this.value = Math.min(Math.max(this.value + diff, this.min), this.max);
      this.__notify();
    });
  }
  interpolate(config: InterpolationConfig): AnimatedInterpolation {
    return new AnimatedInterpolation(this, config);
  }
  __getValue(): number {
    return this.value;
  }
}

/** RN's Animated.ValueXY — two linked values plus the documented helpers. */
export class AnimatedValueXY {
  readonly x: AnimatedValue;
  readonly y: AnimatedValue;
  constructor(value?: { x: number; y: number }) {
    this.x = new AnimatedValue(value?.x ?? 0);
    this.y = new AnimatedValue(value?.y ?? 0);
  }
  setValue(v: { x: number; y: number }): void {
    this.x.setValue(v.x);
    this.y.setValue(v.y);
  }
  setOffset(o: { x: number; y: number }): void {
    this.x.setOffset(o.x);
    this.y.setOffset(o.y);
  }
  flattenOffset(): void {
    this.x.flattenOffset();
    this.y.flattenOffset();
  }
  extractOffset(): void {
    this.x.extractOffset();
    this.y.extractOffset();
  }
  stopAnimation(callback?: (v: { x: number; y: number }) => void): void {
    this.x.stopAnimation();
    this.y.stopAnimation();
    callback?.(this.__getValue());
  }
  resetAnimation(callback?: (v: { x: number; y: number }) => void): void {
    this.stopAnimation(callback);
  }
  addListener(cb: (v: { x: number; y: number }) => void): string {
    const emit = () => cb(this.__getValue());
    const idX = this.x.addListener(emit);
    const idY = this.y.addListener(emit);
    return `${idX},${idY}`;
  }
  removeListener(id: string): void {
    const [idX, idY] = id.split(',');
    if (idX) this.x.removeListener(idX);
    if (idY) this.y.removeListener(idY);
  }
  removeAllListeners(): void {
    this.x.removeAllListeners();
    this.y.removeAllListeners();
  }
  __getValue(): { x: number; y: number } {
    return { x: this.x.__getValue(), y: this.y.__getValue() };
  }
  getLayout(): { left: AnimatedValue; top: AnimatedValue } {
    return { left: this.x, top: this.y };
  }
  getTranslateTransform(): Array<Record<string, AnimatedValue>> {
    return [{ translateX: this.x }, { translateY: this.y }];
  }
}

interface DecayConfig {
  velocity: number | { x: number; y: number };
  deceleration?: number;
  useNativeDriver?: boolean;
  isInteraction?: boolean;
  delay?: number;
}

/** RN DecayAnimation closed form: v0/(1-d) * (1 - e^(-(1-d)t)). */
function decay(value: AnimatedValue, config: DecayConfig): CompositeAnimation {
  const deceleration = config.deceleration ?? 0.998;
  const velocity = typeof config.velocity === 'number' ? config.velocity : config.velocity.x;
  let running: Driver | null = null;
  return {
    start(callback) {
      const from = Number(value.__getValue());
      let start = -1;
      value.__driver?.stop();
      const stepFn = (now: number) => {
        if (start < 0) start = now;
        const t = now - start;
        const kv = 1 - deceleration;
        const position = from + (velocity / kv) * (1 - Math.exp(-kv * t));
        const v = velocity * Math.exp(-kv * t);
        const done = Math.abs(v) < 0.1;
        return { value: position, done };
      };
      running = startDriver(value, stepFn, config.delay ?? 0, (finished) => {
        running = null;
        callback?.({ finished });
      });
      value.__driver = running;
    },
    stop() {
      running?.stop();
      running = null;
    },
    reset() {
      this.stop();
    },
  };
}

export const Animated = {
  Value: AnimatedValue,
  ValueXY: AnimatedValueXY,
  View: createAnimatedComponent(View as React.ComponentType<object>) as AnyAnimatedComponent,
  Text: createAnimatedComponent(Text as React.ComponentType<object>) as AnyAnimatedComponent,
  Image: createAnimatedComponent(Image as React.ComponentType<object>) as AnyAnimatedComponent,
  createAnimatedComponent,
  timing,
  spring,
  parallel,
  sequence,
  delay,
  stagger,
  loop,
  event,
  decay,
  multiply: (a: AnimatedNode | number, b: AnimatedNode | number) => new AnimatedMultiplication(toNode(a), toNode(b)),
  add: (a: AnimatedNode | number, b: AnimatedNode | number) => new AnimatedAddition(toNode(a), toNode(b)),
  subtract: (a: AnimatedNode | number, b: AnimatedNode | number) =>
    new AnimatedBinary(toNode(a), toNode(b), (x, y) => x - y),
  divide: (a: AnimatedNode | number, b: AnimatedNode | number) =>
    new AnimatedBinary(toNode(a), toNode(b), (x, y) => x / y),
  modulo: (a: AnimatedNode | number, b: number) => new AnimatedBinary(toNode(a), toNode(b), (x, y) => ((x % y) + y) % y),
  diffClamp: (a: AnimatedNode, min: number, max: number) => new AnimatedDiffClamp(a, min, max),
};

export function useAnimatedValue(initial: number): AnimatedValue {
  const ref = React.useRef<AnimatedValue | null>(null);
  if (ref.current === null) ref.current = new AnimatedValue(initial);
  return ref.current;
}
