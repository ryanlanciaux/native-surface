/**
 * Shared-value core for the reanimated compat shim: mutable boxes with
 * subscribers, automatic dependency tracking (the stand-in for worklet
 * closure capture), and a rAF animation driver so `sv.value = withTiming(x)`
 * really animates.
 */

type Listener = () => void;

let currentTracker: Set<SharedBox<unknown>> | null = null;

export interface AnimationDescriptor {
  __cnAnimation: true;
  toValue: number;
  make(from: number): (nowMs: number) => { value: number; done: boolean };
  callback?: (finished: boolean) => void;
}

export function isAnimationDescriptor(v: unknown): v is AnimationDescriptor {
  return typeof v === 'object' && v !== null && (v as AnimationDescriptor).__cnAnimation === true;
}

export class SharedBox<T> {
  private raw: T;
  private listeners = new Set<Listener>();
  /** driver bookkeeping */
  step: ((nowMs: number) => { value: number; done: boolean }) | null = null;
  animCallback: ((finished: boolean) => void) | undefined;

  constructor(initial: T) {
    this.raw = initial;
  }

  get value(): T {
    currentTracker?.add(this as SharedBox<unknown>);
    return this.raw;
  }

  set value(next: T) {
    if (isAnimationDescriptor(next)) {
      startAnimation(this as unknown as SharedBox<number>, next);
      return;
    }
    stopAnimation(this as SharedBox<unknown>, false);
    this.setRaw(next);
  }

  /** Direct write: no animation-cancel side effects (used by the driver). */
  setRaw(next: T): void {
    if (Object.is(next, this.raw)) return;
    this.raw = next;
    this.notify();
  }

  private notify(): void {
    for (const l of [...this.listeners]) l();
  }

  /** Read without registering a dependency. */
  peek(): T {
    return this.raw;
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  // reanimated API compat
  get(): T {
    return this.value;
  }
  set(next: T | ((prev: T) => T)): void {
    this.value = typeof next === 'function' ? (next as (prev: T) => T)(this.raw) : next;
  }
  addListener(_id: number, l: (v: T) => void): void {
    this.subscribe(() => l(this.raw));
  }
  removeListener(_id: number): void {}
  /**
   * Reanimated's modify: the mutator may change the object IN PLACE and
   * return the same reference — listeners must still fire (forceUpdate
   * defaults to true upstream). The identity guard in setRaw would swallow
   * that, so notify explicitly.
   */
  modify(mod?: (v: T) => T, forceUpdate = true): void {
    const result = mod ? mod(this.raw) : this.raw;
    if (isAnimationDescriptor(result)) {
      this.value = result as T;
      return;
    }
    stopAnimation(this as SharedBox<unknown>, false);
    if (!Object.is(result, this.raw)) {
      this.setRaw(result);
      return;
    }
    if (forceUpdate) this.notify();
  }
}

/** Runs fn, recording every SharedBox whose .value is read. */
export function track<T>(fn: () => T): { result: T; deps: Set<SharedBox<unknown>> } {
  const prev = currentTracker;
  const deps = new Set<SharedBox<unknown>>();
  currentTracker = deps;
  try {
    return { result: fn(), deps };
  } finally {
    currentTracker = prev;
  }
}

// ---------------------------------------------------------------------------
// Animation driver
// ---------------------------------------------------------------------------

const running = new Set<SharedBox<number>>();
let frameHandle: number | ReturnType<typeof setTimeout> | null = null;

const raf: (cb: (t: number) => void) => number | ReturnType<typeof setTimeout> =
  typeof requestAnimationFrame === 'function'
    ? (cb) => requestAnimationFrame(cb)
    : (cb) => setTimeout(() => cb(Date.now()), 16);

function pump(): void {
  frameHandle = null;
  const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
  for (const box of [...running]) {
    const step = box.step;
    if (!step) {
      running.delete(box);
      continue;
    }
    const { value, done } = step(nowMs);
    box.setRaw(value);
    if (done) {
      const cb = box.animCallback;
      box.step = null;
      box.animCallback = undefined;
      running.delete(box);
      cb?.(true);
    }
  }
  if (running.size > 0 && frameHandle == null) frameHandle = raf(pump);
}

export function startAnimation(box: SharedBox<number>, desc: AnimationDescriptor): void {
  stopAnimation(box as SharedBox<unknown>, false);
  const from = Number(box.peek() ?? 0);
  if (!Number.isFinite(from) || from === desc.toValue) {
    box.setRaw(desc.toValue);
    desc.callback?.(true);
    return;
  }
  box.step = desc.make(from);
  box.animCallback = desc.callback;
  running.add(box);
  if (frameHandle == null) frameHandle = raf(pump);
}

export function stopAnimation(box: SharedBox<unknown>, finished: boolean): void {
  const b = box as SharedBox<number>;
  if (!b.step) return;
  const cb = b.animCallback;
  b.step = null;
  b.animCallback = undefined;
  running.delete(b);
  cb?.(finished);
}
