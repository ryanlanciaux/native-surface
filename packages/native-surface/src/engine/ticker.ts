/**
 * One shared frame loop driving all time-based engine work (Animated, scroll
 * momentum/bounce). Extracted from api/Animated so engine internals can tick
 * without importing the public Animated module.
 */

export type TickFn = (nowMs: number) => void;

// Both branches must produce performance.now()-epoch timestamps: physics
// anchors start times on performance.now(), and mixing clocks turns a 300 ms
// glide into an instant teleport (browser rAF timestamps are already on the
// performance timeline).
const nowMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const raf: (cb: (t: number) => void) => unknown =
  typeof requestAnimationFrame === 'function'
    ? (cb) => requestAnimationFrame(cb)
    : (cb) => setTimeout(() => cb(nowMs()), 16);

class Ticker {
  private ticks = new Set<TickFn>();
  private running = false;

  add(fn: TickFn): void {
    this.ticks.add(fn);
    if (!this.running) {
      this.running = true;
      raf((t) => this.frame(t));
    }
  }

  remove(fn: TickFn): void {
    this.ticks.delete(fn);
  }

  private frame(now: number): void {
    for (const fn of [...this.ticks]) fn(now);
    if (this.ticks.size > 0) {
      raf((t) => this.frame(t));
    } else {
      this.running = false;
    }
  }
}

export const ticker = new Ticker();
